/**
 * Turns a league context and this week's game contexts into RB stream
 * candidates — a port of FCApp `RBCandidateBuilder`: every back with a real
 * role this season, plus everyone on the user's roster and anyone the user
 * picked.
 *
 * Everything comes from Sleeper's weekly lines — carries, rushing first
 * downs, red-zone carries, the longest run, targets — with team rush and
 * pass volume summed from every player on the team. Pure, so it is tested
 * directly against recorded lines.
 */
import { nflverseTeam } from '@core/NFLTeams'
import type { RBCandidate, RBRole } from '@core/streams/RBStream'
import { offensiveSnapShare } from '@data/insightsModels'
import { playerNflverseTeam, playersAt, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import { RB_NEUTRAL_TOTAL, type RBPlayerOverride, type RBTeamContext } from './RBWeekContext'
import { completedStatWeeks, meanOfLast3, opponentLabel, streamPracticeStatus } from './StreamKind'

/** Per team-week totals every back on the team shares. */
export interface RBTeamWeek {
  rushAttempts: number
  passAttempts: number
  targets: number
  redZoneCarries: number
}

const emptyTeamWeek = (): RBTeamWeek => ({ rushAttempts: 0, passAttempts: 0, targets: 0, redZoneCarries: 0 })

export class RBCandidateBuilder {
  /** A back below all three floors is a depth body rather than a stream. */
  static readonly minimumCarryShare = 0.12
  static readonly minimumTargetShare = 0.08
  static readonly minimumSnapShare = 0.35

  alwaysInclude: ReadonlySet<string> = new Set()

  constructor(
    readonly context: LeagueContext,
    readonly teams: Readonly<Record<string, RBTeamContext>>,
    readonly players: Readonly<Record<string, RBPlayerOverride>>,
  ) {}

  get statWeeks(): number[] { return completedStatWeeks(this.context) }

  teamWeeks(): Map<string, Map<number, RBTeamWeek>> {
    const out = new Map<string, Map<number, RBTeamWeek>>()
    for (const week of this.statWeeks) {
      for (const line of this.context.inSeason.weekStats.get(week)?.values() ?? []) {
        const team = nflverseTeam(line.team)
        if (team === undefined) continue
        let byWeek = out.get(team)
        if (!byWeek) { byWeek = new Map(); out.set(team, byWeek) }
        const totals = byWeek.get(week) ?? emptyTeamWeek()
        totals.rushAttempts += line.stats.rush_att ?? 0
        totals.passAttempts += line.stats.pass_att ?? 0
        totals.targets += line.stats.rec_tgt ?? 0
        totals.redZoneCarries += line.stats.rush_rz_att ?? 0
        byWeek.set(week, totals)
      }
    }
    return out
  }

  candidates(): RBCandidate[] {
    const totals = this.teamWeeks()
    const mine = new Set(this.context.userTeam?.roster.map((e) => e.id) ?? [])
    return playersAt(this.context.players, 'RB')
      .map((p) => this.candidate(p, totals, mine.has(p.id)))
      .filter((c): c is RBCandidate => c !== undefined)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private candidate(player: IndexedPlayer, totals: Map<string, Map<number, RBTeamWeek>>, isMine: boolean): RBCandidate | undefined {
    const context = this.context
    const override = this.players[player.id]
    const team = playerNflverseTeam(player)
    if (team === undefined) return undefined
    const teamTotals = totals.get(team) ?? new Map<number, RBTeamWeek>()

    const carryShares: number[] = [], targetShares: number[] = [], snapShares: number[] = []
    let carries = 0, rushYards = 0, rushTouchdowns = 0
    let rushFirstDowns = 0, sawRushFirstDowns = false
    let runs30 = 0, runs40 = 0, runs50 = 0
    let targets = 0, receptions = 0, receivingYards = 0, receivingTouchdowns = 0
    let receivingFirstDowns = 0, sawReceivingFirstDowns = false
    let redZone = 0, teamRedZone = 0
    let games = 0
    for (const week of this.statWeeks) {
      const line = context.inSeason.weekStats.get(week)?.get(player.id)
      if (!line) continue
      const s = line.stats
      const att = s.rush_att ?? 0, tgt = s.rec_tgt ?? 0
      if (!((s.off_snp ?? 0) > 0 || att > 0 || tgt > 0)) continue
      games += 1
      const teamWeek = teamTotals.get(week) ?? emptyTeamWeek()
      if (teamWeek.rushAttempts > 0) carryShares.push(att / teamWeek.rushAttempts)
      if (teamWeek.targets > 0) targetShares.push(tgt / teamWeek.targets)
      const share = offensiveSnapShare(line)
      if (share !== undefined) snapShares.push(share)
      carries += att
      rushYards += s.rush_yd ?? 0
      rushTouchdowns += s.rush_td ?? 0
      if (s.rush_fd !== undefined) { rushFirstDowns += s.rush_fd; sawRushFirstDowns = true }
      // Sleeper has no long-run buckets; the longest run is the only
      // evidence, so these are lower bounds.
      const longest = s.rush_lng ?? 0
      if (longest >= 30) runs30 += 1
      if (longest >= 40) runs40 += 1
      if (longest >= 50) runs50 += 1
      targets += tgt
      receptions += s.rec ?? 0
      receivingYards += s.rec_yd ?? 0
      receivingTouchdowns += s.rec_td ?? 0
      if (s.rec_fd !== undefined) { receivingFirstDowns += s.rec_fd; sawReceivingFirstDowns = true }
      redZone += s.rush_rz_att ?? 0
      teamRedZone += teamWeek.redZoneCarries
    }

    const recent = (shares: number[]) => ({ last1: shares.length ? shares[shares.length - 1] : undefined, last3: meanOfLast3(shares) })
    const carry = recent(carryShares), target = recent(targetShares), snap = recent(snapShares)
    const hasRole = Math.max(carry.last1 ?? 0, carry.last3 ?? 0) >= RBCandidateBuilder.minimumCarryShare
      || Math.max(target.last1 ?? 0, target.last3 ?? 0) >= RBCandidateBuilder.minimumTargetShare
      || (snap.last3 ?? 0) >= RBCandidateBuilder.minimumSnapShare
      || override?.carryShareEst !== undefined
    if (!(isMine || hasRole || this.alwaysInclude.has(player.id))) return undefined

    const redZoneShare = override?.redZoneShare ?? (teamRedZone > 0 ? redZone / teamRedZone : undefined)
    const flags: string[] = []
    if (override?.role === undefined) flags.push(games > 0 ? 'role inferred from usage' : 'role defaulted — no games yet')
    if (games === 0) flags.push('no games recorded this season')
    if (runs30 > 0) flags.push('long runs counted from longest run only')

    const passWeeks = [...teamTotals.values()].filter((w) => w.passAttempts > 0)
    let teamPassAttempts = passWeeks.reduce((s, w) => s + w.passAttempts, 0)
    if (passWeeks.length === 0 && teamTotals.size > 0) {
      teamPassAttempts = [...teamTotals.values()].reduce((s, w) => s + w.targets, 0) / 0.95
      flags.push('team pass attempts estimated from targets')
    }
    const teamRushAttempts = [...teamTotals.values()].reduce((s, w) => s + w.rushAttempts, 0)

    const game = this.teams[team]
    let practice = override?.practice ?? streamPracticeStatus(player, context)
    if (game === undefined) {
      practice = 'OUT'
      flags.push('bye week')
    } else if (game.linesSource === 'standard') {
      flags.push('no recorded line — neutral spread and total')
    }

    const steady = carryShares.length >= 2 && Math.abs((carry.last1 ?? 0) - (carry.last3 ?? 0)) < 0.08
    const roleConf = override?.roleConf ?? (steady ? 0.8 : games > 0 ? 0.65 : 0.5)
    const sources = ['Sleeper weekly stats']
    if (context.practiceReport(player.id) !== undefined) sources.push('nflverse practice report')

    return {
      name: player.name,
      team,
      role: override?.role ?? RBCandidateBuilder.inferRole(carry.last3, target.last3, redZoneShare),
      opponent: game ? opponentLabel(game) : 'BYE',
      home: game?.home,
      spreadOff: game?.spreadOff ?? 0,
      total: game?.total ?? RB_NEUTRAL_TOTAL,
      teamRushAttempts,
      teamPassAttempts,
      teamGames: teamTotals.size,
      carryShareLast1: carry.last1,
      carryShareLast3: carry.last3,
      carryShareEst: override?.carryShareEst,
      targetShareLast1: target.last1,
      targetShareLast3: target.last3,
      snapShare: snap.last3,
      roleConf,
      redZoneShare,
      statCarries: carries,
      rushYards,
      rushFirstDowns: sawRushFirstDowns ? rushFirstDowns : undefined,
      rushTouchdowns,
      runs30,
      runs40,
      runs50,
      statTargets: targets,
      receptions: games > 0 ? receptions : undefined,
      receivingYards,
      receivingFirstDowns: sawReceivingFirstDowns ? receivingFirstDowns : undefined,
      receivingTouchdowns,
      dvpPct: game?.dvpPct ?? 0,
      dvpGames: game?.dvpPct === undefined ? 0 : (game?.dvpGames ?? 0),
      lineAdj: game?.lineAdj ?? 1,
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

  /** The role a back's usage points to. */
  static inferRole(carryShare: number | undefined, targetShare: number | undefined, redZoneShare: number | undefined): RBRole {
    const carries = carryShare ?? 0, targets = targetShare ?? 0
    if (carries >= 0.58) return 'BELLCOW'
    if (carries >= 0.45) return 'LEAD'
    if (carries < 0.28 && targets >= 0.08) return 'PASS_DOWN'
    if (carries < 0.30 && redZoneShare !== undefined && redZoneShare >= 0.40) return 'GOAL_LINE'
    return 'COMMITTEE'
  }
}
