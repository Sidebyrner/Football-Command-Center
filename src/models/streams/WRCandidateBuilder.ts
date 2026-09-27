/**
 * Turns a league context and this week's game contexts into WR stream
 * candidates — a port of FCApp `WRCandidateBuilder`: every receiver with a
 * real role this season, plus everyone on the user's roster and anyone the
 * user picked.
 *
 * Everything comes from Sleeper's weekly lines — targets, first downs, air
 * yards, red-zone targets, the 30–39 / 40+ catch buckets, snaps — and team
 * pass attempts from the quarterbacks' lines. Pure, so it is tested directly
 * against recorded lines.
 */
import { nflverseTeam } from '@core/NFLTeams'
import type { WRCandidate, WRRole } from '@core/streams/WRStream'
import { offensiveSnapShare } from '@data/insightsModels'
import { playerNflverseTeam, playersAt, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import { completedStatWeeks, meanOfLast3, opponentLabel, streamPracticeStatus } from './StreamKind'
import { WR_NEUTRAL_TOTAL, type WRPlayerOverride, type WRTeamContext } from './WRWeekContext'

/** Per team-week totals every receiver on the team shares. */
export interface WRTeamWeek {
  targets: number
  redZoneTargets: number
  passAttempts: number
}

export class WRCandidateBuilder {
  /** A receiver below both floors is a depth body rather than a stream. */
  static readonly minimumTargetShare = 0.08
  static readonly minimumSnapShare = 0.40

  alwaysInclude: ReadonlySet<string> = new Set()

  constructor(
    readonly context: LeagueContext,
    readonly teams: Readonly<Record<string, WRTeamContext>>,
    readonly players: Readonly<Record<string, WRPlayerOverride>>,
  ) {}

  /** Weeks with stats that are over: every week before the one being played. */
  get statWeeks(): number[] { return completedStatWeeks(this.context) }

  teamWeeks(): Map<string, Map<number, WRTeamWeek>> {
    const out = new Map<string, Map<number, WRTeamWeek>>()
    for (const week of this.statWeeks) {
      for (const line of this.context.inSeason.weekStats.get(week)?.values() ?? []) {
        const team = nflverseTeam(line.team)
        if (team === undefined) continue
        let byWeek = out.get(team)
        if (!byWeek) { byWeek = new Map(); out.set(team, byWeek) }
        const totals = byWeek.get(week) ?? { targets: 0, redZoneTargets: 0, passAttempts: 0 }
        totals.targets += line.stats.rec_tgt ?? 0
        totals.redZoneTargets += line.stats.rec_rz_tgt ?? 0
        totals.passAttempts += line.stats.pass_att ?? 0
        byWeek.set(week, totals)
      }
    }
    return out
  }

  candidates(): WRCandidate[] {
    const totals = this.teamWeeks()
    const mine = new Set(this.context.userTeam?.roster.map((e) => e.id) ?? [])
    return playersAt(this.context.players, 'WR')
      .map((p) => this.candidate(p, totals, mine.has(p.id)))
      .filter((c): c is WRCandidate => c !== undefined)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private candidate(player: IndexedPlayer, totals: Map<string, Map<number, WRTeamWeek>>, isMine: boolean): WRCandidate | undefined {
    const context = this.context
    const override = this.players[player.id]
    const team = playerNflverseTeam(player)
    if (team === undefined) return undefined
    const teamTotals = totals.get(team) ?? new Map<number, WRTeamWeek>()

    const shares: number[] = []
    const snapShares: number[] = []
    let targets = 0, receptions = 0, yards = 0, touchdowns = 0
    let firstDowns = 0, sawFirstDowns = false
    let catches30 = 0, catches40 = 0, catches50 = 0
    let airYards = 0, redZone = 0, teamRedZone = 0
    let rushAttempts = 0, rushYards = 0, rushFirstDowns = 0
    let games = 0
    for (const week of this.statWeeks) {
      const line = context.inSeason.weekStats.get(week)?.get(player.id)
      if (!line) continue
      const s = line.stats
      const tgt = s.rec_tgt ?? 0
      if (!((s.off_snp ?? 0) > 0 || tgt > 0)) continue
      games += 1
      const teamTargets = teamTotals.get(week)?.targets
      if (teamTargets !== undefined && teamTargets > 0) shares.push(tgt / teamTargets)
      const share = offensiveSnapShare(line)
      if (share !== undefined) snapShares.push(share)
      targets += tgt
      receptions += s.rec ?? 0
      yards += s.rec_yd ?? 0
      touchdowns += s.rec_td ?? 0
      if (s.rec_fd !== undefined) { firstDowns += s.rec_fd; sawFirstDowns = true }
      // Sleeper's buckets: 30–39 is a range, 40+ a threshold. The engine
      // wants cumulative counts. There is no 50+ catch bucket, so the
      // longest catch is the only 50+ evidence — a lower bound.
      catches30 += (s.rec_30_39 ?? 0) + (s.rec_40p ?? 0)
      catches40 += s.rec_40p ?? 0
      if ((s.rec_lng ?? 0) >= 50) catches50 += 1
      airYards += s.rec_air_yd ?? 0
      redZone += s.rec_rz_tgt ?? 0
      teamRedZone += teamTotals.get(week)?.redZoneTargets ?? 0
      rushAttempts += s.rush_att ?? 0
      rushYards += s.rush_yd ?? 0
      rushFirstDowns += s.rush_fd ?? 0
    }

    const last1 = shares.length ? shares[shares.length - 1] : undefined
    const last3 = meanOfLast3(shares)
    const snapShare = meanOfLast3(snapShares)
    const hasRole = Math.max(last1 ?? 0, last3 ?? 0) >= WRCandidateBuilder.minimumTargetShare
      || (snapShare ?? 0) >= WRCandidateBuilder.minimumSnapShare
      || override?.targetShareEst !== undefined
    if (!(isMine || hasRole || this.alwaysInclude.has(player.id))) return undefined

    const flags: string[] = []
    const adot = targets > 0 ? airYards / targets : undefined
    const rushPerGame = games > 0 ? rushAttempts / games : 0
    const inferred = WRCandidateBuilder.inferRole(last3, adot, rushPerGame)
    if (override?.role === undefined) flags.push(games > 0 ? 'role inferred from usage' : 'role defaulted — no games yet')
    if (games === 0) flags.push('no games recorded this season')
    if (snapShare !== undefined) flags.push('route share from snap share')
    if (catches50 > 0) flags.push('50+ catches counted from longest catch only')

    // Team pass attempts from the quarterbacks; targets stand in without them.
    const passWeeks = [...teamTotals.values()].filter((w) => w.passAttempts > 0)
    let teamPassAttempts = passWeeks.reduce((s, w) => s + w.passAttempts, 0)
    let teamGames = passWeeks.length
    if (passWeeks.length === 0 && teamTotals.size > 0) {
      teamPassAttempts = [...teamTotals.values()].reduce((s, w) => s + w.targets, 0) / 0.95
      teamGames = teamTotals.size
      flags.push('team pass attempts estimated from targets')
    }

    const game = this.teams[team]
    let practice = override?.practice ?? streamPracticeStatus(player, context)
    if (game === undefined) {
      practice = 'OUT'
      flags.push('bye week')
    } else if (game.linesSource === 'standard') {
      flags.push('no recorded line — neutral spread and total')
    }

    const steady = shares.length >= 2 && Math.abs((last1 ?? 0) - (last3 ?? 0)) < 0.05
    const roleConf = override?.roleConf ?? (steady ? 0.8 : games > 0 ? 0.7 : 0.5)
    const sources = ['Sleeper weekly stats']
    if (context.practiceReport(player.id) !== undefined) sources.push('nflverse practice report')

    return {
      name: player.name,
      team,
      role: override?.role ?? inferred,
      opponent: game ? opponentLabel(game) : 'BYE',
      home: game?.home,
      spreadOff: game?.spreadOff ?? 0,
      total: game?.total ?? WR_NEUTRAL_TOTAL,
      teamPassAttempts,
      teamGames,
      targetShareLast1: last1,
      targetShareLast3: last3,
      targetShareEst: override?.targetShareEst,
      routeShare: snapShare,
      roleConf,
      redZoneShare: override?.redZoneShare ?? (teamRedZone > 0 ? redZone / teamRedZone : undefined),
      statTargets: targets,
      receptions: games > 0 ? receptions : undefined,
      receivingYards: yards,
      firstDowns: sawFirstDowns ? firstDowns : undefined,
      touchdowns,
      catches30,
      catches40,
      catches50,
      adot,
      rushAttemptsPerGame: override?.rushAttemptsPerGame ?? rushPerGame,
      rushYardsPerCarry: rushAttempts > 0 ? rushYards / rushAttempts : 6,
      rushFirstDownRate: rushAttempts > 0 ? rushFirstDowns / rushAttempts : 0.25,
      dvpPct: game?.dvpPct ?? 0,
      dvpGames: game?.dvpPct === undefined ? 0 : (game?.dvpGames ?? 0),
      coverageAdj: game?.coverageAdj ?? 1,
      practice,
      rosterPct: undefined,
      // Read from the league's own rosters, so never unverified.
      available: context.availabilityOf(player.id).kind === 'freeAgent',
      notes: override?.notes ?? '',
      sources,
      dataFlags: flags,
      playerID: player.id,
    }
  }

  /**
   * The role a receiver's usage points to: jet-sweep or screen usage, a
   * deep low-volume role, a true WR1 share, a short slot aDOT, else outside.
   */
  static inferRole(targetShare: number | undefined, adot: number | undefined, rushPerGame: number): WRRole {
    const share = targetShare ?? 0
    if (rushPerGame >= 1 || (adot !== undefined && adot < 5)) return 'GADGET'
    if (adot !== undefined && adot >= 14 && share < 0.18) return 'DEEP'
    if (share >= 0.24) return 'ALPHA'
    if (adot !== undefined && adot < 9) return 'SLOT'
    return 'BOUNDARY'
  }
}
