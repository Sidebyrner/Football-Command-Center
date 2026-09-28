/**
 * The Trade Desk: need → partner → deal → approach — a port of FCApp
 * `TradeWizardModel`, with its `TradeStep`, `TradeBasis`, `TradeGoal`,
 * `TradePlayer`, `PartnerFit`, `ShortfallChange`, `DealSide`, `DealEffects`,
 * `TradeWindow`, `TradeWizardPrefill` and `TradeSearchResult`.
 *
 * Sleeper's API is read-only, so the desk ends with a message to send and a
 * link into Sleeper, never with a trade proposed on anyone's behalf.
 */
import { baselineLines, MINIMUM_GAMES_FOR_LINE, observedFlexDemand, type Baselines } from '@core/Baselines'
import { crunchOutlook, shortDedicatedPositions, type CrunchReport, type RosterEntry } from '@core/ByeCrunch'
import { fuzzyScore } from '@core/FuzzyNameMatch'
import { optimizeLineup } from '@core/LineupOptimizer'
import { nflverseTeam, teamName } from '@core/NFLTeams'
import type { Position } from '@core/Position'
import { totalStarterSlots } from '@core/RosterSlots'
import { roundAwayFromZero } from '@core/rounding'
import { formatFixed } from '@core/numeric'
import type { SeasonProfile } from '@core/SeasonProfile'
import { gradeTeams, type TeamGrade, type TeamGradeInput } from '@core/TeamGrades'
import { buildTeamNeeds, needID, needWeeks, type Need, type TeamNeeds } from '@core/TeamNeeds'
import { played, scoreLine } from '@data/insightsModels'
import type { RelayClient } from '@data/RelayClient'
import { LocalStorageSecretStore, type SecretStore } from '@data/secretStore'
import { EMPTY_STARTER_SLOT, effectiveTradeDeadline } from '@data/sleeperModels'
import { Observable } from '../Observable'
import { teamLink } from '../league/GameDayWindow'
import { hasProjections } from '../league/InSeasonData'
import {
  blocksStart, playoffWeeks, startAvailability, startBadge,
  type LeagueContext, type LeagueTeam, type StartAvailability,
} from '../league/LeagueContext'
import { CommandCenterProjector } from '../player/CommandCenterProjector'
import { DefenseLookup } from '../player/DefenseLookup'

// MARK: - Steps

/** The Trade Desk's four steps, in order. */
export type TradeStep = 'goal' | 'partner' | 'deal' | 'approach'

/** Swift's `TradeStep.allCases`; the index is the raw value. */
export const TRADE_STEPS: readonly TradeStep[] = ['goal', 'partner', 'deal', 'approach']

export const TRADE_STEP_TITLE: Readonly<Record<TradeStep, string>> = {
  goal: 'What you need',
  partner: 'Who has it',
  deal: 'Build the deal',
  approach: 'Approach',
}

export const tradeStepTitle = (s: TradeStep) => TRADE_STEP_TITLE[s]

// MARK: - Basis

/**
 * How the two sides of a deal are compared. Named on screen every time, with
 * its season, and never folded into a verdict (§6).
 */
export type TradeBasis =
  /** This season's points per game from Sleeper's own lines, completed weeks only. Covers every position, DEF and IDP included. */
  | 'thisSeason'
  /** This week's projection (Rotowire via Sleeper) in the league's scoring. */
  | 'projectedWeek'
  /** The app's own rest-of-season projection: this season's pace regressed toward last, usage, and the remaining schedule. */
  | 'restOfSeason'
  /** The stats season's nflverse production — last season until the current one has three weeks. */
  | 'production'
  /** The stats season's last four games. */
  | 'form'
  /** Points per game over a startable player at his position, on the desk's primary basis, with superflex demand counted. */
  | 'overStartLine'

/** Swift's `TradeBasis.allCases`, in declaration order. */
export const TRADE_BASES: readonly TradeBasis[] = ['thisSeason', 'projectedWeek', 'restOfSeason', 'production', 'form', 'overStartLine']

// MARK: - Value types

/** Something the manager could trade for, drawn from their own needs. */
export interface TradeGoal {
  id: string
  positions: ReadonlySet<Position>
  /** The weeks the goal is about. Empty means every week — an upgrade. */
  weeks: number[]
  title: string
  detail: string
  /** The starter an upgrade goal would replace, whose value a target must beat. */
  upgradeOverID?: string
}

export const goalPositionLabel = (g: TradeGoal) => [...g.positions].sort().join('/')

/** Swift's synthesized `Hashable` equality for `TradeGoal`. */
export function goalsEqual(a: TradeGoal | undefined, b: TradeGoal | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.id === b.id && setsEqual(a.positions, b.positions) && arraysEqual(a.weeks, b.weeks)
    && a.title === b.title && a.detail === b.detail && a.upgradeOverID === b.upgradeOverID
}

/** A player as the desk shows him. */
export interface TradePlayer {
  id: string
  name: string
  position?: Position
  team?: string
  /** His value on every basis the desk could value him on. */
  values: Partial<Record<TradeBasis, number>>
  /** A bench player his team can spare without breaking a lineup. */
  isSurplus: boolean
  isStarter: boolean
  /** Parked in an IR slot: tradeable, but not depth and not a spare. */
  isReserve: boolean
  availability: StartAvailability
}

export const tradePlayerValue = (p: TradePlayer, basis: TradeBasis): number | undefined => p.values[basis]

/** "Q", "Out", "IR"… for a badge; `undefined` when healthy. */
export const injuryBadge = (p: TradePlayer) => startBadge(p.availability)

export type PartnerFitKind =
  | 'mutual'
  | 'oneWay'
  /** Picked by the manager, not matched: shown whatever the fit. */
  | 'chosen'

const KIND_RANK: Readonly<Record<PartnerFitKind, number>> = { mutual: 0, oneWay: 1, chosen: 2 }

/** A rival who has what the goal needs, and whether you have something they need. */
export interface PartnerFit {
  rival: LeagueTeam
  kind: PartnerFitKind
  /** Their players that meet the goal, surplus first. */
  theirOffer: TradePlayer[]
  /** Your spare players at a position they need. */
  yourOffer: TradePlayer[]
  /** Named reasons, both directions. */
  facts: string[]
  grade?: TeamGrade
}

export const partnerFitID = (f: PartnerFit) => f.rival.rosterID

/** One week's shortfall before and after a proposed deal. */
export interface ShortfallChange {
  week: number
  before: number
  after: number
}

/** One team's side of a deal: its best lineup and roster room, before and after. */
export interface DealSide {
  /** Best lineup this week on the active basis, counting only valued starters. */
  lineupBefore?: number
  lineupAfter?: number
  /** Active (non-IR) roster count after the deal, and the league's limit. */
  rosterAfter: number
  rosterLimit: number
  /** Playoff weeks with an unfilled slot, before and after. */
  playoffShortBefore: number
  playoffShortAfter: number
  gradeBefore?: TeamGrade
  gradeAfter?: TeamGrade
}

export function lineupDelta(side: DealSide): number | undefined {
  if (side.lineupBefore === undefined || side.lineupAfter === undefined) return undefined
  return roundAwayFromZero((side.lineupAfter - side.lineupBefore) * 10) / 10
}

/** Players this team would have to drop to fit. */
export const mustDrop = (side: DealSide) => Math.max(0, side.rosterAfter - side.rosterLimit)

export const EMPTY_DEAL_SIDE: DealSide = {
  rosterAfter: 0, rosterLimit: 0, playoffShortBefore: 0, playoffShortAfter: 0,
}

/** What a proposed deal does, stated as facts. */
export interface DealEffects {
  /** Your remaining weeks where either side of the deal leaves a shortfall. */
  yourWeeks: ShortfallChange[]
  theirWeeks: ShortfallChange[]
  you: DealSide
  them: DealSide
  /**
   * Things the deal fixes for you, and for them. Only the rival's go in the
   * pitch — your own reasons are your negotiating position.
   */
  yourGains: string[]
  theirGains: string[]
  warnings: string[]
}

export const EMPTY_DEAL_EFFECTS: DealEffects = {
  yourWeeks: [], theirWeeks: [], you: EMPTY_DEAL_SIDE, them: EMPTY_DEAL_SIDE,
  yourGains: [], theirGains: [], warnings: [],
}

/** Whether trades are still allowed, from the league's own setting. */
export type TradeWindow =
  | { kind: 'noDeadline' }
  | { kind: 'open'; deadlineWeek: number; weeksLeft: number }
  | { kind: 'closed'; deadlineWeek: number }

export const isWindowClosed = (w: TradeWindow) => w.kind === 'closed'

export function tradeWindowLabel(w: TradeWindow): string | undefined {
  switch (w.kind) {
    case 'noDeadline': return undefined
    case 'open':
      if (w.weeksLeft === 0) return `Trade deadline is this week (week ${w.deadlineWeek})`
      if (w.weeksLeft === 1) return `1 week until the trade deadline (week ${w.deadlineWeek})`
      return `${w.weeksLeft} weeks until the trade deadline (week ${w.deadlineWeek})`
    case 'closed': return `Your league's trade deadline was week ${w.deadlineWeek}. Trades are closed.`
  }
}

/**
 * Sleeper's `trade_deadline` is the last week trades are allowed, so the
 * deadline week itself is open. 0 means no deadline, and so does 99 —
 * Sleeper's "never" for leagues that set the deadline past the season.
 */
export function tradeWindowFrom(deadline: number | undefined, currentWeek: number): TradeWindow {
  if (deadline === undefined || !(deadline > 0) || !(deadline < 99)) return { kind: 'noDeadline' }
  if (currentWeek > deadline) return { kind: 'closed', deadlineWeek: deadline }
  return { kind: 'open', deadlineWeek: deadline, weeksLeft: deadline - currentWeek }
}

/** Where the desk starts when opened from somewhere with context. */
export interface TradeWizardPrefill {
  positions?: ReadonlySet<Position>
  weeks?: number[]
  rivalRosterID?: number
  theirPlayerID?: string
  /** One of your players to offer, kept on the "you send" side whichever partner is picked. */
  myPlayerID?: string
}

/** A player on a rival's roster, found by name. */
export interface TradeSearchResult {
  player: TradePlayer
  rival: LeagueTeam
}

export const tradeSearchResultID = (r: TradeSearchResult) => r.player.id

export interface TradeWizardOptions {
  relay?: RelayClient
  secrets?: SecretStore
  prefill?: TradeWizardPrefill
}

type DealSwap = { me: number; rival: number; sending: ReadonlySet<string>; receiving: ReadonlySet<string> }

const INT_MAX = Number.MAX_SAFE_INTEGER

// MARK: - The model

export class TradeWizardModel extends Observable {
  readonly context: LeagueContext
  readonly window: TradeWindow

  private stepValue: TradeStep = 'goal'
  get step(): TradeStep { return this.stepValue }
  set step(value: TradeStep) {
    this.stepValue = value
    this.changed()
  }

  goals: TradeGoal[] = []
  goal?: TradeGoal
  partners: PartnerFit[] = []
  partner?: PartnerFit
  sending: ReadonlySet<string> = new Set()
  receiving: ReadonlySet<string> = new Set()

  private basisValue: TradeBasis
  get basis(): TradeBasis { return this.basisValue }
  /** Setting the basis regrades and recomputes, as Swift's `didSet` does. */
  set basis(value: TradeBasis) {
    const old = this.basisValue
    this.basisValue = value
    if (value !== old) {
      this.recomputeGrades()
      this.recomputeEffects()
    }
    this.changed()
  }

  effects: DealEffects = EMPTY_DEAL_EFFECTS
  polishedPitch?: string
  isPolishing = false
  polishError?: string
  /**
   * Set when a request to open the desk on a team or player couldn't be
   * followed exactly, saying what happened instead.
   */
  prefillNote?: string
  /** League-relative grades on the active basis, by roster id. */
  grades: Map<number, TeamGrade> = new Map()
  /** False until the rest-of-season projection has been built. */
  restOfSeasonReady = false

  static readonly partnerSortRule =
    'Sorted by: both of you have something the other needs, then one-way fits, then their best spare player.'

  /**
   * The basis needs, surplus and start lines are measured on: this season
   * once it has completed weeks, the stats season before that.
   */
  readonly primaryBasis: TradeBasis

  private readonly relay?: RelayClient
  private readonly secrets: SecretStore
  private readonly profiles: Map<string, SeasonProfile>
  private readonly thisSeason: Map<string, number>
  private restOfSeason = new Map<string, number>()
  private readonly startLines: Baselines
  private myNeeds: TeamNeeds
  private needsByRoster = new Map<number, TeamNeeds>()
  private polishGeneration = 0
  /** A player the manager asked to offer, applied to every partner picked. */
  private pendingSend?: string

  constructor(context: LeagueContext, options: TradeWizardOptions = {}) {
    super()
    this.context = context
    this.relay = options.relay
    this.secrets = options.secrets ?? new LocalStorageSecretStore()
    this.window = tradeWindowFrom(
      context.leagueFacts.tradeDeadlineWeek ?? effectiveTradeDeadline(context.league.settings),
      context.currentWeek,
    )

    const byGSIS = new Map<string, SeasonProfile>()
    for (const p of context.seasonProfiles) if (!byGSIS.has(p.gsisID)) byGSIS.set(p.gsisID, p)
    this.profiles = new Map()
    for (const [gsis, sleeper] of Object.entries(context.sleeperIDsByGSIS)) {
      const profile = byGSIS.get(gsis)
      if (profile) this.profiles.set(sleeper, profile)
    }
    const { values: season, games } = TradeWizardModel.thisSeasonValues(context)
    this.thisSeason = season
    const primary: TradeBasis = season.size === 0 ? 'production' : 'thisSeason'
    this.primaryBasis = primary
    this.basisValue = primary

    // Start lines on the primary basis, with flex slots charged to the
    // positions managers actually start there (superflex QBs above all).
    const flexDemand = observedFlexDemand(
      context.template,
      context.teams.map((team) => team.rawStarters.map((id) => (id === EMPTY_STARTER_SLOT ? undefined : context.position(id)))),
    )
    const byPosition: Partial<Record<Position, number[]>> = {}
    if (primary === 'thisSeason') {
      const minimumGames = Math.min(MINIMUM_GAMES_FOR_LINE, TradeWizardModel.completedWeeks(context).length)
      for (const [id, value] of season) {
        if ((games.get(id) ?? 0) < Math.max(1, minimumGames)) continue
        const position = context.position(id)
        if (position) (byPosition[position] ??= []).push(value)
      }
    } else {
      for (const profile of context.seasonProfiles) {
        if (profile.games >= MINIMUM_GAMES_FOR_LINE) (byPosition[profile.position] ??= []).push(profile.pointsPerGame)
      }
    }
    this.startLines = baselineLines(byPosition, context.template, Math.max(context.teams.length, 1), flexDemand)
    this.myNeeds = { needs: [], surplus: [] }

    const primaryValues = this.valueMap(primary)
    for (const team of context.teams) {
      this.needsByRoster.set(team.rosterID, TradeWizardModel.needs(team, context, primaryValues, this.startLines))
    }
    this.myNeeds = this.needsByRoster.get(context.userRosterID) ?? { needs: [], surplus: [] }
    this.goals = this.buildGoals()
    this.recomputeGrades()

    if (options.prefill) this.apply(options.prefill)
  }

  /**
   * Builds the rest-of-season projection. The desk works without it; the
   * basis just says it isn't ready.
   */
  async prepare(): Promise<void> {
    if (this.restOfSeasonReady) return
    const context = this.context
    const ids = new Set(context.teams.flatMap((t) => t.roster.map((e) => e.id)))
    // Swift runs this off the main actor; yield once so callers see the same ordering.
    await Promise.resolve()
    const projector = new CommandCenterProjector(context, DefenseLookup.build(context))
    const values = new Map<string, number>()
    for (const id of ids) {
      const value = projector.project(id)?.restOfSeasonPerGame
      if (value !== undefined) values.set(id, value)
    }
    this.restOfSeason = values
    this.restOfSeasonReady = true
    if (this.basis === 'restOfSeason') {
      this.recomputeGrades()
      this.recomputeEffects()
    }
    this.changed()
  }

  // MARK: - Values

  static completedWeeks(context: LeagueContext): number[] {
    return [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => a - b)
  }

  /**
   * This season's points per game from completed weeks only, so a game in
   * progress can't swing a trade value.
   */
  static thisSeasonValues(context: LeagueContext): { values: Map<string, number>; games: Map<string, number> } {
    const scoring = context.league.scoringSettings ?? {}
    const total = new Map<string, number>()
    const games = new Map<string, number>()
    for (const week of TradeWizardModel.completedWeeks(context)) {
      for (const [id, line] of context.inSeason.weekStats.get(week) ?? new Map()) {
        if (!played(line)) continue
        total.set(id, (total.get(id) ?? 0) + scoreLine(line, scoring).points)
        games.set(id, (games.get(id) ?? 0) + 1)
      }
    }
    const values = new Map<string, number>()
    for (const [id, sum] of total) values.set(id, sum / (games.get(id) ?? 1))
    return { values, games }
  }

  /** A player's value on one basis; `undefined` means "can't value", never zero. */
  value(id: string, basis: TradeBasis): number | undefined {
    switch (basis) {
      case 'thisSeason': return this.thisSeason.get(id)
      case 'projectedWeek': return this.context.projectedPoints(id)
      case 'restOfSeason': return this.restOfSeason.get(id)
      case 'production': return this.profiles.get(id)?.pointsPerGame
      case 'form': return this.profiles.get(id)?.formPointsPerGame
      case 'overStartLine': {
        const value = this.value(id, this.primaryBasis)
        const position = this.context.position(id) ?? this.profiles.get(id)?.position
        const line = position ? this.startLines[position]?.startLine : undefined
        if (value === undefined || line === undefined) return undefined
        return value - line
      }
    }
  }

  valueMap(basis: TradeBasis): Record<string, number> {
    const out: Record<string, number> = {}
    for (const team of this.context.teams) {
      for (const entry of team.roster) {
        const value = this.value(entry.id, basis)
        if (value !== undefined) out[entry.id] = value
      }
    }
    return out
  }

  /** What the basis is, in words, with its season — shown with every number. */
  label(basis: TradeBasis): string {
    switch (basis) {
      case 'thisSeason': return `${this.context.scheduleSeason} pts/gm`
      case 'projectedWeek': return `Week ${this.context.currentWeek} projection`
      case 'restOfSeason': return 'Rest of season'
      case 'production': return `${this.context.statsSeason} season pts/gm`
      case 'form': return `Last 4 of ${this.context.statsSeason}`
      case 'overStartLine': return 'Over start line'
    }
  }

  hint(basis: TradeBasis): string {
    switch (basis) {
      case 'thisSeason': {
        const weeks = TradeWizardModel.completedWeeks(this.context)
        const span = weeks.length === 0 ? 'no completed weeks yet'
          : weeks.length === 1 ? `week ${weeks[0]}` : `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`
        return `Sleeper's own ${this.context.scheduleSeason} lines in your scoring, ${span} — covers DEF and IDP`
      }
      case 'projectedWeek': return `Rotowire's week ${this.context.currentWeek} stat line via Sleeper, in your scoring`
      case 'restOfSeason':
        return this.restOfSeasonReady
          ? 'our own: this season regressed toward last, usage, and the remaining schedule'
          : 'still being built — a moment'
      case 'production': return `nflverse production from ${this.context.statsSeason}, in your scoring — no DEF or IDP`
      case 'form': return `the last four games of ${this.context.statsSeason}`
      case 'overStartLine':
        return `${this.label(this.primaryBasis).toLowerCase()} above a startable player at his position — superflex QBs counted`
    }
  }

  /** Bases worth offering: those that can value someone right now. */
  get availableBases(): TradeBasis[] {
    return TRADE_BASES.filter((basis) => {
      switch (basis) {
        case 'thisSeason': return this.thisSeason.size > 0
        case 'projectedWeek': return hasProjections(this.context.inSeason)
        case 'restOfSeason': return true
        case 'production':
        case 'form': return this.profiles.size > 0
        case 'overStartLine': return Object.keys(this.startLines).length > 0
      }
    })
  }

  // MARK: - Rosters

  /** A team's roster without its IR slots — the players who count as depth. */
  static activeRoster(team: LeagueTeam): RosterEntry[] {
    const reserve = new Set(team.reserveIDs)
    return team.roster.filter((e) => !reserve.has(e.id))
  }

  static needs(team: LeagueTeam, context: LeagueContext, values: Record<string, number>, lines: Baselines): TeamNeeds {
    return buildTeamNeeds({
      roster: TradeWizardModel.activeRoster(team),
      starters: team.rawStarters,
      template: context.template,
      values,
      baselines: lines,
      calendar: context.byeCalendar,
      weeks: context.remainingWeeks,
      includeFlexStarters: true,
    })
  }

  /** Active roster spots a team can hold: every starting slot plus the bench. */
  get rosterLimit(): number { return totalStarterSlots(this.context.template) + this.context.template.benchCount }

  // MARK: - Step 1: goals

  /** Positions the manager can pick directly, in template order. */
  get pickablePositions(): Position[] {
    const seen = new Set<Position>()
    const out: Position[] = []
    for (const slot of this.context.template.starters) {
      for (const position of [...slot.eligible].sort()) {
        if (seen.has(position)) continue
        seen.add(position)
        out.push(position)
      }
    }
    return out
  }

  /**
   * Soonest problem week first; within a week, a dedicated slot before a
   * flex. Upgrades come after every short week, weakest starter first.
   */
  buildGoals(): TradeGoal[] {
    const key = (need: Need): [number, number, number] => {
      switch (need.kind.kind) {
        case 'shortWeeks': return [need.kind.weeks.length ? Math.min(...need.kind.weeks) : INT_MAX, need.viaFlex ? 1 : 0, 0]
        case 'weakStarter': return [INT_MAX, 0, -need.kind.gap]
      }
    }
    const ordered = [...this.myNeeds.needs].sort((a, b) => {
      const ka = key(a), kb = key(b)
      if (ka[0] !== kb[0]) return ka[0] - kb[0]
      if (ka[1] !== kb[1]) return ka[1] - kb[1]
      return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0
    })
    const unit = this.primaryBasis === 'thisSeason' ? 'pts/gm this season' : `pts/gm in ${this.context.statsSeason}`
    return ordered.map((need): TradeGoal => {
      const label = [...need.positions].sort().join('/')
      switch (need.kind.kind) {
        case 'shortWeeks': {
          const weeks = need.kind.weeks
          const weekText = TradeWizardModel.weekList(weeks)
          if (need.viaFlex) {
            return {
              id: needID(need), positions: need.positions, weeks,
              title: `Flex depth (${label}) for ${weekText}`,
              detail: `You can't fill a flex spot in ${weekText}.`,
            }
          }
          return {
            id: needID(need), positions: need.positions, weeks,
            title: `${label} depth for ${weekText}`,
            detail: `You can't fill every ${label} slot in ${weekText}.`,
          }
        }
        case 'weakStarter': {
          const { playerID: id, gap } = need.kind
          const name = this.context.playerName(id) ?? id
          const position = this.context.position(id) ?? label
          return {
            id: needID(need), positions: need.positions, weeks: [],
            title: need.viaFlex ? `Upgrade your flex ${position}` : `Upgrade ${label}`,
            detail: `Your starter ${name} is ${TradeWizardModel.oneDecimal(gap)} ${unit} below the ${position} start line.`,
            upgradeOverID: id,
          }
        }
      }
    })
  }

  /**
   * The partners a goal would find, without choosing it — for a workspace
   * panel that previews needs while the Trades screen keeps its own place.
   */
  previewPartners(goal: TradeGoal): PartnerFit[] {
    return this.buildPartners(goal)
  }

  /** Picks a goal. Choosing the goal already in progress keeps the deal. */
  chooseGoal(goal: TradeGoal): void {
    if (goalsEqual(goal, this.goal)) {
      this.step = 'partner'
      return
    }
    this.goal = goal
    this.partners = this.buildPartners(goal)
    this.partner = undefined
    this.sending = new Set()
    this.receiving = new Set()
    this.dealEdited()
    this.step = 'partner'
  }

  /** A goal the manager picked by position rather than from their needs. */
  choosePosition(position: Position): void {
    const existing = this.goals.find((g) => g.positions.size === 1 && g.positions.has(position) && g.weeks.length > 0)
    this.chooseGoal(existing ?? this.anyGoal(position))
  }

  private anyGoal(position: Position): TradeGoal {
    return {
      id: `pick-${position}`, positions: new Set([position]), weeks: [],
      title: `Any ${position}`,
      detail: `You picked ${position} yourself.`,
    }
  }

  // MARK: - Step 2: partners

  buildPartners(goal: TradeGoal): PartnerFit[] {
    const context = this.context
    const primary = this.primaryBasis
    const bar = goal.upgradeOverID !== undefined ? this.value(goal.upgradeOverID, primary) : undefined

    const fits: PartnerFit[] = []
    for (const rival of context.rivals) {
      const theirNeeds = this.needsByRoster.get(rival.rosterID)
      if (!theirNeeds) continue
      const surplusIDs = new Set(theirNeeds.surplus.map((s) => s.playerID))
      const starters = new Set(rival.starterIDs)

      const offer: TradePlayer[] = []
      for (const entry of TradeWizardModel.activeRoster(rival)) {
        const position = entry.position
        if (!position || !goal.positions.has(position)) continue
        if (blocksStart(startAvailability(entry.id, context))) continue
        if (goal.weeks.length > 0) {
          // Must play at least one of the weeks, and be spare.
          if (!surplusIDs.has(entry.id) || !goal.weeks.some((w) => !context.byeCalendar.isOnBye(entry.team, w))) continue
        } else if (bar !== undefined) {
          // An upgrade must beat the starter it replaces.
          const value = this.value(entry.id, primary)
          if (value === undefined || !(value > bar)) continue
        } else if (!surplusIDs.has(entry.id)) {
          continue
        }
        offer.push(this.player(entry.id, surplusIDs.has(entry.id), starters.has(entry.id)))
      }
      offer.sort(this.surplusFirstOrder)
      if (offer.length === 0) continue

      const [yourOffer, needFacts] = this.yourOffer(rival, goal)

      const facts: string[] = []
      const spareCount = offer.filter((p) => p.isSurplus).length
      if (spareCount > 0) {
        const positions = goalPositionLabel(goal)
        const verb = spareCount === 1 ? 'plays' : 'play'
        const weeks = goal.weeks.length === 0 ? '' : ` who ${verb} ${TradeWizardModel.weekList(goal.weeks)}`
        facts.push(`Has ${spareCount} spare ${positions}${spareCount === 1 ? '' : 's'}${weeks}`)
      }
      const best = offer[0]
      const bestValue = best ? tradePlayerValue(best, primary) : undefined
      if (bar !== undefined && best && bestValue !== undefined) {
        facts.push(`${best.name} averages ${TradeWizardModel.oneDecimal(bestValue - bar)} more ${this.unitPhrase} than your starter`)
      }
      facts.push(...needFacts)

      const fit: PartnerFit = {
        rival,
        kind: yourOffer.length === 0 ? 'oneWay' : 'mutual',
        theirOffer: offer,
        yourOffer,
        facts,
      }
      const grade = this.grades.get(rival.rosterID)
      if (grade) fit.grade = grade
      fits.push(fit)
    }
    const top = (f: PartnerFit) => (f.theirOffer[0] ? tradePlayerValue(f.theirOffer[0], primary) : undefined) ?? -1
    return fits.sort(comparator((a, b) => {
      if (a.kind !== b.kind) return KIND_RANK[a.kind] < KIND_RANK[b.kind]
      return top(a) > top(b)
    }))
  }

  /** Your spare, healthy players at positions a rival needs, with the reasons. */
  private yourOffer(rival: LeagueTeam, goal: TradeGoal | undefined): [TradePlayer[], string[]] {
    const theirNeeds = this.needsByRoster.get(rival.rosterID)
    if (!theirNeeds) return [[], []]
    const context = this.context
    const offer: TradePlayer[] = []
    const facts: string[] = []
    for (const need of theirNeeds.needs) {
      const matches = this.myNeeds.surplus.filter((spare) => {
        if (!need.positions.has(spare.position) || blocksStart(startAvailability(spare.playerID, context))) return false
        const weeks = needWeeks(need)
        if (weeks) return weeks.some((w) => spare.playsWeeks.includes(w))
        if (need.kind.kind === 'weakStarter') {
          const theirs = this.value(need.kind.playerID, this.primaryBasis)
          if (theirs !== undefined) return (spare.value ?? -1) > theirs
        }
        return false
      })
      const best = matches[0]
      if (!best) continue
      const label = [...need.positions].sort().join('/')
      const bestName = context.playerName(best.playerID) ?? best.playerID
      switch (need.kind.kind) {
        case 'shortWeeks':
          facts.push(`Short at ${label} in ${TradeWizardModel.weekList(need.kind.weeks)} — you have a spare ${best.position} (${bestName})`)
          break
        case 'weakStarter':
          facts.push(`Their ${label} starter is below the start line — ${bestName} would start for them`)
          break
      }
      for (const match of matches) {
        if (offer.some((p) => p.id === match.playerID)) continue
        offer.push(this.player(match.playerID, true, false))
      }
    }
    // Sending a player at the position you're trading for makes the hole
    // worse, so those come last.
    const positions: ReadonlySet<Position> = goal?.positions ?? new Set()
    const sorted = [...offer].sort(comparator((a, b) => {
      const aHurts = a.position !== undefined ? positions.has(a.position) : false
      const bHurts = b.position !== undefined ? positions.has(b.position) : false
      if (aHurts !== bHurts) return !aHurts
      return this.surplusFirst(a, b)
    }))
    return [sorted, facts]
  }

  /**
   * Any rival as a partner, whatever the fit — for a team or player the
   * manager picked directly.
   */
  chosenFit(rival: LeagueTeam, goal: TradeGoal | undefined): PartnerFit {
    const surplusIDs = new Set(this.needsByRoster.get(rival.rosterID)?.surplus.map((s) => s.playerID) ?? [])
    const starters = new Set(rival.starterIDs)
    const offer = rival.roster
      .filter((entry) => (goal ? (entry.position !== undefined ? goal.positions.has(entry.position) : false) : true))
      .map((e) => this.player(e.id, surplusIDs.has(e.id), starters.has(e.id)))
      .sort(this.surplusFirstOrder)
    const [yourOffer, facts] = this.yourOffer(rival, goal)
    const fit: PartnerFit = {
      rival, kind: 'chosen', theirOffer: offer, yourOffer,
      facts: [`You picked ${rival.manager}.`, ...facts],
    }
    const grade = this.grades.get(rival.rosterID)
    if (grade) fit.grade = grade
    return fit
  }

  /** Picks a partner. Choosing the partner already in progress keeps the deal. */
  choosePartner(partner: PartnerFit): void {
    if (partner.rival.rosterID === this.partner?.rival.rosterID) {
      this.step = 'deal'
      return
    }
    this.partner = partner
    // Start from the most obvious deal: their best healthy fit for yours.
    const first = partner.theirOffer.find((p) => !p.isReserve)
    this.receiving = new Set(first ? [first.id] : [])
    const mine = this.pendingSend ?? partner.yourOffer[0]?.id
    this.sending = new Set(mine !== undefined ? [mine] : [])
    this.dealEdited()
    this.step = 'deal'
  }

  // MARK: - Finding a player

  /** Any player on any rival's roster, by forgiving name search. */
  search(query: string, limit = 20): TradeSearchResult[] {
    const trimmed = trimWhitespace(query)
    if (!trimmed) return []
    const context = this.context
    const scored: [TradeSearchResult, number][] = []
    for (const rival of context.rivals) {
      const starters = new Set(rival.starterIDs)
      for (const entry of rival.roster) {
        const name = context.playerName(entry.id)
        if (name === undefined) continue
        const team = entry.team !== undefined ? nflverseTeam(entry.team) : undefined
        const extra = [team, teamName(team), rival.manager].filter((s): s is string => s !== undefined)
        const score = fuzzyScore(trimmed, name, extra)
        if (score === undefined) continue
        scored.push([{ player: this.player(entry.id, false, starters.has(entry.id)), rival }, score])
      }
    }
    const v = (r: TradeSearchResult) => tradePlayerValue(r.player, this.primaryBasis) ?? -1
    return scored
      .sort(comparator((a, b) => (a[1] !== b[1] ? a[1] > b[1] : v(a[0]) > v(b[0]))))
      .slice(0, Math.max(0, limit))
      .map(([r]) => r)
  }

  /** Jumps straight to a deal for one rival's player. */
  target(result: TradeSearchResult): void {
    const position = result.player.position
    const goal = (position !== undefined ? this.goals.find((g) => g.positions.has(position)) : undefined)
      ?? (position !== undefined ? this.anyGoal(position) : undefined)
    if (goal && !goalsEqual(goal, this.goal)) {
      this.goal = goal
      this.partners = this.buildPartners(goal)
    }
    const fit = this.partners.find((f) => f.rival.rosterID === result.rival.rosterID) ?? this.chosenFit(result.rival, undefined)
    this.partner = undefined
    this.choosePartner(fit)
    this.receiving = new Set([result.player.id])
    this.dealEdited()
  }

  // MARK: - Step 3: the deal

  /** Your players, spare ones first, IR last. */
  get yourPlayers(): TradePlayer[] {
    const team = this.context.userTeam
    if (!team) return []
    const spare = new Set(this.myNeeds.surplus.map((s) => s.playerID))
    const starters = new Set(team.starterIDs)
    return team.roster
      .map((e) => this.player(e.id, spare.has(e.id), starters.has(e.id)))
      .sort(this.surplusFirstOrder)
  }

  /** Their players, spare ones first, IR last. */
  get theirPlayers(): TradePlayer[] {
    const partner = this.partner
    if (!partner) return []
    const spare = new Set(this.needsByRoster.get(partner.rival.rosterID)?.surplus.map((s) => s.playerID) ?? [])
    const starters = new Set(partner.rival.starterIDs)
    return partner.rival.roster
      .map((e) => this.player(e.id, spare.has(e.id), starters.has(e.id)))
      .sort(this.surplusFirstOrder)
  }

  toggleSending(id: string): void {
    const next = new Set(this.sending)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.sending = next
    this.dealEdited()
  }

  toggleReceiving(id: string): void {
    const next = new Set(this.receiving)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    this.receiving = next
    this.dealEdited()
  }

  /**
   * Any change to the deal voids a pitch written for the old one — and any
   * rewrite still in flight for it.
   */
  private dealEdited(): void {
    this.polishGeneration += 1
    this.polishedPitch = undefined
    this.polishError = undefined
    this.isPolishing = false
    this.recomputeEffects()
    this.changed()
  }

  get canApproach(): boolean {
    return this.partner !== undefined && this.sending.size > 0 && this.receiving.size > 0 && !isWindowClosed(this.window)
  }

  /**
   * One side's total on the active basis, counting only players it can
   * value. `undefined` when it can value nobody on that side. Context for the
   * lineup change, not a verdict: two bench players don't add up to a starter.
   */
  total(ids: ReadonlySet<string>): { value: number; counted: number; of: number } | undefined {
    const valued = [...ids].map((id) => this.value(id, this.basis)).filter((v): v is number => v !== undefined)
    if (valued.length === 0) return undefined
    return { value: valued.reduce((s, v) => s + v, 0), counted: valued.length, of: ids.size }
  }

  recomputeEffects(): void {
    const partner = this.partner
    const me = this.context.userTeam
    this.effects = partner && me ? this.dealEffects(me, partner.rival) : EMPTY_DEAL_EFFECTS
  }

  // MARK: - Lineups and grades

  /**
   * A player's value in this week's lineup on the active basis: nothing if
   * his team is on bye or he can't start.
   */
  private lineupValue(id: string, team: string | undefined): number | undefined {
    const context = this.context
    if (context.byeCalendar.isOnBye(context.nflTeam(id) ?? team, context.currentWeek)) return undefined
    if (blocksStart(startAvailability(id, context))) return undefined
    return this.value(id, this.basis)
  }

  /** Best lineup points from a set of players, counting only valued starters. */
  bestLineup(ids: readonly string[], starters: readonly string[], teamOf: ReadonlyMap<string, string>): number | undefined {
    const context = this.context
    const proposal = optimizeLineup({
      currentStarterIDs: starters, playerIDs: ids, template: context.template,
      positions: (id) => context.position(id) ?? this.profiles.get(id)?.position,
      valueOf: (id) => this.lineupValue(id, teamOf.get(id)),
      locked: new Set(ids.filter((id) => context.isLocked(id))),
    })
    const idSet = new Set(ids)
    let total = 0
    let counted = 0
    proposal.proposedIDs.forEach((proposed, index) => {
      const chosen = proposed ?? (index < starters.length ? starters[index] : undefined)
      if (chosen === undefined || chosen === EMPTY_STARTER_SLOT || !idSet.has(chosen)) return
      const v = this.lineupValue(chosen, teamOf.get(chosen))
      if (v === undefined) return
      total += v
      counted += 1
    })
    return counted > 0 ? roundAwayFromZero(total * 10) / 10 : undefined
  }

  private shortWeeks(roster: readonly RosterEntry[], weeks: readonly number[]): number {
    let count = 0
    for (const report of crunchOutlook(roster, this.context.template, this.context.byeCalendar, weeks).values()) {
      if (report.totalShortfall > 0) count++
    }
    return count
  }

  /** Grades every team on the active basis. */
  recomputeGrades(): void {
    this.grades = this.gradeLeague(undefined)
  }

  /** League grades, optionally with a deal applied to two rosters. */
  private gradeLeague(deal: DealSwap | undefined): Map<number, TeamGrade> {
    const context = this.context
    const weeks = context.remainingWeeks
    const inputs = context.teams.map((team): TeamGradeInput => {
      let roster = TradeWizardModel.activeRoster(team)
      let starters = team.rawStarters
      if (deal) {
        const allEntries = context.teams.flatMap((t) => t.roster)
        if (team.rosterID === deal.me) {
          roster = [...roster.filter((e) => !deal.sending.has(e.id)), ...allEntries.filter((e) => deal.receiving.has(e.id))]
          starters = starters.map((id) => (deal.sending.has(id) ? EMPTY_STARTER_SLOT : id))
        } else if (team.rosterID === deal.rival) {
          roster = [...roster.filter((e) => !deal.receiving.has(e.id)), ...allEntries.filter((e) => deal.sending.has(e.id))]
          starters = starters.map((id) => (deal.receiving.has(id) ? EMPTY_STARTER_SLOT : id))
        }
      }
      const teamOf = teamMap(roster)
      const input: TeamGradeInput = {
        rosterID: team.rosterID,
        shortWeeks: this.shortWeeks(roster, weeks),
        remainingWeeks: weeks.length,
      }
      const lineupPoints = this.bestLineup(roster.map((e) => e.id), starters, teamOf)
      if (lineupPoints !== undefined) input.lineupPoints = lineupPoints
      return input
    })
    return new Map(gradeTeams(inputs).map((g) => [g.rosterID, g]))
  }

  /** The deal's consequences, computed on the proposed rosters. */
  dealEffects(me: LeagueTeam, rival: LeagueTeam): DealEffects {
    const context = this.context
    const sending = this.sending
    const receiving = this.receiving
    const weeks = context.remainingWeeks
    const playoff = playoffWeeks(context.leagueFacts).filter((w) => weeks.includes(w))
    const myActive = TradeWizardModel.activeRoster(me), theirActive = TradeWizardModel.activeRoster(rival)
    const myOut = me.roster.filter((e) => sending.has(e.id))
    const theirOut = rival.roster.filter((e) => receiving.has(e.id))
    const myAfter = [...myActive.filter((e) => !sending.has(e.id)), ...theirOut]
    const theirAfter = [...theirActive.filter((e) => !receiving.has(e.id)), ...myOut]

    const outlook = (roster: readonly RosterEntry[]) => crunchOutlook(roster, context.template, context.byeCalendar, weeks)
    const myBefore = outlook(myActive), myAfterReport = outlook(myAfter)
    const theirBefore = outlook(theirActive), theirAfterReport = outlook(theirAfter)

    const changes = (before: Map<number, CrunchReport>, after: Map<number, CrunchReport>): ShortfallChange[] => {
      const out: ShortfallChange[] = []
      for (const week of weeks) {
        const b = before.get(week)?.totalShortfall ?? 0
        const a = after.get(week)?.totalShortfall ?? 0
        if (a > 0 || b > 0) out.push({ week, before: b, after: a })
      }
      return out
    }
    const shortIn = (report: Map<number, CrunchReport>, list: readonly number[]) =>
      list.filter((w) => (report.get(w)?.totalShortfall ?? 0) > 0).length
    const yourWeeks = changes(myBefore, myAfterReport)
    const theirWeeks = changes(theirBefore, theirAfterReport)

    const positions = (report: CrunchReport | undefined): string => {
      if (!report) return ''
      const dedicated = [...shortDedicatedPositions(report)].sort()
      return (dedicated.length === 0 ? ['FLEX'] : dedicated).join('/')
    }

    const yourGains: string[] = []
    const theirGains: string[] = []
    const warnings: string[] = []

    for (const change of yourWeeks) {
      if (change.after < change.before) {
        const what = positions(myBefore.get(change.week))
        yourGains.push(change.after === 0
          ? `Fixes my ${what} hole in week ${change.week}`
          : `Narrows my week ${change.week} shortfall from ${change.before} to ${change.after}`)
      } else if (change.after > change.before) {
        warnings.push(`Leaves you short at ${positions(myAfterReport.get(change.week))} in week ${change.week}`)
      }
    }
    for (const change of theirWeeks) {
      if (change.after < change.before) {
        const what = positions(theirBefore.get(change.week))
        theirGains.push(change.after === 0
          ? `Covers their ${what} hole in week ${change.week}`
          : `Narrows their week ${change.week} shortfall from ${change.before} to ${change.after}`)
      } else if (change.after > change.before) {
        warnings.push(`Leaves ${rival.manager} short at ${positions(theirAfterReport.get(change.week))} in week ${change.week} — a harder ask`)
      }
    }

    for (const id of [...receiving].sort()) {
      const availability = startAvailability(id, context)
      if (availability.kind === 'unavailable') {
        warnings.push(`${context.playerName(id) ?? id} is listed ${availability.label}`)
      } else if (availability.kind === 'questionable') {
        warnings.push(`${context.playerName(id) ?? id} is listed Questionable`)
      }
    }

    // Roster room, both sides, counting open spots and ignoring IR slots.
    const limit = this.rosterLimit
    const myCount = myAfter.length, theirCount = theirAfter.length
    if (receiving.size > sending.size) {
      const extra = receiving.size - sending.size
      const drop = Math.max(0, myCount - limit)
      warnings.push(drop > 0
        ? `You receive ${extra} more player${extra === 1 ? '' : 's'} than you send — you'd need to drop ${drop}`
        : `You receive ${extra} more player${extra === 1 ? '' : 's'} than you send — you have room`)
    } else if (sending.size > receiving.size) {
      const drop = Math.max(0, theirCount - limit)
      if (drop > 0) {
        const extra = sending.size - receiving.size
        warnings.push(`${rival.manager} would need to drop ${drop} to take ${extra} extra player${extra === 1 ? '' : 's'}`)
      }
    }

    // This week's lineups. Locked players' points stay with their current
    // team this week, so the trade only moves players whose games are ahead.
    const both = [...me.roster, ...rival.roster]
    const locked = new Set(both.map((e) => e.id).filter((id) => context.isLocked(id)))
    const movingOut = new Set([...sending].filter((id) => !locked.has(id)))
    const movingIn = new Set([...receiving].filter((id) => !locked.has(id)))
    const teamOf = teamMap(both)
    const myIDs = me.roster.map((e) => e.id), theirIDs = rival.roster.map((e) => e.id)
    const myIDsAfter = [...myIDs.filter((id) => !movingOut.has(id)), ...[...movingIn].sort()]
    const theirIDsAfter = [...theirIDs.filter((id) => !movingIn.has(id)), ...[...movingOut].sort()]
    const myLineupBefore = this.bestLineup(myIDs, me.rawStarters, teamOf)
    const myLineupAfter = this.bestLineup(myIDsAfter,
      me.rawStarters.map((id) => (movingOut.has(id) ? EMPTY_STARTER_SLOT : id)), teamOf)
    const theirLineupBefore = this.bestLineup(theirIDs, rival.rawStarters, teamOf)
    const theirLineupAfter = this.bestLineup(theirIDsAfter,
      rival.rawStarters.map((id) => (movingIn.has(id) ? EMPTY_STARTER_SLOT : id)), teamOf)
    if (myLineupBefore !== undefined && myLineupAfter !== undefined && myLineupAfter < myLineupBefore) {
      warnings.push(`Your best lineup this week drops from ${TradeWizardModel.oneDecimal(myLineupBefore)} to ${TradeWizardModel.oneDecimal(myLineupAfter)} (${this.label(this.basis).toLowerCase()})`)
    }
    if ([...sending].some((id) => locked.has(id)) || [...receiving].some((id) => locked.has(id))) {
      warnings.push('Players whose games have started score for their current team this week')
    }

    const after = this.gradeLeague({ me: me.rosterID, rival: rival.rosterID, sending, receiving })
    return {
      yourWeeks, theirWeeks,
      you: side({
        lineupBefore: myLineupBefore, lineupAfter: myLineupAfter,
        rosterAfter: myCount, rosterLimit: limit,
        playoffShortBefore: shortIn(myBefore, playoff), playoffShortAfter: shortIn(myAfterReport, playoff),
        gradeBefore: this.grades.get(me.rosterID), gradeAfter: after.get(me.rosterID),
      }),
      them: side({
        lineupBefore: theirLineupBefore, lineupAfter: theirLineupAfter,
        rosterAfter: theirCount, rosterLimit: limit,
        playoffShortBefore: shortIn(theirBefore, playoff), playoffShortAfter: shortIn(theirAfterReport, playoff),
        gradeBefore: this.grades.get(rival.rosterID), gradeAfter: after.get(rival.rosterID),
      }),
      yourGains, theirGains, warnings,
    }
  }

  // MARK: - Step 4: approach

  private get unitPhrase(): string {
    return this.primaryBasis === 'thisSeason' ? 'pts/gm this season' : `pts/gm in ${this.context.statsSeason}`
  }

  /**
   * The deal's own facts, in the order the pitch uses them. These are also
   * what the local model is given, and all it is allowed to use. Only facts
   * that help the rival: your own reasons are your negotiating position.
   */
  get pitchFacts(): string[] {
    if (!this.partner) return []
    const names = (ids: ReadonlySet<string>) => [...ids]
      .map((id) => {
        const p = this.player(id, false, false)
        return `${p.name} (${p.position ?? '?'})`
      })
      .sort()
      .join(' and ')
    const facts = [`I'd send ${names(this.sending)} for ${names(this.receiving)}.`]
    facts.push(...this.effects.theirGains.map((g) => `${g}.`))
    for (const id of [...this.sending].sort()) {
      const name = this.context.playerName(id) ?? id
      const ppg = this.primaryBasis === 'thisSeason' ? this.value(id, 'thisSeason') : undefined
      if (ppg !== undefined) {
        facts.push(`${name} is averaging ${TradeWizardModel.oneDecimal(ppg)} pts/gm this season in our scoring.`)
      } else {
        const production = this.value(id, 'production')
        if (production !== undefined) {
          facts.push(`${name} averaged ${TradeWizardModel.oneDecimal(production)} pts/gm in ${this.context.statsSeason} in our scoring.`)
        }
      }
    }
    const delta = lineupDelta(this.effects.them)
    if (delta !== undefined && delta > 0) {
      facts.push(`It adds about ${TradeWizardModel.oneDecimal(delta)} points to your best lineup this week.`)
    }
    return facts
  }

  /** The template pitch: a greeting, the facts, a sign-off. Nothing else. */
  get pitch(): string {
    const partner = this.partner
    if (!partner) return ''
    return [`Hey ${partner.rival.manager} — trade idea.`, ...this.pitchFacts, 'Open to it?'].join(' ')
  }

  get hasRelay(): boolean { return this.relay !== undefined }

  async polishPitch(): Promise<void> {
    const relay = this.relay
    if (!relay) return
    const token = this.secrets.load()
    if (!token) {
      this.polishError = 'Add your relay token in Settings to use your AI.'
      this.changed()
      return
    }
    this.polishGeneration += 1
    const generation = this.polishGeneration
    this.isPolishing = true
    this.polishError = undefined
    this.changed()
    const result = await relay.polishTradePitchResult({ facts: this.pitchFacts, draft: this.pitch }, token)
    // The deal changed while the model was writing: this rewrite is for
    // a deal that no longer exists.
    if (generation !== this.polishGeneration) return
    this.isPolishing = false
    if (result.ok) {
      this.polishedPitch = result.pitch
    } else {
      switch (result.failure.kind) {
        case 'unauthorized': this.polishError = 'Your relay turned down the token. Check it in Settings.'; break
        case 'unreachable': this.polishError = "Your relay didn't answer in time. The pitch above still works."; break
        case 'server': this.polishError = `Your relay hit an error (${result.failure.status}). The pitch above still works.`; break
        case 'emptyResponse': this.polishError = 'Your AI came back empty. The pitch above still works.'; break
      }
    }
    this.changed()
  }

  get sleeperLink(): string | undefined {
    return teamLink(this.context)
  }

  // MARK: - Navigation

  /** Steps back without losing the goal, partner or deal. */
  back(): void {
    const previous = TRADE_STEPS[TRADE_STEPS.indexOf(this.step) - 1]
    if (previous === undefined) return
    this.step = previous
  }

  advanceToApproach(): void {
    if (!this.canApproach) return
    this.step = 'approach'
  }

  private apply(prefill: TradeWizardPrefill): void {
    const context = this.context
    const notes: string[] = []
    const mine = prefill.myPlayerID
    if (mine !== undefined) {
      if (context.userTeam?.roster.some((e) => e.id === mine) === true) {
        this.pendingSend = mine
        if (prefill.rivalRosterID === undefined) {
          notes.push(`${context.playerName(mine) ?? 'Your player'} is set to go out — pick what you need and a partner.`)
        }
      } else {
        notes.push(`${context.playerName(mine) ?? 'That player'} is no longer on your roster.`)
      }
    }
    if (prefill.positions) {
      const positions = prefill.positions
      const weeks = prefill.weeks ?? []
      const match = this.goals.find((g) => [...g.positions].some((p) => positions.has(p))
        && (weeks.length === 0 || g.weeks.some((w) => weeks.includes(w))))
      if (match) {
        this.chooseGoal(match)
      } else {
        const position = [...positions].sort()[0]
        if (position !== undefined) this.choosePosition(position)
      }
    }
    const rosterID = prefill.rivalRosterID
    const rival = rosterID !== undefined ? context.rivals.find((r) => r.rosterID === rosterID) : undefined
    if (rosterID !== undefined && rival) {
      let fit = this.partners.find((f) => f.rival.rosterID === rosterID)
      if (!fit) {
        notes.push(`${rival.manager} isn't a matched partner for this need, so their whole roster is shown.`)
        fit = this.chosenFit(rival, undefined)
      }
      this.choosePartner(fit)
      const id = prefill.theirPlayerID
      if (id !== undefined) {
        if (rival.roster.some((e) => e.id === id)) {
          this.receiving = new Set([id])
          this.dealEdited()
        } else {
          notes.push(`${context.playerName(id) ?? 'That player'} is no longer on ${rival.manager}'s roster.`)
        }
      }
    } else if (prefill.rivalRosterID !== undefined) {
      notes.push("That team couldn't be found in your league.")
    }
    this.prefillNote = notes.length === 0 ? undefined : notes.join(' ')
  }

  // MARK: - Helpers

  player(id: string, surplus: boolean, starter: boolean): TradePlayer {
    const context = this.context
    const profile = this.profiles.get(id)
    const values: Partial<Record<TradeBasis, number>> = {}
    for (const basis of TRADE_BASES) {
      const v = this.value(id, basis)
      if (v !== undefined) values[basis] = v
    }
    const reserve = context.teams.some((t) => t.reserveIDs.includes(id))
    const out: TradePlayer = {
      id,
      name: context.playerName(id) ?? profile?.name ?? id,
      values,
      isSurplus: surplus && !reserve,
      isStarter: starter,
      isReserve: reserve,
      availability: startAvailability(id, context),
    }
    const position = context.position(id) ?? profile?.position
    if (position !== undefined) out.position = position
    const team = context.nflTeam(id) ?? profile?.team
    if (team !== undefined) out.team = team
    return out
  }

  /** Spare first, IR last, then by value on the primary basis. */
  surplusFirst(a: TradePlayer, b: TradePlayer): boolean {
    if (a.isReserve !== b.isReserve) return !a.isReserve
    if (a.isSurplus !== b.isSurplus) return a.isSurplus
    return (tradePlayerValue(a, this.primaryBasis) ?? -1) > (tradePlayerValue(b, this.primaryBasis) ?? -1)
  }

  private readonly surplusFirstOrder = comparator((a: TradePlayer, b: TradePlayer) => this.surplusFirst(a, b))

  static weekList(weeks: readonly number[]): string {
    const sorted = [...weeks].sort((a, b) => a - b)
    switch (sorted.length) {
      case 0: return 'no weeks'
      case 1: return `week ${sorted[0]}`
      case 2: return `weeks ${sorted[0]} and ${sorted[1]}`
      default:
        return `weeks ${sorted.slice(0, -1).map(String).join(', ')} and ${sorted[sorted.length - 1]}`
    }
  }

  static oneDecimal(value: number): string {
    return formatFixed(value, 1)
  }
}

// MARK: - Local helpers

/** A Swift `areInIncreasingOrder` predicate as a JS comparator. */
function comparator<T>(less: (a: T, b: T) => boolean): (a: T, b: T) => number {
  return (a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0)
}

/** Swift's `trimmingCharacters(in: .whitespaces)` — spaces and tabs, not newlines. */
function trimWhitespace(text: string): string {
  return text.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')
}

/** `Dictionary(…, uniquingKeysWith: { first, _ in first })` of id → team, `""` when unknown. */
function teamMap(entries: readonly RosterEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const e of entries) if (!out.has(e.id)) out.set(e.id, e.team ?? '')
  return out
}

/** Builds a `DealSide` without writing `undefined` into optional fields. */
function side(s: DealSide): DealSide {
  const out: DealSide = {
    rosterAfter: s.rosterAfter, rosterLimit: s.rosterLimit,
    playoffShortBefore: s.playoffShortBefore, playoffShortAfter: s.playoffShortAfter,
  }
  if (s.lineupBefore !== undefined) out.lineupBefore = s.lineupBefore
  if (s.lineupAfter !== undefined) out.lineupAfter = s.lineupAfter
  if (s.gradeBefore !== undefined) out.gradeBefore = s.gradeBefore
  if (s.gradeAfter !== undefined) out.gradeAfter = s.gradeAfter
  return out
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
