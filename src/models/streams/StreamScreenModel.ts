/**
 * A weekly stream screen — a port of FCApp `StreamScreenModel`: is there a
 * player on waivers with a better one-week outlook than the one I am
 * starting, and how sure should I be?
 *
 * Every candidate with a real role is projected under the league's own
 * scoring by the stream's engine, compared with the chosen starter, and
 * ranked. The game context is auto-filled and every piece of it can be
 * edited. `kind` supplies what differs between streams (IDP, WR); everything
 * here is shared.
 */
import { teamName } from '@core/NFLTeams'
import { fuzzyScore } from '@core/FuzzyNameMatch'
import type { Position } from '@core/Position'
import {
  bidDollars, compareStream, isSpend, projectionFor, rankedAt, streamReport,
  type StreamComparison, type StreamHorizon, type StreamReport, type StreamRiskMode,
} from '@core/Stream'
import { playerNflverseTeam, playerPosition, playersAt, type IndexedPlayer } from '@data/playerIndex'
import { Observable } from '../Observable'
import { isDegraded } from '../league/Freshness'
import { availabilityLabel, faabRemaining, type LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { DefenseLookup } from '../player/DefenseLookup'
import {
  emptyOverrides, mergingOverrides, streamCandidateID,
  type StreamKind, type StreamKindTypes, type StreamPickerRow, type StreamWeekOverrides,
} from './StreamKind'
import { StreamStore, type StreamSnapshot, type StreamSnapshotSummary } from './StreamStore'

/** `trimmingCharacters(in: .whitespaces)`: spaces and tabs, not newlines. */
const trimWhitespace = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

const describeError = (error: unknown) => (error instanceof Error ? error.message || String(error) : String(error))

/** Same local calendar day, as `Calendar.current.isDate(_:inSameDayAs:)`. */
function isSameLocalDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export class StreamScreenModel<K extends StreamKindTypes> extends Observable {
  static readonly compareLimit = 4

  context?: LeagueContext
  isLoading = false
  errorMessage?: string
  refreshCount = 0
  report?: StreamReport<K['Projection']>
  /** This week's teams with overrides applied, keyed by nflverse code. */
  teams: Record<string, K['Team']> = {}
  /** Auto-filled values before any override, for the editor's reset. */
  autoTeams: Record<string, K['Team']> = {}
  overrides: StreamWeekOverrides<K['TeamOverride'], K['PlayerOverride']> = emptyOverrides()
  scoring: K['Scoring']
  unmodelledScoringKeys: string[] = []
  snapshots: StreamSnapshotSummary[] = []
  lastSnapshotAt?: number
  rows: K['Projection'][] = []
  /**
   * Players picked for side-by-side comparison, in the order added.
   * Session-only: a comparison is a question of the moment.
   */
  compareIDs: string[] = []
  candidates: K['Candidate'][] = []

  private riskValue: StreamRiskMode = 'neutral'
  private horizonValue: StreamHorizon = 'balanced'
  private onlyAvailableValue = true
  private positionFilterValue: Position | undefined
  private queryValue = ''
  private defense?: DefenseLookup
  private readonly store: StreamStore
  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  constructor(readonly kind: StreamKind<K>, private readonly loader: LeagueContextLoader, store?: StreamStore) {
    super()
    this.scoring = kind.emptyScoring
    this.store = store ?? new StreamStore({ folder: kind.storeFolder })
  }

  get risk() { return this.riskValue }
  set risk(value: StreamRiskMode) { this.riskValue = value; this.changed(); this.recompute() }

  /** How far ahead to rank, for streams with a rest-of-season layer. */
  get horizon() { return this.horizonValue }
  set horizon(value: StreamHorizon) { this.horizonValue = value; this.changed(); this.recompute() }

  get onlyAvailable() { return this.onlyAvailableValue }
  set onlyAvailable(value: boolean) { this.onlyAvailableValue = value; this.changed(); this.applyFilters() }

  get positionFilter() { return this.positionFilterValue }
  set positionFilter(value: Position | undefined) { this.positionFilterValue = value; this.changed(); this.applyFilters() }

  get query() { return this.queryValue }
  set query(value: string) { this.queryValue = value; this.changed(); this.applyFilters() }

  get compareLimit() { return StreamScreenModel.compareLimit }

  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load(request.leagueID, request.rosterID, request.season, true)
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
      const settings = context.league.scoringSettings ?? {}
      this.scoring = this.kind.scoring(settings)
      this.unmodelledScoringKeys = this.kind.unmodelledKeys(settings)

      this.defense = DefenseLookup.build(context)
      this.overrides = this.store.overrides(leagueID, context.scheduleSeason, context.currentWeek)
      this.rebuild()
      await this.autoSnapshotIfFirstToday()
      this.snapshots = this.store.snapshots(leagueID)
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  /** Whether the league starts anyone at this stream's positions. */
  get leagueStartsKind(): boolean {
    const context = this.context
    if (!context) return true
    const covered = new Set(this.kind.positions)
    return context.template.starters.some((slot) => [...slot.eligible].some((p) => covered.has(p)))
  }

  // MARK: - Pipeline

  /** Context → candidates → report. Cheap; runs again after every edit. */
  private rebuild(): void {
    const context = this.context, defense = this.defense
    if (!context || !defense) return
    this.autoTeams = this.kind.autofill(context, defense)
    this.teams = this.kind.apply(this.overrides.teams, this.autoTeams)
    const always = new Set(this.compareIDs)
    if (this.overrides.incumbentID !== undefined) always.add(this.overrides.incumbentID)
    this.candidates = this.kind.candidates(context, this.teams, this.overrides.players, always)
    this.recompute()
  }

  /** Re-runs the engine on the candidates already built — risk or starter change. */
  private recompute(): void {
    if (!this.context) return
    const projections = this.candidates.map((c) => this.kind.project(c, this.scoring, this.risk, this.horizon))
    this.report = streamReport(projections, this.incumbentIDAmong(projections))
    this.applyFilters()
  }

  applyFilters(): void {
    const report = this.report
    if (!report) { this.rows = []; this.changed(); return }
    const needle = trimWhitespace(this.query).toLowerCase()
    this.rows = rankedAt(report, this.positionFilter).filter((row) => {
      if (this.onlyAvailable && row.available === false) return false
      if (needle.length > 0 && !row.name.toLowerCase().includes(needle) && !row.team.toLowerCase().includes(needle)) return false
      return true
    })
    this.changed()
  }

  // MARK: - Starter

  /** The user's rostered players at this stream's positions, the first choices for the starter to beat. */
  get myPlayers(): K['Candidate'][] {
    const mine = this.context?.userTeam
    if (!mine) return []
    const ids = new Set(mine.roster.map((e) => e.id))
    return this.candidates.filter((c) => c.playerID !== undefined && ids.has(c.playerID))
  }

  /**
   * The chosen starter, or by default the weakest one the user is starting
   * this week — the one a stream would replace.
   */
  get incumbentID(): string | undefined {
    return this.incumbentIDAmong(this.candidates.map((c) => this.kind.project(c, this.scoring, this.risk, this.horizon)))
  }

  private incumbentIDAmong(projections: readonly K['Projection'][]): string | undefined {
    const chosen = this.overrides.incumbentID
    if (chosen !== undefined && projections.some((p) => p.id === chosen)) return chosen
    const mine = this.context?.userTeam
    if (!mine) return undefined
    const rostered = new Set(mine.roster.map((e) => e.id))
    const starters = new Set(mine.starterIDs)
    const myProjections = projections.filter((p) => p.playerID !== undefined && rostered.has(p.playerID))
    const starting = myProjections.filter((p) => starters.has(p.id))
    const pool = starting.length === 0 ? myProjections : starting
    let best: K['Projection'] | undefined
    for (const p of pool) if (best === undefined || p.expPts < best.expPts) best = p
    return best?.id
  }

  get incumbentIsDefault(): boolean { return this.overrides.incumbentID === undefined }

  /** Anyone can be the one to beat — yours, a rival's, a free agent. */
  async setIncumbent(id: string | undefined): Promise<void> {
    this.overrides = { ...this.overrides, incumbentID: id }
    if (id === undefined) delete this.overrides.incumbentID
    await this.saveOverrides()
    this.rebuild()
  }

  /** Whose player the starter to beat is, when he is not the user's. */
  get incumbentOwnerLabel(): string | undefined {
    const id = this.report?.incumbent?.playerID
    const context = this.context
    if (id === undefined || !context) return undefined
    const availability = context.availabilityOf(id)
    return availability.kind === 'mine' ? undefined : availabilityLabel(availability)
  }

  // MARK: - Finding players

  /**
   * Every player at this stream's positions matching a search, for the
   * any-player pickers. Forgiving: typos, any word order, and team code or
   * name count. An empty search lists the best projected players instead,
   * so there is something to browse before typing.
   */
  searchPlayers(query: string, limit = 25): StreamPickerRow[] {
    const context = this.context
    if (!context) return []
    const trimmed = trimWhitespace(query)
    let players: IndexedPlayer[]
    if (trimmed.length === 0) {
      const ranked = [...(this.report?.ranked ?? []), ...(this.report?.incumbent ? [this.report.incumbent] : [])]
      players = [...ranked].sort((a, b) => b.expPts - a.expPts).slice(0, limit)
        .map((p) => (p.playerID === undefined ? undefined : context.players.players[p.playerID]))
        .filter((p): p is IndexedPlayer => p !== undefined)
    } else {
      const scored: [IndexedPlayer, number][] = []
      for (const player of this.pool) {
        const team = playerNflverseTeam(player)
        const extra = [team, teamName(team)].filter((x): x is string => x !== undefined)
        const score = fuzzyScore(trimmed, player.name, extra)
        if (score !== undefined) scored.push([player, score])
      }
      players = scored
        .sort((a, b) => {
          if (a[1] !== b[1]) return b[1] - a[1]
          const pa = this.projection(a[0].id)?.expPts ?? -1, pb = this.projection(b[0].id)?.expPts ?? -1
          if (pa !== pb) return pb - pa
          return a[0].name < b[0].name ? -1 : a[0].name > b[0].name ? 1 : 0
        })
        .slice(0, limit)
        .map(([p]) => p)
    }
    return players.map((player) => ({
      id: player.id,
      name: player.name,
      team: playerNflverseTeam(player),
      platform: playerPosition(player),
      roleLabel: this.projection(player.id)?.roleLabel ?? this.kind.roleLabel(player),
      availability: context.availabilityOf(player.id),
      projected: this.projection(player.id)?.expPts,
    }))
  }

  /** Active players at this stream's positions on an NFL team. */
  private get pool(): IndexedPlayer[] {
    const context = this.context
    if (!context) return []
    return this.kind.positions.flatMap((p) => playersAt(context.players, p)).filter((p) => p.team !== undefined)
  }

  /** His last few completed games, newest first, scored in this league. */
  recentGames(id: string, limit = 3): K['GameLine'][] {
    const context = this.context
    if (!context) return []
    return this.kind.recentGames(context, id, limit)
  }

  /** The current projection for any player in the report, starter included. */
  projection(id: string): K['Projection'] | undefined {
    return this.report ? projectionFor(this.report, id) : undefined
  }

  // MARK: - Compare

  isComparing(id: string): boolean { return this.compareIDs.includes(id) }

  get canAddToCompare(): boolean { return this.compareIDs.length < StreamScreenModel.compareLimit }

  /**
   * Adds or removes a player. Someone outside the stream list is projected
   * on the spot, so anyone in the pool can be compared.
   */
  toggleCompare(id: string): void {
    const index = this.compareIDs.indexOf(id)
    if (index >= 0) {
      this.compareIDs = this.compareIDs.filter((_, i) => i !== index)
    } else {
      if (!this.canAddToCompare) return
      this.compareIDs = [...this.compareIDs, id]
    }
    this.changed()
    if (this.projection(id) === undefined || !this.compareIDs.includes(id)) this.rebuild()
  }

  clearCompare(): void {
    this.compareIDs = []
    this.changed()
    this.rebuild()
  }

  /** The compared players, in the order added, with every head-to-head. */
  get comparison(): StreamComparison<K['Projection']> | undefined {
    const players = this.compareIDs.map((id) => this.projection(id)).filter((p): p is K['Projection'] => p !== undefined)
    return players.length === 0 ? undefined : compareStream(players)
  }

  // MARK: - Editing context

  async setTeamOverride(change: K['TeamOverride'] | undefined, team: string): Promise<void> {
    const teams = { ...this.overrides.teams }
    if (change !== undefined && !this.kind.isTeamOverrideEmpty(change)) teams[team] = change
    else delete teams[team]
    this.overrides = { ...this.overrides, teams }
    await this.saveOverrides()
    this.rebuild()
  }

  async setPlayerOverride(change: K['PlayerOverride'] | undefined, playerID: string): Promise<void> {
    const players = { ...this.overrides.players }
    if (change !== undefined && !this.kind.isPlayerOverrideEmpty(change)) players[playerID] = change
    else delete players[playerID]
    this.overrides = { ...this.overrides, players }
    await this.saveOverrides()
    this.rebuild()
  }

  async resetAllOverrides(): Promise<void> {
    const reset: StreamWeekOverrides<K['TeamOverride'], K['PlayerOverride']> = emptyOverrides()
    if (this.overrides.incumbentID !== undefined) reset.incumbentID = this.overrides.incumbentID
    this.overrides = reset
    await this.saveOverrides()
    this.rebuild()
  }

  /**
   * Imports a context file in the reference tool's shape. Returns how many
   * teams and players it changed. Throws on a file of the wrong shape.
   */
  async importContext(text: string): Promise<{ teams: number; players: number }> {
    const incoming = this.kind.parseImport(text)
    this.overrides = mergingOverrides(this.overrides, incoming)
    await this.saveOverrides()
    this.rebuild()
    return { teams: Object.keys(incoming.teams).length, players: Object.keys(incoming.players).length }
  }

  private async saveOverrides(): Promise<void> {
    const context = this.context, leagueID = this.lastRequest?.leagueID
    if (!context || leagueID === undefined) return
    try {
      this.store.saveOverrides(this.overrides, leagueID, context.scheduleSeason, context.currentWeek)
    } catch (error) {
      this.errorMessage = `Could not save your edits: ${describeError(error)}`
      this.changed()
    }
  }

  // MARK: - Snapshots

  /** Freezes the current run by hand — the Tuesday-night and Sunday-morning runs. */
  async freezeSnapshot(): Promise<void> {
    await this.saveSnapshot(true)
    const leagueID = this.lastRequest?.leagueID
    if (leagueID !== undefined) { this.snapshots = this.store.snapshots(leagueID); this.changed() }
  }

  async loadSnapshot(id: string): Promise<StreamSnapshot<K> | undefined> {
    return this.store.snapshot(this.kind, id)
  }

  async deleteSnapshot(id: string): Promise<void> {
    try { this.store.deleteSnapshot(id) } catch { /* `try?` */ }
    const leagueID = this.lastRequest?.leagueID
    if (leagueID !== undefined) { this.snapshots = this.store.snapshots(leagueID); this.changed() }
  }

  /**
   * The first successful run each day is saved, so there is always a record
   * of what the screen said before the games — without asking.
   */
  private async autoSnapshotIfFirstToday(): Promise<void> {
    const context = this.context, leagueID = this.lastRequest?.leagueID
    if (!context || leagueID === undefined || !this.report) return
    const existing = this.store.snapshots(leagueID)
    const now = context.now()
    const alreadyToday = existing.some((s) => s.week === context.currentWeek && isSameLocalDay(s.asOf, now))
    if (alreadyToday) return
    await this.saveSnapshot(false)
  }

  private async saveSnapshot(pinned: boolean): Promise<void> {
    const context = this.context, report = this.report, leagueID = this.lastRequest?.leagueID
    if (!context || !report || leagueID === undefined) return
    try {
      const saved = this.store.saveSnapshot<K>({
        leagueID, season: context.scheduleSeason, week: context.currentWeek,
        asOf: context.now(), risk: this.risk, scoring: this.scoring, teams: Object.values(this.teams),
        candidates: this.candidates, report, pinned,
      })
      this.lastSnapshotAt = saved.asOf
    } catch (error) {
      this.errorMessage = `Could not save a snapshot: ${describeError(error)}`
    }
    this.changed()
  }

  // MARK: - Labels

  /** A FAAB range in dollars for a gain, or a plain claim verdict when the league does not bid. */
  bidLabel(row: K['Projection']): string | undefined {
    const band = row.bidBand
    if (!band) return undefined
    const remaining = this.context ? faabRemaining(this.context.leagueFacts) : undefined
    if (remaining !== undefined) return isSpend(band) ? bidDollars(band, remaining) : '$0–1'
    return isSpend(band) ? 'Claim' : 'Pass'
  }

  get sourceNotes(): string[] {
    const context = this.context
    if (!context) return []
    const notes: string[] = []
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => a - b)
    const first = weeks[0], last = weeks[weeks.length - 1]
    if (first !== undefined && last !== undefined) {
      notes.push(`Stats: Sleeper weekly lines, weeks ${first}–${last} of ${context.scheduleSeason}.`)
    } else {
      notes.push(`No ${context.scheduleSeason} Sleeper stat lines yet — every ${this.kind.playerNoun} is projected from priors alone.`)
    }
    const lineless = Object.values(this.teams).filter((t) => t.linesSource === 'standard').length
    if (lineless > 0) {
      notes.push(`${lineless} teams have no recorded spread or total this week and use a neutral 0 / 45 — edit them in Game context.`)
    }
    notes.push(...this.kind.sourceNotes(this.teams))
    if (this.unmodelledScoringKeys.length > 0) {
      notes.push(`Your league also pays for ${this.unmodelledScoringKeys.join(', ')}; these are rare and not projected.`)
    }
    notes.push("Priors and knobs are heuristic until backtested. Availability is read from your league's rosters.")
    return notes
  }
}

/** Swift's `Identifiable.id` for a stream candidate, re-exported for callers of the model. */
export { streamCandidateID }
