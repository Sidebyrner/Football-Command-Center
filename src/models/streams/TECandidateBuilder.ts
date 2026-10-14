/**
 * Turns a league context and this week's game contexts into TE stream
 * candidates — a port of FCApp `TECandidateBuilder`: every tight end with a
 * real role this season, plus everyone on the user's roster and anyone the
 * user picked.
 *
 * Everything comes from Sleeper's weekly lines — targets, first downs, air
 * yards, red-zone targets, the 30–39 / 40+ catch buckets, snaps — and team
 * pass attempts from the quarterbacks' lines. Snap share is kept raw: the
 * engine turns it into routes by role, because tight ends block. Pure, so it
 * is tested directly against recorded lines.
 */
import { nflverseTeam } from '@core/NFLTeams'
import { inferTERole, type TECandidate } from '@core/streams/TEStream'
import { offensiveSnapShare } from '@data/insightsModels'
import { playerNflverseTeam, playersAt, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import { completedStatWeeks, meanOfLast3, opponentLabel, streamPracticeStatus } from './StreamKind'
import { TE_NEUTRAL_TOTAL, type TEPlayerOverride, type TETeamContext } from './TEWeekContext'

/** Per team-week totals every receiver on the team shares. */
export interface TETeamWeek {
  targets: number
  redZoneTargets: number
  passAttempts: number
}

export class TECandidateBuilder {
  /** A tight end below both floors is a blocker or depth body, not a stream. */
  static readonly minimumTargetShare = 0.07
  static readonly minimumSnapShare = 0.45

  alwaysInclude: ReadonlySet<string> = new Set()

  constructor(
    readonly context: LeagueContext,
    readonly teams: Readonly<Record<string, TETeamContext>>,
    readonly players: Readonly<Record<string, TEPlayerOverride>>,
  ) {}

  /** Weeks with stats that are over: every week before the one being played. */
  get statWeeks(): number[] { return completedStatWeeks(this.context) }

  teamWeeks(): Map<string, Map<number, TETeamWeek>> {
    const out = new Map<string, Map<number, TETeamWeek>>()
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

  candidates(): TECandidate[] {
    const totals = this.teamWeeks()
    const mine = new Set(this.context.userTeam?.roster.map((e) => e.id) ?? [])
    return playersAt(this.context.players, 'TE')
      .map((p) => this.candidate(p, totals, mine.has(p.id)))
      .filter((c): c is TECandidate => c !== undefined)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private candidate(player: IndexedPlayer, totals: Map<string, Map<number, TETeamWeek>>, isMine: boolean): TECandidate | undefined {
    const context = this.context
    const override = this.players[player.id]
    const team = playerNflverseTeam(player)
    if (team === undefined) return undefined
    const teamTotals = totals.get(team) ?? new Map<number, TETeamWeek>()

    const shares: number[] = []
    const snapShares: number[] = []
    let targets = 0, receptions = 0, yards = 0, touchdowns = 0
    let firstDowns = 0, sawFirstDowns = false
    let catches30 = 0, catches40 = 0, catches50 = 0
    let airYards = 0, redZone = 0, teamRedZone = 0
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
    }

    const last1 = shares.length ? shares[shares.length - 1] : undefined
    const last3 = meanOfLast3(shares)
    const snapShare = meanOfLast3(snapShares)
    const hasRole = Math.max(last1 ?? 0, last3 ?? 0) >= TECandidateBuilder.minimumTargetShare
      || (snapShare ?? 0) >= TECandidateBuilder.minimumSnapShare
      || override?.targetShareEst !== undefined
    if (!(isMine || hasRole || this.alwaysInclude.has(player.id))) return undefined

    const flags: string[] = []
    const adot = targets > 0 ? airYards / targets : undefined
    const redZoneShare = teamRedZone > 0 ? redZone / teamRedZone : undefined
    const inferred = inferTERole({ targetShare: last3, adot, redZoneShare, snapShare })
    if (override?.role === undefined) flags.push(games > 0 ? 'role inferred from usage' : 'role defaulted — no games yet')
    if (games === 0) flags.push('no games recorded this season')
    if (snapShare !== undefined) flags.push('routes estimated from snap share by role')
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
      total: game?.total ?? TE_NEUTRAL_TOTAL,
      teamPassAttempts,
      teamGames,
      targetShareLast1: last1,
      targetShareLast3: last3,
      targetShareEst: override?.targetShareEst,
      snapShare,
      roleConf,
      redZoneShare: override?.redZoneShare ?? redZoneShare,
      statTargets: targets,
      receptions: games > 0 ? receptions : undefined,
      receivingYards: yards,
      firstDowns: sawFirstDowns ? firstDowns : undefined,
      touchdowns,
      catches30,
      catches40,
      catches50,
      adot,
      dvpPct: game?.dvpPct ?? 0,
      dvpGames: game?.dvpPct === undefined ? 0 : (game?.dvpGames ?? 0),
      seamCoverageAdj: game?.seamCoverageAdj ?? 1,
      vacatedTargetBoost: override?.vacatedTargetBoost ?? 0,
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
}
