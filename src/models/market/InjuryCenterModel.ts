/**
 * Injury Center — a port of FCApp `InjuryCenterModel`: every injury signal on
 * your roster, who steps into the vacated roles league-wide, and the best fill
 * for each hole. `InjurySeverity` lives here and the Waiver Board imports it.
 */
import { PRACTICE_PHRASE, type PracticeReport } from '@core/InSeasonFiles'
import { optimizeLineup } from '@core/LineupOptimizer'
import type { Position } from '@core/Position'
import { dedicatedCounts, type Slot } from '@core/RosterSlots'
import { roundAwayFromZero } from '@core/rounding'
import { weekLines } from '@core/Schedule'
import type { SleeperPlayerNews } from '@data/insightsModels'
import { activePlayers, hasInjuryDesignation, playerPosition } from '@data/playerIndex'
import type { SleeperService } from '@data/SleeperService'
import { isDegraded } from '../league/Freshness'
import { blocksStart, FREE_AGENT, startAvailability, type Availability, type LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { Observable } from '../Observable'

// MARK: - Severity

/**
 * How much an injury costs to ignore, worst first. Drives the order of the
 * Injury Center and nothing else — it is a sort key, not a verdict.
 * The numbers are Swift's raw values, so `<` compares as Swift's `Comparable`.
 */
export const InjurySeverity = {
  out: 0,
  doubtful: 1,
  /** Questionable, and did not practice on the latest report. */
  questionableNoPractice: 2,
  questionable: 3,
  /**
   * IR, PUP, suspended and the other reserve tags — already out of the
   * lineup, so nothing to decide this week.
   */
  reserve: 4,
  other: 5,
} as const
export type InjurySeverity = (typeof InjurySeverity)[keyof typeof InjurySeverity]

/** Tags Sleeper uses for players parked on a reserve list. */
export const RESERVE_TAGS: ReadonlySet<string> = new Set(['IR', 'PUP', 'SUS', 'NA', 'DNR', 'COV'])

export function injurySeverity(tag: string | undefined, report: PracticeReport | undefined): InjurySeverity {
  const designation = report?.designation
  if (designation !== undefined) {
    switch (designation) {
      case 'Out': return InjurySeverity.out
      case 'Doubtful': return InjurySeverity.doubtful
      case 'Questionable':
        return report?.practice === 'DNP' ? InjurySeverity.questionableNoPractice : InjurySeverity.questionable
    }
  }
  const upper = tag?.toUpperCase()
  if (upper === undefined || upper === '') return InjurySeverity.other
  if (RESERVE_TAGS.has(upper)) return InjurySeverity.reserve
  switch (upper) {
    case 'OUT': return InjurySeverity.out
    case 'DOUBTFUL': return InjurySeverity.doubtful
    case 'QUESTIONABLE':
      return report?.practice === 'DNP' ? InjurySeverity.questionableNoPractice : InjurySeverity.questionable
    default: return InjurySeverity.other
  }
}

// MARK: - Rows

/**
 * One of the user's players with an injury signal from any source: Sleeper's
 * tag, the official report's designation, or a limited practice.
 */
export interface InjuredPlayer {
  id: string
  name: string
  position?: Position
  team?: string
  isStarter: boolean
  /** The slot he currently fills — `"RB"`, `"SUPER_FLEX"` — or `undefined` on the bench. */
  slotToken?: string
  /** Sleeper's tag, as sent: "Questionable", "Out", "IR". */
  sleeperTag?: string
  bodyPart?: string
  notes?: string
  /** The official report line, when he is on it this week. */
  report?: PracticeReport
  /** Epoch ms. */
  kickoff?: number
  isLocked: boolean
  /** When the Sleeper tag was downloaded (epoch ms); a tag is only as current as that. */
  tagAsOf: number
  /** Rotowire's projection under the league's scoring, when there is one. */
  projectedPoints?: number
  severity: InjurySeverity
}

/** "Questionable · Toe · Limited practice", from whatever is known (Swift `InjuredPlayer.headline`). */
export function injuredPlayerHeadline(p: Pick<InjuredPlayer, 'report' | 'sleeperTag' | 'bodyPart'>): string {
  const parts: string[] = []
  const designation = p.report?.designation
  if (designation !== undefined) parts.push(designation)
  else if (p.sleeperTag !== undefined && p.sleeperTag !== '') parts.push(p.sleeperTag)
  const injury = p.report?.injury ?? p.bodyPart
  if (injury !== undefined && injury !== '') parts.push(injury)
  const practice = p.report?.practice
  if (practice !== undefined) parts.push(PRACTICE_PHRASE[practice])
  return parts.length === 0 ? 'Injury tag' : parts.join(' · ')
}

/**
 * Someone who stands to gain from an injury: the next names on the team's
 * official depth chart at that position, with what they have actually been
 * doing.
 */
export interface Beneficiary {
  id: string
  sleeperID?: string
  name: string
  position?: Position
  team?: string
  availability: Availability
  /** One-based depth behind the injured player. */
  depthBehind: number
  lastSnapShare?: number
  lastExpectedPoints?: number
  projectedPoints?: number
  sleeperPointsPerGame?: number
}

/** An injured player anywhere in the league and the names behind him. */
export interface InjuryOpening {
  id: string
  injuredName: string
  position?: Position
  team?: string
  availability: Availability
  headline: string
  severity: InjurySeverity
  beneficiaries: Beneficiary[]
}

/** A rival's tagged starter, and whether you can offer at that position. */
export interface RivalInjury {
  id: string
  manager: string
  rosterID: number
  playerName: string
  position?: Position
  headline: string
  severity: InjurySeverity
  /** You have a bench player at his position beyond your dedicated slots. */
  youHaveSurplus: boolean
}

/**
 * The one named basis a replacement list is ranked on. Each is a different
 * question; none is blended into another (§6).
 */
export type ReplacementBasis = 'projected' | 'expectedPoints' | 'sleeperPointsPerGame'
export const REPLACEMENT_BASES: readonly ReplacementBasis[] = ['projected', 'expectedPoints', 'sleeperPointsPerGame']

export const REPLACEMENT_BASIS_LABEL: Readonly<Record<ReplacementBasis, string>> = {
  projected: 'Projected this week',
  expectedPoints: 'Expected points, last 4',
  sleeperPointsPerGame: 'This season pts/gm',
}

export const REPLACEMENT_BASIS_HINT: Readonly<Record<ReplacementBasis, string>> = {
  projected: "Rotowire's stat line via Sleeper, in your scoring",
  expectedPoints: 'what his usage should have scored (ffopportunity), not his scoring',
  sleeperPointsPerGame: 'what he has scored this season, in your scoring',
}

/** A player who could fill the injured player's slot this week. */
export interface ReplacementCandidate {
  id: string
  name: string
  position?: Position
  team?: string
  opponent?: string
  availability: Availability
  value?: number
  /**
   * What your best legal lineup gains by having him, on the same basis —
   * zero when he would not start over what you already have.
   */
  lineupGain?: number
  isLocked: boolean
  injuryTag?: string
}

/** Swift's `sorted(by:)` predicate as a JS comparator. */
export function byPredicate<T>(less: (a: T, b: T) => boolean): (a: T, b: T) => number {
  return (a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0)
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

// MARK: - The model

export class InjuryCenterModel extends Observable {
  context?: LeagueContext
  isLoading = false
  errorMessage?: string
  roster: InjuredPlayer[] = []
  openings: InjuryOpening[] = []
  rivalInjuries: RivalInjury[] = []
  /**
   * Recent news per player on your roster's injury list, fetched fail-soft;
   * absent when Sleeper's news route could not be read.
   */
  news: Record<string, SleeperPlayerNews[]> = {}
  private _basis: ReplacementBasis = 'projected'
  refreshCount = 0

  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  constructor(private readonly loader: LeagueContextLoader, private readonly sleeper: SleeperService) {
    super()
  }

  get basis(): ReplacementBasis { return this._basis }
  set basis(value: ReplacementBasis) {
    this._basis = value
    this.changed()
  }

  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load({ leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force: true })
    if (this.errorMessage === undefined && this.context && !isDegraded(this.context.provenance)) {
      this.refreshCount += 1
      this.changed()
    }
  }

  async load({ leagueID, userRosterID, season, force = false }: { leagueID: string; userRosterID: number; season?: number; force?: boolean }): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID, season }
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()
    try {
      const context = await this.loader.load({ leagueID, userRosterID, season, force })
      this.context = context
      this.roster = buildInjuryRoster(context)
      this.openings = buildInjuryOpenings(context)
      this.rivalInjuries = buildRivalInjuries(context)
      this.changed()
      await this.loadNews(this.roster.slice(0, 8).map((p) => p.id), force)
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Replacement Finder

  /** Value of a player on one basis; `undefined` means the basis cannot value him. */
  value(id: string, basis: ReplacementBasis, context: LeagueContext): number | undefined {
    switch (basis) {
      case 'projected':
        return context.projectedPoints(id)
      case 'expectedPoints': {
        const gsis = context.gsisIDsBySleeper.get(id)
        const usage = context.inSeason.usage
        if (gsis === undefined || !usage) return undefined
        const points = usage.recentWeeks(gsis, 4).map((w) => w.expectedPoints).filter((x): x is number => x !== undefined)
        if (points.length === 0) return undefined
        return points.reduce((s, x) => s + x, 0) / points.length
      }
      case 'sleeperPointsPerGame':
        return context.sleeperPointsPerGame(id)
    }
  }

  /**
   * Who could fill the injured player's slot this week, ranked on the
   * current basis: your bench, free agents and rivals' benches, minus
   * anyone on bye or already locked. Players the basis cannot value are
   * left out rather than scored as zero.
   */
  candidates(injured: InjuredPlayer, limit = 12): ReplacementCandidate[] {
    const context = this.context
    const mine = context?.userTeam
    if (!context || !mine) return []
    const eligible: ReadonlySet<Position> = (() => {
      if (injured.slotToken !== undefined) {
        const slot: Slot | undefined = context.template.starters.find((s) => s.token === injured.slotToken)
        if (slot) return slot.eligible
      }
      return injured.position !== undefined ? new Set([injured.position]) : new Set<Position>()
    })()
    if (eligible.size === 0) return []

    const starting = new Set(mine.starterIDs)
    const lines = weekLines(context.schedule, context.currentWeek)
    const basis = this.basis

    const pool: { id: string; value: number; availability: Availability }[] = []
    for (const player of activePlayers(context.players)) {
      const position = playerPosition(player)
      if (player.id === injured.id || position === undefined || !eligible.has(position)) continue
      const availability = context.availabilityOf(player.id)
      if (availability.kind === 'mine' && starting.has(player.id)) continue
      if (availability.kind === 'rivalStarter') continue
      const team = context.nflTeam(player.id)
      if (context.byeCalendar.isOnBye(team, context.currentWeek)) continue
      if (context.isLocked(player.id)) continue
      if (injurySeverity(player.injuryStatus, context.practiceReport(player.id)) <= InjurySeverity.doubtful) continue
      const value = this.value(player.id, basis, context)
      if (value === undefined) continue
      pool.push({ id: player.id, value, availability })
    }
    pool.sort(byPredicate((a, b) => a.value > b.value))

    // Lineup gain: the best legal lineup with him, against the best without
    // — both with the injured player excluded, since that is the question.
    const rosterIDs = mine.roster.map((e) => e.id).filter((id) => id !== injured.id)
    const locked = new Set(rosterIDs.filter((id) => context.isLocked(id)))
    const best = (ids: string[]) =>
      optimizeLineup({
        currentStarterIDs: mine.rawStarters.map((id) => (id === injured.id ? '0' : id)),
        playerIDs: ids,
        template: context.template,
        positions: (id) => context.position(id),
        // Your other Out, Doubtful and IR players can't fill the hole
        // either — the same rule Sit/Start uses.
        valueOf: (id) => (blocksStart(startAvailability(id, context)) ? undefined : this.value(id, basis, context)),
        locked,
      }).proposedTotal
    const baseline = best(rosterIDs)

    return pool.slice(0, limit).map((scored) => {
      const withHim = best([...rosterIDs, scored.id])
      // A roster nobody on the basis can value has a best lineup worth
      // nothing, so the candidate's whole value is the gain.
      const gain = withHim === undefined ? undefined : Math.max(0, roundAwayFromZero((withHim - (baseline ?? 0)) * 10) / 10)
      const team = context.nflTeam(scored.id)
      return {
        id: scored.id,
        name: context.playerName(scored.id) ?? scored.id,
        position: context.position(scored.id),
        team,
        opponent: team === undefined ? undefined : lines[team]?.opponent,
        availability: scored.availability,
        value: scored.value,
        lineupGain: gain,
        isLocked: false,
        injuryTag: context.injuryStatus(scored.id),
      }
    })
  }

  // MARK: - News

  private async loadNews(ids: string[], force: boolean): Promise<void> {
    if (ids.length === 0) {
      this.news = {}
      this.changed()
      return
    }
    const fetched = await Promise.all(
      ids.map(async (id): Promise<[string, SleeperPlayerNews[] | undefined]> => {
        try {
          return [id, (await this.sleeper.playerNews(id, force)).value]
        } catch {
          return [id, undefined]
        }
      }),
    )
    const out: Record<string, SleeperPlayerNews[]> = {}
    for (const [id, items] of fetched) if (items && items.length > 0 && !Object.hasOwn(out, id)) out[id] = items
    this.news = out
    this.changed()
  }

  /**
   * The freshness line for the whole screen: the league context, then the
   * in-season sources by name.
   */
  get sourceNotes(): string[] {
    const context = this.context
    if (!context) return []
    const notes: string[] = []
    const label = context.inSeason.projectionSourceLabel
    if (label !== undefined) notes.push(`Projections: ${label}.`)
    const meta = context.inSeason.depthCharts?.fileMeta
    const generated = meta?.asOf ?? meta?.generated
    if (generated !== undefined) notes.push(`Depth charts: official, as of ${[...generated].slice(0, 10).join('')}.`)
    if (context.inSeason.practiceReports.size > 0) {
      notes.push('Practice reports: official NFL injury report via nflverse.')
    } else {
      notes.push(`No official injury report for week ${context.currentWeek} yet — Sleeper tags only.`)
    }
    if (context.inSeason.unavailable.length > 0) {
      notes.push('Unavailable: ' + context.inSeason.unavailable.join(', ') + '.')
    }
    return notes
  }
}

// MARK: - Your roster

/**
 * Every one of the user's players with an injury signal, worst first,
 * starters before bench, soonest kickoff first.
 */
export function buildInjuryRoster(context: LeagueContext): InjuredPlayer[] {
  const team = context.userTeam
  if (!team) return []
  const out: InjuredPlayer[] = []
  for (const entry of team.roster) {
    const player = context.players.players[entry.id]
    const report = context.practiceReport(entry.id)
    const hasSignal = (player ? hasInjuryDesignation(player) : false)
      || report?.designation !== undefined
      || (report?.practice !== undefined && report.practice !== 'FULL')
    if (!hasSignal) continue
    const index = team.rawStarters.indexOf(entry.id)
    const slotIndex = index < 0 ? undefined : index
    const slot = slotIndex !== undefined && slotIndex < context.template.starters.length ? context.template.starters[slotIndex] : undefined
    const nflTeam = context.nflTeam(entry.id)
    out.push({
      id: entry.id,
      name: context.playerName(entry.id) ?? entry.id,
      position: entry.position,
      team: nflTeam,
      isStarter: slotIndex !== undefined,
      slotToken: slot?.token,
      sleeperTag: player && hasInjuryDesignation(player) ? player.injuryStatus : undefined,
      bodyPart: player?.injuryBodyPart,
      notes: player?.injuryNotes,
      report,
      kickoff: context.kickoffs.kickoff(nflTeam, context.currentWeek),
      isLocked: context.isLocked(entry.id),
      tagAsOf: context.players.builtAt,
      projectedPoints: context.projectedPoints(entry.id),
      severity: injurySeverity(player?.injuryStatus, report),
    })
  }
  return out.sort(byPredicate((a, b) => {
    if (a.severity !== b.severity) return a.severity < b.severity
    if (a.isStarter !== b.isStarter) return a.isStarter
    return (a.kickoff ?? Infinity) < (b.kickoff ?? Infinity)
  }))
}

// MARK: - Who benefits

/**
 * For every rostered player in the league with a game designation, the
 * next names on his team's official depth chart and what they have been
 * doing. Absent when no depth chart file is loaded.
 */
export function buildInjuryOpenings(context: LeagueContext, maxBehind = 3): InjuryOpening[] {
  const depth = context.inSeason.depthCharts
  if (!depth) return []
  const gsisBySleeper = context.gsisIDsBySleeper
  const out: InjuryOpening[] = []

  for (const team of context.teams) {
    for (const entry of team.roster) {
      const position = entry.position
      if (position === undefined || position === 'DEF') continue
      const player = context.players.players[entry.id]
      const report = context.practiceReport(entry.id)
      const severity = injurySeverity(player?.injuryStatus, report)
      if (!(severity <= InjurySeverity.reserve) || severity === InjurySeverity.other) continue
      const gsis = gsisBySleeper.get(entry.id)
      if (gsis === undefined) continue
      const nflTeam = context.nflTeam(entry.id)
      const behind = depth.behind(gsis, nflTeam, position).slice(0, maxBehind)
      if (behind.length === 0) continue

      const beneficiaries = behind.map((behindGSIS, offset): Beneficiary => {
        const sleeperID = context.sleeperIDsByGSIS[behindGSIS]
        const recent = context.inSeason.usage?.recentWeeks(behindGSIS, 1)
        const usage = recent === undefined ? undefined : recent[recent.length - 1]
        const name = (sleeperID === undefined ? undefined : context.playerName(sleeperID))
          ?? context.inSeason.usage?.meta[behindGSIS]?.name
          ?? behindGSIS
        return {
          id: behindGSIS,
          sleeperID,
          name,
          position,
          team: nflTeam,
          availability: sleeperID === undefined ? FREE_AGENT : context.availabilityOf(sleeperID),
          depthBehind: offset + 1,
          lastSnapShare: usage?.offensiveSnapShare ?? usage?.defensiveSnapShare,
          lastExpectedPoints: usage?.expectedPoints,
          projectedPoints: sleeperID === undefined ? undefined : context.projectedPoints(sleeperID),
          sleeperPointsPerGame: sleeperID === undefined ? undefined : context.sleeperPointsPerGame(sleeperID),
        }
      })

      const injuredHeadline = injuredPlayerHeadline({
        sleeperTag: player && hasInjuryDesignation(player) ? player.injuryStatus : undefined,
        bodyPart: player?.injuryBodyPart,
        report,
      })

      out.push({
        id: entry.id,
        injuredName: context.playerName(entry.id) ?? entry.id,
        position,
        team: nflTeam,
        availability: context.availabilityOf(entry.id),
        headline: injuredHeadline,
        severity,
        beneficiaries,
      })
    }
  }
  // Yours first, then by severity, then the ones with a free-agent
  // beneficiary — the stash you can still make.
  return out.sort(byPredicate((a, b) => {
    const aMine = a.availability.kind === 'mine', bMine = b.availability.kind === 'mine'
    if (aMine !== bMine) return aMine
    if (a.severity !== b.severity) return a.severity < b.severity
    const aFree = a.beneficiaries.some((x) => x.availability.kind === 'freeAgent')
    const bFree = b.beneficiaries.some((x) => x.availability.kind === 'freeAgent')
    if (aFree !== bFree) return aFree
    return a.injuredName < b.injuredName
  }))
}

// MARK: - Rivals

/** Rivals' tagged starters, flagged when you hold a spare at that position. */
export function buildRivalInjuries(context: LeagueContext): RivalInjury[] {
  const mine = context.userTeam
  if (!mine) return []
  const required = dedicatedCounts(context.template)
  const starting = new Set(mine.starterIDs)
  const spareAt = new Set<Position>()
  for (const entry of mine.roster) {
    if (starting.has(entry.id)) continue
    const position = entry.position
    if (position === undefined) continue
    const atPosition = mine.roster.filter((e) => e.position === position).length
    if (atPosition > (required[position] ?? 0)) spareAt.add(position)
  }

  const out: RivalInjury[] = []
  for (const rival of context.rivals) {
    for (const id of rival.starterIDs) {
      const player = context.players.players[id]
      const report = context.practiceReport(id)
      const severity = injurySeverity(player?.injuryStatus, report)
      if (!(severity <= InjurySeverity.questionable)) continue
      const position = context.position(id)
      const headline = injuredPlayerHeadline({
        sleeperTag: player && hasInjuryDesignation(player) ? player.injuryStatus : undefined,
        bodyPart: player?.injuryBodyPart,
        report,
      })
      out.push({
        id,
        manager: rival.manager,
        rosterID: rival.rosterID,
        playerName: context.playerName(id) ?? id,
        position,
        headline,
        severity,
        youHaveSurplus: position === undefined ? false : spareAt.has(position),
      })
    }
  }
  return out.sort(byPredicate((a, b) => {
    if (a.youHaveSurplus !== b.youHaveSurplus) return a.youHaveSurplus
    if (a.severity !== b.severity) return a.severity < b.severity
    return a.playerName < b.playerName
  }))
}
