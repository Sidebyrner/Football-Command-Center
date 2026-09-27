/**
 * Sit/Start — "who do I actually play" (§7.3). A port of FCApp `SitStartModel`,
 * with its `LineupBasis`, `UnrankedBreakdown`, `SwapRow`, `LineupChange`,
 * `SlotMove`, `ProposedSlot` and `NextLock`.
 */
import type { CommandCenterProjection } from '@core/CommandCenterProjection'
import { optimizeLineup, type LineupProposal } from '@core/LineupOptimizer'
import { hasWeeklyProductionData } from '@core/Position'
import { weekLines, type TeamGameLine } from '@core/Schedule'
import type { SeasonProfile } from '@core/SeasonProfile'
import { EMPTY_STARTER_SLOT } from '@data/sleeperModels'
import { Observable } from '../Observable'
import { isDegraded } from '../league/Freshness'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { blocksStart, startAvailability, startBadge, type LeagueContext, type LeagueTeam, type StartAvailability } from '../league/LeagueContext'
import { CommandCenterProjector } from '../player/CommandCenterProjector'
import { DefenseLookup } from '../player/DefenseLookup'

// MARK: - Basis

/**
 * One way of valuing a player for this week. Each is a **different question**,
 * not a better answer to the same one — the optimizer takes exactly one at a
 * time and the screen always names which (§6, §7.3).
 */
export type LineupBasis =
  | 'seasonAverage'
  | 'form'
  | 'floor'
  | 'ceiling'
  /**
   * The only basis that knows nothing about the player. A replacement-level
   * body in a shootout outranks a stud in a slog — which is the point of
   * running it *against* the others, not instead of them.
   */
  | 'environment'
  /**
   * Rotowire's projected stat line for this week via Sleeper, scored under
   * the league's own rules. Third-party, labelled as such, and the only
   * forward-looking basis that covers DEF and IDP.
   */
  | 'projected'
  /** Points per game this season from Sleeper's own stat lines — the only production number DEF and IDP have. */
  | 'thisSeason'
  /** The app's own projection: this season regressed toward last, a usage trend, and the matchup (§6). */
  | 'commandCenter'

/** Swift's `LineupBasis.allCases`, in declaration order. */
export const LINEUP_BASES: readonly LineupBasis[] = [
  'seasonAverage', 'form', 'floor', 'ceiling', 'environment', 'projected', 'thisSeason', 'commandCenter',
]

export const LINEUP_BASIS_LABEL: Readonly<Record<LineupBasis, string>> = {
  seasonAverage: 'Season pts/gm',
  form: 'Last 4 pts/gm',
  floor: 'Floor',
  ceiling: 'Ceiling',
  environment: 'Game environment',
  projected: 'Projected this week',
  thisSeason: 'This season pts/gm',
  commandCenter: 'Command Center',
}

export const LINEUP_BASIS_HINT: Readonly<Record<LineupBasis, string>> = {
  seasonAverage: 'what he averaged, in your scoring',
  form: 'recent form only',
  floor: 'his bad week — protect a lead',
  ceiling: 'his big week — you need a blowup',
  environment: "his team's implied total — nothing about him",
  projected: "Rotowire's stat line via Sleeper, in your scoring — covers DEF and IDP",
  thisSeason: "Sleeper's own weekly lines this season, in your scoring — covers DEF and IDP",
  commandCenter: 'our own: this season regressed toward last, his usage trend, and the matchup',
}

/** Whether this basis reads the weekly production file, and so cannot value DEF or IDP at all. */
export const basisNeedsProductionData = (b: LineupBasis) => b !== 'environment'

// MARK: - Rows

/**
 * Why players could not be valued, split by cause because the causes mean
 * different things: one is a data limit nothing will fix, one resolves once a
 * player has games, and one is about this week only.
 */
export interface UnrankedBreakdown {
  /** DEF and IDP on a production basis — the weekly file does not cover them. */
  noProductionData: string[]
  /** A covered position with no line in the stats season: rookies, a missed year, or an unjoinable player. */
  noSeasonLine: string[]
  /** On bye this week. Excluded on every basis, because starting him scores 0. */
  onBye: string[]
  /** Environment basis only: his team has no recorded line this week. */
  noGameLine: string[]
  /** Projected basis only: Rotowire has no line for him this week. */
  noProjection: string[]
  /** This-season and Command Center bases: no Sleeper stat line yet, and nothing else to project from. */
  noSleeperLine: string[]
  /** Out, Doubtful, IR and the like — excluded on every basis, with the status named: "Kyren Williams (Doubtful)". */
  injured: string[]
}

export const EMPTY_UNRANKED: UnrankedBreakdown = {
  noProductionData: [], noSeasonLine: [], onBye: [], noGameLine: [], noProjection: [], noSleeperLine: [], injured: [],
}

export const unrankedTotal = (u: UnrankedBreakdown) =>
  u.noProductionData.length + u.noSeasonLine.length + u.onBye.length + u.noGameLine.length
  + u.noProjection.length + u.noSleeperLine.length + u.injured.length

/** A proposed change, with names attached. */
export interface SwapRow {
  slot: string
  outName?: string
  inName: string
  delta: number
}

export const swapRowID = (s: SwapRow) => `${s.slot}-${s.inName}`

/** A player coming into, or going out of, the starting lineup. */
export interface LineupChange {
  playerID: string
  name: string
  /** The slot he takes (for a start) or leaves (for a sit). */
  slot: string
  /** His value on the active basis; `undefined` when the basis can't value him. */
  value?: number
  /**
   * Injury badge — "Q" for a Questionable start, or the status of a starter
   * being sat because he is Out, Doubtful or on IR.
   */
  injury?: string
}

/** A player who starts either way but changes slot — a flex shuffle. */
export interface SlotMove {
  playerID: string
  name: string
  from: string
  to: string
}

/** One slot of the proposed lineup. */
export interface ProposedSlot {
  index: number
  slot: string
  playerID?: string
  name?: string
  value?: number
  /**
   * True when the basis could value nobody for this slot, so the current
   * starter is shown as kept rather than the slot drawn as empty. A DEF slot
   * on a production basis is the usual case.
   */
  keptBecauseUnvalued: boolean
  changed: boolean
  /** His game has kicked off, so Sleeper won't let this slot change. */
  isLocked: boolean
  /** The player's injury standing for this week. */
  availability: StartAvailability
}

/** The next moment some of your starters lock. */
export interface NextLock {
  /** Epoch ms. */
  date: number
  /** How many of your current starters kick off at that moment. */
  starters: number
}

const EMPTY_PROPOSAL: LineupProposal = { proposedIDs: [], swaps: [], unranked: [], valuedCount: 0 }

/** Swift's `String(describing: error)`, as near as JS gets. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error)
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

// MARK: - The model

/** Sit/Start — "who do I actually play" (§7.3). */
export class SitStartModel extends Observable {
  context?: LeagueContext
  isLoading = false
  errorMessage?: string

  private basisValue: LineupBasis = 'seasonAverage'
  get basis(): LineupBasis { return this.basisValue }
  /** Setting the basis recomputes, as Swift's `didSet` does. */
  set basis(value: LineupBasis) {
    this.basisValue = value
    this.recompute()
    this.changed()
  }

  proposal?: LineupProposal
  lineup: ProposedSlot[] = []
  swaps: SwapRow[] = []
  unranked: UnrankedBreakdown = EMPTY_UNRANKED
  /**
   * Who comes in, who goes out, and who just changes slot. The optimizer
   * reports changes slot by slot, which is exact but reads badly; these three
   * lists say what a manager actually has to do.
   */
  starts: LineupChange[] = []
  sits: LineupChange[] = []
  moves: SlotMove[] = []

  /**
   * Slots where the current starter is Out, Doubtful or on IR and nobody on
   * the bench can be valued to replace him — "Name (Out) at RB".
   */
  injuredWithoutCover: string[] = []

  /** Bench players whose game has already kicked off — left out of every proposal. */
  lockedBench: string[] = []
  /** How many of your current starters are already locked in. */
  lockedStarters = 0
  /** When the next group of your starters locks; `undefined` once everyone has kicked off. */
  nextLock?: NextLock

  /**
   * Other bases that reach a *different* lineup. The honest signal: when the
   * measures disagree, this is a judgement call, not a calculation.
   */
  disagreeingBases: LineupBasis[] = []

  /**
   * Said on screen so its absence is not a mystery: the web app's 0–100 model
   * score depends on a season-scoring system this port does not have yet.
   */
  static readonly modelBasisNote = "The web app's model-score basis is not available here yet."

  private profilesBySleeperID = new Map<string, SeasonProfile>()
  private lines: Record<string, TeamGameLine> = {}
  /** The Command Center projector, built once per load with both defense-vs-position tables. */
  private projector?: CommandCenterProjector
  /** Where the projected basis' numbers come from, for the screen. */
  projectionSourceLabel?: string

  /** Bumped by each successful pull-to-refresh, so the screen can play a success haptic. */
  refreshCount = 0

  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  constructor(private readonly loader: LeagueContextLoader) {
    super()
  }

  get gain(): number | undefined { return this.proposal?.gain }

  /** Re-reads everything that can change during a week. Wired to pull-to-refresh. */
  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load(request.leagueID, request.rosterID, request.season, true)
    // Only a refresh that actually reached Sleeper counts.
    if (this.errorMessage === undefined && this.context && !isDegraded(this.context.provenance)) {
      this.refreshCount += 1
      this.changed()
    }
  }

  async load(leagueID: string, userRosterID: number, season?: number, force = false): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID, season }
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()

    try {
      const context = await this.loader.load({ leagueID, userRosterID, season, force })
      this.context = context

      const byGSIS = new Map<string, SeasonProfile>()
      for (const p of context.seasonProfiles) if (!byGSIS.has(p.gsisID)) byGSIS.set(p.gsisID, p)
      const bySleeper = new Map<string, SeasonProfile>()
      for (const [gsis, sleeper] of Object.entries(context.sleeperIDsByGSIS)) {
        const profile = byGSIS.get(gsis)
        if (profile) bySleeper.set(sleeper, profile)
      }
      this.profilesBySleeperID = bySleeper
      this.lines = weekLines(context.schedule, context.currentWeek)
      this.projectionSourceLabel = context.inSeason.projectionSourceLabel
      const defense = DefenseLookup.build(context)
      this.projector = new CommandCenterProjector(context, defense)
      this.recompute()
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Valuing

  private team(id: string, context: LeagueContext): string | undefined {
    return context.nflTeam(id)
  }

  /**
   * THE BASIS, as a function the optimizer calls. `undefined` means "cannot
   * value", which the optimizer reports and never scores as zero.
   */
  value(id: string, basis: LineupBasis, context: LeagueContext): number | undefined {
    // A player on bye scores exactly zero whatever he is worth.
    const team = this.team(id, context)
    if (team !== undefined && context.byeCalendar.isOnBye(team, context.currentWeek)) return undefined
    // Nor may it recommend a player who is Out, Doubtful or on IR.
    if (blocksStart(startAvailability(id, context))) return undefined
    switch (basis) {
      case 'seasonAverage': return this.profilesBySleeperID.get(id)?.pointsPerGame
      case 'form': return this.profilesBySleeperID.get(id)?.formPointsPerGame
      case 'floor': return this.profilesBySleeperID.get(id)?.floor
      case 'ceiling': return this.profilesBySleeperID.get(id)?.ceiling
      case 'environment': return team === undefined ? undefined : this.lines[team]?.impliedTotal
      case 'projected': return context.projectedPoints(id)
      case 'thisSeason': return context.sleeperPointsPerGame(id)
      case 'commandCenter': return this.projector?.project(id)?.weekly
    }
  }

  /** The Command Center projection with its factors, for a player row. */
  commandCenterProjection(id: string): CommandCenterProjection | undefined {
    return this.projector?.project(id)
  }

  optimize(basis: LineupBasis, context: LeagueContext): LineupProposal {
    const team = context.userTeam
    if (!team) return EMPTY_PROPOSAL
    const ids = team.roster.map((e) => e.id)
    return optimizeLineup({
      currentStarterIDs: team.rawStarters,
      playerIDs: ids,
      template: context.template,
      positions: (id) => context.position(id),
      valueOf: (id) => this.value(id, basis, context),
      locked: new Set(ids.filter((id) => context.isLocked(id))),
    })
  }

  /**
   * What would actually take the field under a proposal: the proposed player
   * where the basis picked one, otherwise whoever starts now.
   */
  effectiveLineup(proposal: LineupProposal, context: LeagueContext): Set<string> {
    const current = context.userTeam?.rawStarters ?? []
    const out = new Set<string>()
    proposal.proposedIDs.forEach((proposed, index) => {
      const chosen = proposed ?? (index < current.length ? current[index] : undefined)
      if (chosen !== undefined && chosen !== EMPTY_STARTER_SLOT) out.add(chosen)
    })
    return out
  }

  recompute(): void {
    const context = this.context
    const team = context?.userTeam
    if (!context || !team) return
    const basis = this.basis
    const active = this.optimize(basis, context)
    this.proposal = active

    const name = (id: string | undefined) => (id === undefined ? undefined : context.playerName(id) ?? id)
    const current = team.rawStarters

    this.lineup = context.template.starters.map((slot, index) => {
      const proposed = index < active.proposedIDs.length ? active.proposedIDs[index] : undefined
      const incumbent = index < current.length ? current[index] : undefined
      const incumbentID = incumbent === EMPTY_STARTER_SLOT ? undefined : incumbent
      const shown = proposed ?? incumbentID
      return {
        index,
        slot: slot.token,
        playerID: shown,
        name: name(shown),
        value: shown === undefined ? undefined : this.value(shown, basis, context),
        keptBecauseUnvalued: proposed === undefined && incumbentID !== undefined,
        changed: proposed !== undefined && proposed !== incumbentID,
        isLocked: shown === undefined ? false : context.isLocked(shown),
        availability: shown === undefined ? { kind: 'clear' } : startAvailability(shown, context),
      }
    })
    this.injuredWithoutCover = this.lineup.flatMap((slot) => {
      if (!slot.keptBecauseUnvalued || slot.isLocked || slot.availability.kind !== 'unavailable' || slot.name === undefined) return []
      return [`${slot.name} (${slot.availability.label}) at ${slot.slot}`]
    })

    this.swaps = active.swaps.map((swap) => ({
      slot: swap.slot.token,
      outName: name(swap.outID),
      inName: name(swap.inID) ?? swap.inID,
      delta: swap.delta,
    }))

    this.buildChanges(current, context)
    this.buildLocks(current, team, context)

    this.unranked = this.breakdown(active.unranked, context)

    const mine = this.effectiveLineup(active, context)
    this.disagreeingBases = LINEUP_BASES
      .filter((b) => b !== basis)
      .filter((b) => !setsEqual(this.effectiveLineup(this.optimize(b, context), context), mine))
    this.changed()
  }

  private buildLocks(current: readonly string[], team: LeagueTeam, context: LeagueContext): void {
    const starters = current.filter((id) => id !== EMPTY_STARTER_SLOT)
    const startingSet = new Set(starters)
    this.lockedStarters = starters.filter((id) => context.isLocked(id)).length
    this.lockedBench = team.roster.map((e) => e.id)
      .filter((id) => !startingSet.has(id) && context.isLocked(id))
      .map((id) => context.playerName(id) ?? id)
      .sort()

    const now = context.now()
    const upcoming: number[] = []
    for (const id of starters) {
      const kickoff = context.kickoffs.kickoff(context.nflTeam(id), context.currentWeek)
      if (kickoff !== undefined && kickoff > now) upcoming.push(kickoff)
    }
    if (upcoming.length > 0) {
      const next = Math.min(...upcoming)
      this.nextLock = { date: next, starters: upcoming.filter((k) => k === next).length }
    } else {
      this.nextLock = undefined
    }
  }

  /** Compares the lineup as it stands with the lineup that would take the field. */
  private buildChanges(current: readonly string[], context: LeagueContext): void {
    const slots = context.template.starters
    const currentSlot = new Map<string, string>()
    current.forEach((id, index) => {
      if (id !== EMPTY_STARTER_SLOT && index < slots.length) currentSlot.set(id, slots[index]!.token)
    })
    const proposedSlot = new Map<string, string>()
    for (const slot of this.lineup) if (slot.playerID !== undefined) proposedSlot.set(slot.playerID, slot.slot)

    const change = (id: string, slot: string): LineupChange => ({
      playerID: id,
      name: context.playerName(id) ?? id,
      slot,
      value: this.value(id, this.basis, context),
      injury: startBadge(startAvailability(id, context)),
    })

    this.starts = this.lineup.flatMap((slot) => {
      const id = slot.playerID
      if (id === undefined || currentSlot.has(id)) return []
      return [change(id, slot.slot)]
    })
    this.sits = current.flatMap((id, index) => {
      if (id === EMPTY_STARTER_SLOT || proposedSlot.has(id) || index >= slots.length) return []
      return [change(id, slots[index]!.token)]
    })
    this.moves = this.lineup.flatMap((slot) => {
      const id = slot.playerID
      if (id === undefined) return []
      const from = currentSlot.get(id)
      if (from === undefined || from === slot.slot) return []
      return [{ playerID: id, name: context.playerName(id) ?? id, from, to: slot.slot }]
    })
  }

  private breakdown(ids: readonly string[], context: LeagueContext): UnrankedBreakdown {
    const noProduction: string[] = []
    const noSeason: string[] = []
    const bye: string[] = []
    const noLine: string[] = []
    const noProjection: string[] = []
    const noSleeper: string[] = []
    const injured: string[] = []
    const basis = this.basis

    for (const id of ids) {
      const label = context.playerName(id) ?? id
      const team = this.team(id, context)
      const availability = startAvailability(id, context)
      const position = context.position(id)
      if (team !== undefined && context.byeCalendar.isOnBye(team, context.currentWeek)) {
        bye.push(label)
      } else if (availability.kind === 'unavailable') {
        injured.push(`${label} (${availability.label})`)
      } else if (basis === 'environment') {
        noLine.push(label)
      } else if (basis === 'projected') {
        noProjection.push(label)
      } else if (basis === 'thisSeason' || basis === 'commandCenter') {
        noSleeper.push(label)
      } else if (!(position !== undefined && hasWeeklyProductionData(position))) {
        noProduction.push(label)
      } else {
        noSeason.push(label)
      }
    }
    return {
      noProductionData: noProduction.sort(),
      noSeasonLine: noSeason.sort(),
      onBye: bye.sort(),
      noGameLine: noLine.sort(),
      noProjection: noProjection.sort(),
      noSleeperLine: noSleeper.sort(),
      injured: injured.sort(),
    }
  }
}
