/**
 * Dashboard — "what needs me right now" (§7.1). A port of FCApp
 * `DashboardModel` with its `LineupAlert`, `StandingsRow`, `BenchWeek`,
 * `TrendPoint`, `DraftPickResult` and `TransactionSummary`.
 *
 * Alerts first and always; everything else is history and scrolls below.
 * This is the screen a notification deep-links into, so the top of it has to
 * answer the question the notification raised without any scrolling.
 */
import { PRACTICE_PHRASE } from '@core/InSeasonFiles'
import { optimizeLineup } from '@core/LineupOptimizer'
import type { Position } from '@core/Position'
import { RelayClient, type NewsItem } from '@data/RelayClient'
import { EMPTY_STARTER_SLOT, isTransactionComplete, pointsAgainst, pointsFor, type SleeperMatchup } from '@data/sleeperModels'
import type { SleeperService } from '@data/SleeperService'
import { freshnessLabel, isDegraded } from '../league/Freshness'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { Observable } from '../Observable'
import { rosterWeekPoints, SeasonHistory } from './SeasonHistory'
import { buildThisWeek, buildWaiverTargets, type ThisWeekSummary, type WaiverTarget } from './DashboardThisWeek'
import {
  buildByeStrip, buildLineupReadiness, buildResults, buildUpcoming, place, streak,
  type ByeStripWeek, type LineupReadiness, type MyTeamZoom, type UpcomingOpponent, type WeekResult,
} from './MyTeamModel'

// MARK: - Rows

/**
 * Ordered by how much it costs to ignore: a starter on bye scores exactly
 * zero, an unset slot scores exactly zero, and an injury is a risk rather
 * than a certainty. The numbers are Swift's raw values.
 */
export const LineupAlertKind = {
  onBye: 0,
  emptySlot: 1,
  injured: 2,
} as const
export type LineupAlertKind = (typeof LineupAlertKind)[keyof typeof LineupAlertKind]

/** Something the user can still do something about before kickoff. */
export interface LineupAlert {
  kind: LineupAlertKind
  playerID?: string
  playerName?: string
  detail: string
  /**
   * For injury alerts: when Sleeper's player file — the source of the tag —
   * was downloaded (epoch ms). A tag is only as current as that.
   */
  asOf?: number
}

export const lineupAlertID = (a: LineupAlert) => `${a.kind}-${a.playerID ?? a.detail}`

/** One row of the league table. `rosterID` is its identity. */
export interface StandingsRow {
  rosterID: number
  manager: string
  isUser: boolean
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
}

export const standingsRecord = (r: Pick<StandingsRow, 'wins' | 'losses' | 'ties'>) =>
  r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`

/** What one week's lineup scored against the best that was available. */
export interface BenchWeek {
  week: number
  actual: number
  best: number
  /** Never negative — a lineup cannot beat the best one available to it. */
  left: number
  /**
   * Players who would genuinely have gained points, from the optimizer's own
   * swaps, so equal-value reshuffles are not reported as missed moves.
   */
  shouldHaveStarted: { id: string; name: string; points: number }[]
}

/** One week of the scoring trend. */
export interface TrendPoint {
  week: number
  mine?: number
  leagueAverage?: number
  rank?: number
  teamCount: number
}

/** One of the user's draft picks, against what that pick slot actually returned across the league. */
export interface DraftPickResult {
  playerID: string
  name: string
  position?: Position
  pickNo: number
  actual: number
  expected: number
}

/** Positive means the pick beat what that slot returned league-wide. */
export const draftSurplus = (r: Pick<DraftPickResult, 'actual' | 'expected'>) => r.actual - r.expected

/** A recent add, drop or trade in the league. */
export interface TransactionSummary {
  transactionID: string
  week: number
  type: string
  manager: string
  addedNames: string[]
  droppedNames: string[]
}

/** Swift's `String(describing: error)`, as near as JS gets. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error)
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// MARK: - Pure builders (Swift's static funcs)

export function buildAlerts(context: LeagueContext): LineupAlert[] {
  const team = context.userTeam
  if (!team) return []
  const alerts: LineupAlert[] = []

  const positions = new Map<string, (typeof team.roster)[number]>()
  for (const entry of team.roster) if (!positions.has(entry.id)) positions.set(entry.id, entry)

  // A starter whose game has kicked off can no longer be moved, so an alert
  // about him is noise: there is nothing left to do about it.
  const actionable = team.starterIDs.filter((id) => !context.isLocked(id))

  // A starter on bye scores nothing at all — more urgent than any tag.
  for (const id of actionable) {
    const entry = positions.get(id)
    if (!entry) continue
    if (context.byeCalendar.isOnBye(entry.team, context.currentWeek)) {
      alerts.push({
        kind: LineupAlertKind.onBye,
        playerID: id,
        playerName: context.playerName(id) ?? id,
        detail: 'on bye this week — starting them scores 0',
      })
    }
  }

  // Slots still unset on Sleeper. The raw starters array keeps its positional
  // alignment, so the `"0"` entries are countable here and nowhere else.
  const unsetCount = team.rawStarters.filter((id) => id === EMPTY_STARTER_SLOT).length
  if (unsetCount > 0) {
    alerts.push({
      kind: LineupAlertKind.emptySlot,
      playerID: undefined,
      playerName: undefined,
      detail: `${unsetCount} starter slot${unsetCount === 1 ? '' : 's'} not set yet on Sleeper`,
    })
  }

  for (const id of actionable) {
    const report = context.practiceReport(id)
    const status = context.injuryStatus(id) ?? report?.designation
    if (status === undefined || status === '') continue
    // "Questionable · Toe · Limited practice": the tag, the body part and the
    // official practice status, each only when known.
    const parts = [status]
    const injury = report?.injury ?? context.players.players[id]?.injuryBodyPart
    if (injury !== undefined && injury !== '') parts.push(injury)
    if (report?.practice !== undefined) parts.push(PRACTICE_PHRASE[report.practice])
    alerts.push({
      kind: LineupAlertKind.injured,
      playerID: id,
      playerName: context.playerName(id) ?? id,
      detail: parts.join(' · '),
      asOf: context.players.builtAt,
    })
  }

  return alerts.sort((a, b) => a.kind - b.kind)
}

/**
 * Sorted the way a league table is: record first, points for as the
 * tiebreak. Sleeper already returns all of this with the rosters, so it costs
 * no extra request.
 */
export function buildStandings(context: LeagueContext): StandingsRow[] {
  const rows: StandingsRow[] = []
  for (const team of context.teams) {
    const settings = team.settings
    if (!settings) continue
    rows.push({
      rosterID: team.rosterID,
      manager: team.manager,
      isUser: team.isUser,
      wins: settings.wins ?? 0,
      losses: settings.losses ?? 0,
      ties: settings.ties ?? 0,
      pointsFor: pointsFor(settings) ?? 0,
      pointsAgainst: pointsAgainst(settings) ?? 0,
    })
  }
  return rows.sort((lhs, rhs) => {
    if (lhs.wins !== rhs.wins) return rhs.wins - lhs.wins
    if (lhs.ties !== rhs.ties) return rhs.ties - lhs.ties
    return lhs.pointsFor > rhs.pointsFor ? -1 : lhs.pointsFor < rhs.pointsFor ? 1 : 0
  })
}

/**
 * What the lineup scored against the best lineup available that week.
 *
 * The search is `LineupOptimizer`'s job, not this one's. All this supplies is
 * the basis — points actually scored, per Sleeper — which is why overlapping
 * flex slots are handled properly and cosmetic shuffles are not reported as
 * missed moves.
 */
export function buildBenchWeeks(context: LeagueContext, history: SeasonHistory): BenchWeek[] {
  const positionsByID = new Map<string, Position | undefined>()
  for (const entry of context.userTeam?.roster ?? []) if (!positionsByID.has(entry.id)) positionsByID.set(entry.id, entry.position)

  const out: BenchWeek[] = []
  for (const week of history.weeksForRoster(context.userRosterID)) {
    const proposal = optimizeLineup({
      currentStarterIDs: week.starters,
      playerIDs: week.players,
      template: context.template,
      // The week's own roster is authoritative for that week — a player since
      // dropped is still in it. (Swift's `Position??` lookup: a present key
      // with no position does not fall back.)
      positions: (id) => (positionsByID.has(id) ? positionsByID.get(id) : context.position(id)),
      // A player Sleeper gave no number for is excluded rather than scored as
      // zero; the optimizer reports those as `unranked`.
      valueOf: (id) => rosterWeekPoints(week, id),
    })

    const actual = proposal.currentTotal
    if (actual === undefined) continue
    const best = proposal.proposedTotal ?? actual

    out.push({
      week: week.week,
      actual,
      best,
      left: Math.max(0, proposal.gain ?? 0),
      shouldHaveStarted: proposal.swaps.map((swap) => ({
        id: swap.inID,
        name: context.playerName(swap.inID) ?? swap.inID,
        points: rosterWeekPoints(week, swap.inID) ?? 0,
      })),
    })
  }
  return out
}

/**
 * Real results only, no projection. The rank each week is against the actual
 * field that week, not an estimate of it.
 */
export function buildTrend(context: LeagueContext, history: SeasonHistory): TrendPoint[] {
  return history.weeks.map((week) => {
    const totals = history.totals(week)
    const mine = totals.get(context.userRosterID)
    const values = [...totals.values()]
    const average = values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length
    const rank = mine === undefined ? undefined : values.filter((v) => v > mine).length + 1
    return { week, mine, leagueAverage: average, rank, teamCount: values.length }
  })
}

// MARK: - The model

export class DashboardModel extends Observable {
  context?: LeagueContext
  alerts: LineupAlert[] = []
  standings: StandingsRow[] = []
  benchWeeks: BenchWeek[] = []
  trend: TrendPoint[] = []
  draftResults: DraftPickResult[] = []
  transactions: TransactionSummary[] = []
  news: NewsItem[] = []
  isLoading = false
  errorMessage?: string

  /** You against your opponent this week. `undefined` before Sleeper has matchups. */
  thisWeek?: ThisWeekSummary

  // MARK: My Team hub

  private zoomValue: MyTeamZoom = 'thisWeek'
  /** Which altitude the hub is showing. */
  get zoom(): MyTeamZoom { return this.zoomValue }
  set zoom(value: MyTeamZoom) {
    this.zoomValue = value
    this.changed()
  }
  readiness?: LineupReadiness
  results: WeekResult[] = []
  streak?: string
  place?: { rank: number; of: number }
  upcoming: UpcomingOpponent[] = []
  byeStrip: ByeStripWeek[] = []
  /** When your next starters lock (epoch ms), for the alerts card. `undefined` once all have. */
  nextLock?: number
  waiverTargets: WaiverTarget[] = []
  waiverTargetsUnavailable = false

  /** Set when the draft panel cannot be shown, saying why rather than rendering an empty card. */
  draftUnavailable?: string

  /** Bumped by each successful pull-to-refresh, so the screen can play a success haptic for a refresh without also playing one on first load. */
  refreshCount = 0

  /**
   * Where the relay lives, for screens that make their own client — the trade
   * wizard needs a far longer timeout than news does.
   */
  relayBaseURL?: string

  private relay?: RelayClient
  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  /**
   * @param relayBaseURL the relay's URL. TS `RelayClient` keeps its base URL
   *   private, so it is read off the client only as a fallback (Swift reads
   *   `relay?.baseURL`).
   */
  constructor(
    private readonly loader: LeagueContextLoader,
    private readonly sleeper: SleeperService,
    relay?: RelayClient,
    relayBaseURL?: string,
  ) {
    super()
    this.relay = relay
    this.relayBaseURL = relayBaseURL ?? (relay as unknown as { baseURL?: string } | undefined)?.baseURL
  }

  // Swift's static funcs, reachable as `DashboardModel.x` too.
  static buildAlerts = buildAlerts
  static buildStandings = buildStandings
  static buildBenchWeeks = buildBenchWeeks
  static buildTrend = buildTrend
  static buildThisWeek = buildThisWeek
  static buildWaiverTargets = buildWaiverTargets
  static buildResults = buildResults
  static streak = streak
  static place = place
  static buildUpcoming = buildUpcoming
  static buildByeStrip = buildByeStrip

  /** Whether a relay is configured — the News pillar says so either way. */
  get hasRelay(): boolean { return this.relay !== undefined }

  /**
   * Points the news panel at a relay, or removes it. Takes effect on the next
   * load, so a URL entered in Settings works without a relaunch.
   */
  setRelay(baseURL: string | undefined): void {
    this.relay = baseURL === undefined ? undefined : new RelayClient(baseURL)
    this.relayBaseURL = baseURL
    if (baseURL === undefined) this.news = []
    this.changed()
  }

  /** Total left on the bench across every completed week. */
  get totalLeftOnBench(): number {
    return this.benchWeeks.reduce((sum, w) => sum + w.left, 0)
  }

  get freshnessLabel(): string | undefined {
    return this.context ? freshnessLabel(this.context.provenance) : undefined
  }

  /** Re-reads everything that can change during a week. Wired to pull-to-refresh. */
  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load(request.leagueID, request.rosterID, request.season, true)
    // Only a refresh that actually reached Sleeper counts. A failed fetch
    // falls back to the cached copy, labelled offline — keeping the screen
    // useful, but not something to confirm with a success haptic.
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

      // Alerts and standings need nothing beyond the context, so they are
      // built first and are on screen even if history fails.
      this.alerts = buildAlerts(context)
      const team = context.userTeam
      this.nextLock = team
        ? context.kickoffs.nextLock(context.currentWeek, team.starterIDs.map((id) => context.nflTeam(id)), context.now())
        : undefined
      this.standings = buildStandings(context)
      this.readiness = buildLineupReadiness(context)
      this.place = place(this.standings)
      this.byeStrip = buildByeStrip(context)
      this.changed()

      // Same cache entry the Matchup screen reads, so no second request.
      let matchups: SleeperMatchup[] | undefined
      try {
        matchups = (await this.sleeper.matchups(leagueID, context.currentWeek, force)).value
      } catch {
        matchups = undefined
      }
      this.thisWeek = matchups === undefined ? undefined : buildThisWeek(context, matchups)

      try {
        const trending = await this.sleeper.trendingAdds(force)
        this.waiverTargets = buildWaiverTargets(context, trending.value)
        this.waiverTargetsUnavailable = false
      } catch {
        this.waiverTargets = []
        this.waiverTargetsUnavailable = true
      }
      this.changed()

      const history = await SeasonHistory.load(this.sleeper, leagueID, context.currentWeek)
      this.benchWeeks = buildBenchWeeks(context, history)
      this.trend = buildTrend(context, history)
      this.results = buildResults(context, history)
      this.streak = streak(this.results)

      // Sleeper publishes future pairings; they don't change, so the long TTL.
      const future = new Map<number, SleeperMatchup[]>()
      const lastWeek = context.seasonWeeks.length === 0 ? context.currentWeek : Math.max(...context.seasonWeeks)
      const upper = Math.max(context.currentWeek + 1, Math.min(context.currentWeek + 3, lastWeek))
      for (let week = context.currentWeek + 1; week <= upper; week++) {
        try {
          future.set(week, (await this.sleeper.completedMatchups(leagueID, week)).value)
        } catch {
          // A week Sleeper can't answer is simply left out.
        }
      }
      this.upcoming = buildUpcoming(context, future)
      this.changed()

      await this.loadDraftResults(context, history)
      await this.loadTransactions(context, 3, force)
      await this.loadNews(context)
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Draft value realized

  /**
   * Each of the user's picks against what that pick number actually returned
   * league-wide this season.
   *
   * "Expected" is the *n*th-best actual season total among everyone drafted,
   * so the comparison is against what the slot really produced rather than
   * against anyone's preseason ranking.
   */
  private async loadDraftResults(context: LeagueContext, history: SeasonHistory): Promise<void> {
    if (history.weeks.length === 0) {
      this.draftUnavailable = 'No completed weeks yet, so there is nothing to grade picks against.'
      return
    }
    const userID = context.userTeam?.ownerID
    if (userID === undefined) {
      this.draftUnavailable = 'Could not tell which picks were yours.'
      return
    }
    let draftID: string | undefined
    try {
      draftID = (await this.sleeper.drafts(context.league.leagueID)).value[0]?.draftID
    } catch {
      draftID = undefined
    }
    if (draftID === undefined) {
      this.draftUnavailable = 'Sleeper returned no draft for this league.'
      return
    }
    let picks
    try {
      picks = (await this.sleeper.draftPicks(draftID)).value
    } catch {
      this.draftUnavailable = 'Could not load the draft picks.'
      return
    }

    const actualByPlayer = history.actualPointsByPlayer()
    // Every drafted player's season total, best first. Index n-1 is what pick n returned.
    const ranked = picks
      .map((p) => p.playerID)
      .filter((id): id is string => id !== undefined)
      .map((id) => actualByPlayer.get(id) ?? 0)
      .sort((a, b) => b - a)

    if (ranked.length === 0) {
      this.draftUnavailable = 'No scored players from the draft yet.'
      return
    }

    this.draftUnavailable = undefined
    const results: DraftPickResult[] = []
    for (const pick of picks) {
      if (pick.pickedBy !== userID) continue
      const playerID = pick.playerID
      if (playerID === undefined) continue
      const index = Math.min(Math.max(pick.pickNo - 1, 0), ranked.length - 1)
      results.push({
        playerID,
        name: context.playerName(playerID) ?? playerID,
        position: context.position(playerID),
        pickNo: pick.pickNo,
        actual: actualByPlayer.get(playerID) ?? 0,
        expected: ranked[index]!,
      })
    }
    this.draftResults = results.sort((a, b) => draftSurplus(b) - draftSurplus(a))
  }

  // MARK: - Transactions

  /**
   * The last few weeks of league activity. Older weeks are not worth a
   * request each — this is a "what did I miss" panel, not an archive.
   */
  private async loadTransactions(context: LeagueContext, weeksBack = 3, force = false): Promise<void> {
    const managers = new Map<number, string>()
    for (const t of context.teams) if (!managers.has(t.rosterID)) managers.set(t.rosterID, t.manager)
    const through = Math.max(1, context.currentWeek - weeksBack + 1)

    const summaries: TransactionSummary[] = []
    for (let week = context.currentWeek; week >= through; week--) {
      let fetched
      try {
        fetched = await this.sleeper.transactions(context.league.leagueID, week, force)
      } catch {
        continue
      }

      for (const transaction of fetched.value) {
        if (!isTransactionComplete(transaction)) continue
        const rosterID = transaction.rosterIDs?.[0]
        summaries.push({
          transactionID: transaction.transactionID,
          week,
          type: transaction.type ?? 'move',
          manager: (rosterID === undefined ? undefined : managers.get(rosterID)) ?? 'Unknown',
          addedNames: Object.keys(transaction.adds ?? {}).map((id) => context.playerName(id) ?? id).sort(byString),
          droppedNames: Object.keys(transaction.drops ?? {}).map((id) => context.playerName(id) ?? id).sort(byString),
        })
      }
    }
    this.transactions = summaries
  }

  // MARK: - News

  /**
   * Relay-backed and therefore optional. When there is no relay the section
   * simply does not appear — no v1 feature depends on it being reachable.
   */
  private async loadNews(context: LeagueContext): Promise<void> {
    const relay = this.relay
    if (!relay) return
    const feed = await relay.news('rotoworld')
    if (!feed) return

    const rosterNames = new Set<string>()
    for (const entry of context.userTeam?.roster ?? []) {
      const name = context.playerName(entry.id)
      if (name !== undefined) rosterNames.add(name)
    }
    // Foundation's `localizedCaseInsensitiveContains` never matches an empty needle.
    const needles = [...rosterNames].filter((n) => n !== '').map((n) => n.toLocaleLowerCase())
    this.news = feed.items.filter((item) => {
      const title = item.title.toLocaleLowerCase()
      return needles.some((name) => title.includes(name))
    })
  }
}
