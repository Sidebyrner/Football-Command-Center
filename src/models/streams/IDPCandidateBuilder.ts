/**
 * Turns a league context and this week's game contexts into IDP stream
 * candidates — a port of FCApp `IDPCandidateBuilder`: every defender with a
 * real role this season, plus everyone on the user's roster so the starter
 * being replaced is always in the report.
 *
 * Pure — no I/O — so it is tested directly against recorded Sleeper lines.
 */
import { nflverseTeam } from '@core/NFLTeams'
import { IDP_PLATFORM, resolveIDPSubPosition, type IDPCandidate } from '@core/streams/IDPStream'
import { defensiveSnapShare } from '@data/insightsModels'
import { playerNflverseTeam, playersAt, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import { IDP_NEUTRAL_TOTAL, type IDPPlayerOverride, type IDPTeamContext } from './IDPWeekContext'
import { completedStatWeeks, meanOfLast3, opponentLabel, streamPracticeStatus } from './StreamKind'

export class IDPCandidateBuilder {
  /**
   * Below this snap share, in both the last game and the last three, a
   * defender is a rotational body rather than a stream.
   */
  static readonly minimumSnapShare = 0.35

  /**
   * Players the user picked — the starter to beat, anyone being compared —
   * who are projected even below the snap-share floor.
   */
  alwaysInclude: ReadonlySet<string> = new Set()

  constructor(
    readonly context: LeagueContext,
    readonly teams: Readonly<Record<string, IDPTeamContext>>,
    readonly players: Readonly<Record<string, IDPPlayerOverride>>,
  ) {}

  /** Weeks with stats that are over: every week before the one being played. */
  get statWeeks(): number[] { return completedStatWeeks(this.context) }

  /**
   * Plays each defense has faced per week, from the team snap count on any
   * of its defenders' lines. Team-level, so a player who missed a game does
   * not change his team's pace.
   */
  teamDefensivePlays(): Map<string, Map<number, number>> {
    const out = new Map<string, Map<number, number>>()
    for (const week of this.statWeeks) {
      for (const line of this.context.inSeason.weekStats.get(week)?.values() ?? []) {
        const team = nflverseTeam(line.team)
        const plays = line.stats.tm_def_snp
        if (team === undefined || plays === undefined || !(plays > 0)) continue
        let byWeek = out.get(team)
        if (!byWeek) { byWeek = new Map(); out.set(team, byWeek) }
        byWeek.set(week, Math.max(byWeek.get(week) ?? 0, plays))
      }
    }
    return out
  }

  candidates(): IDPCandidate[] {
    const weeks = this.statWeeks
    const pace = this.teamDefensivePlays()
    const mine = new Set(this.context.userTeam?.roster.map((e) => e.id) ?? [])
    const out: IDPCandidate[] = []
    for (const position of ['LB', 'DL', 'DB'] as const) {
      for (const player of playersAt(this.context.players, position)) {
        const candidate = this.candidate(player, weeks, pace, mine.has(player.id))
        if (candidate) out.push(candidate)
      }
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private candidate(player: IndexedPlayer, weeks: number[], pace: Map<string, Map<number, number>>, isMine: boolean): IDPCandidate | undefined {
    const context = this.context
    const override = this.players[player.id]
    const team = playerNflverseTeam(player)
    if (team === undefined) return undefined
    const resolved = resolveIDPSubPosition(player.positionCode, player.depthChartPosition)
    if (!resolved) return undefined

    // Season-to-date evidence over the weeks he actually played.
    const shares: number[] = []
    let statSnaps = 0
    let solo = 0, ast = 0, combined = 0, hasSplit = false
    let sacks = 0, tfl = 0, pd = 0, int = 0, ff = 0, qbHits = 0
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(player.id)
      const share = line ? defensiveSnapShare(line) : undefined
      if (!line || share === undefined) continue
      const s = line.stats
      shares.push(share)
      statSnaps += s.def_snp ?? 0
      if (s.idp_tkl_solo !== undefined || s.idp_tkl_ast !== undefined) hasSplit = true
      solo += s.idp_tkl_solo ?? 0
      ast += s.idp_tkl_ast ?? 0
      combined += s.idp_tkl ?? ((s.idp_tkl_solo ?? 0) + (s.idp_tkl_ast ?? 0))
      sacks += s.idp_sack ?? 0
      tfl += s.idp_tkl_loss ?? 0
      pd += s.idp_pass_def ?? 0
      int += s.idp_int ?? 0
      ff += s.idp_ff ?? 0
      qbHits += s.idp_qb_hit ?? 0
    }

    const last1 = shares.length ? shares[shares.length - 1] : undefined
    const last3 = meanOfLast3(shares)
    const hasRole = Math.max(last1 ?? 0, last3 ?? 0) >= IDPCandidateBuilder.minimumSnapShare || override?.snapShareEst !== undefined
    if (!(isMine || hasRole || this.alwaysInclude.has(player.id))) return undefined

    const flags: string[] = []
    if (resolved.inferred) {
      flags.push(resolved.position === 'S_BOX'
        ? 'alignment not listed — treated as a box safety'
        : 'alignment not listed — treated as an edge')
    }
    if (shares.length === 0) flags.push('no snaps recorded this season')

    // Game context; a team with no game is on bye.
    const game = this.teams[team]
    let practice = override?.practice ?? streamPracticeStatus(player, context)
    if (game === undefined) {
      practice = 'OUT'
      flags.push('bye week')
    } else if (game.linesSource === 'standard') {
      flags.push('no recorded line — neutral spread and total')
    }

    const teamWeeks = pace.get(team) ?? new Map<number, number>()
    const availability = context.availabilityOf(player.id)
    const l1Value = last1 ?? 0, l3Value = last3 ?? 0
    const roleConf = override?.roleConf
      ?? (l1Value >= 0.85 && l3Value >= 0.8 ? 0.85 : l1Value >= 0.65 ? 0.7 : 0.5)
    const dvp = game?.dvpPct[IDP_PLATFORM[resolved.position]]
    const sources = ['Sleeper weekly stats']
    if (context.practiceReport(player.id) !== undefined) sources.push('nflverse practice report')

    return {
      name: player.name,
      team,
      position: override?.position ?? resolved.position,
      opponent: game ? opponentLabel(game) : 'BYE',
      home: game?.home,
      spreadDef: game?.spreadDef ?? 0,
      total: game?.total ?? IDP_NEUTRAL_TOTAL,
      teamDefPlays: [...teamWeeks.values()].reduce((s, v) => s + v, 0),
      teamGames: teamWeeks.size,
      snapShareLast1: last1,
      snapShareLast3: last3,
      snapShareEst: override?.snapShareEst,
      roleConf,
      statSnaps,
      solo: hasSplit ? solo : undefined,
      ast: hasSplit ? ast : undefined,
      comb: hasSplit ? undefined : (shares.length === 0 ? undefined : combined),
      sacks, tfl, pd, int, ff, qbHits,
      pressures: override?.pressures,
      dvpPct: dvp ?? 0,
      dvpGames: dvp === undefined ? 0 : (game?.dvpGames ?? 0),
      oppSackEnv: game?.oppSackEnv ?? 1,
      practice,
      rosterPct: undefined,
      // Read from the league's own rosters, so never unverified.
      available: availability.kind === 'freeAgent',
      notes: override?.notes ?? '',
      sources,
      dataFlags: flags,
      playerID: player.id,
    }
  }
}
