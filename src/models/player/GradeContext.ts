/**
 * Every player's current-season grade metrics, the cohorts they rank against,
 * and the team numbers the situation chips compare — a port of FCApp
 * `GradeContext`. All this season, all real, nothing defaulted.
 */
import { nflverseTeam } from '@core/NFLTeams'
import { formatFixed } from '@core/numeric'
import { percentileRank } from '@core/Percentile'
import { applyScoringProfile, computePlayerGrade, weeklyGradeWeights, type GradeMetric, type PlayerGrade, type SituationChip, type SituationMetric } from '@core/PlayerGrade'
import { IDP, type Position } from '@core/Position'
import { weekLines } from '@core/Schedule'
import type { ScoringProfile } from '@core/ScoringProfile'
import type { TeamContextWeek, UsageWeek } from '@core/InSeasonFiles'
import { defensiveSnapShare, linePosition, offensiveSnapShare, played, scoreLine } from '@data/insightsModels'
import { statWeeks } from '../league/InSeasonData'
import type { LeagueContext } from '../league/LeagueContext'

interface Totals {
  games: number
  sums: Map<string, number>
  points: number
}
const get = (t: Totals, key: string) => t.sums.get(key) ?? 0

interface TeamTotals {
  targets: number
  airYards: number
  redZone: number
  targetsByPlayer: Map<string, number>
}

type Metrics = Partial<Record<GradeMetric, number>>

/** Minimum average snap share to join a cohort; below it rates are noise. */
export const MINIMUM_SNAP_SHARE = 0.25

export function passerRating(cmp: number, att: number, yds: number, td: number, int: number): number | undefined {
  if (!(att > 0)) return undefined
  const c = (x: number) => Math.max(0, Math.min(2.375, x))
  const a = c((cmp / att - 0.3) * 5)
  const b = c((yds / att - 3) * 0.25)
  const d1 = c((td / att) * 20)
  const d2 = c(2.375 - (int / att) * 25)
  return ((a + b + d1 + d2) / 6) * 100
}

export class GradeContext {
  private constructor(
    readonly metricsByPlayer: ReadonlyMap<string, Metrics>,
    readonly cohorts: Partial<Record<Position, Partial<Record<GradeMetric, number[]>>>>,
    /** Players who qualified for their position's cohort. */
    readonly qualified: ReadonlySet<string>,
    private readonly profile: ScoringProfile,
    private readonly context: LeagueContext,
    private readonly snapSharesByPlayer: ReadonlyMap<string, number[]>,
    private readonly teamTotals: ReadonlyMap<string, TeamTotals>,
    private readonly playerTeam: ReadonlyMap<string, string>,
    private readonly playerTotals: ReadonlyMap<string, Totals>,
  ) {}

  static build(context: LeagueContext): GradeContext {
    const scoring = context.league.scoringSettings ?? {}
    const totals = new Map<string, Totals>()
    const positions = new Map<string, Position>()
    const teamOf = new Map<string, string>()
    const teams = new Map<string, TeamTotals>()
    const snaps = new Map<string, number[]>()

    for (const week of statWeeks(context.inSeason)) {
      const lines = context.inSeason.weekStats.get(week)
      if (!lines) continue
      for (const line of lines.values()) {
        if (!played(line)) continue
        const position = linePosition(line)
        if (!position) continue
        const id = line.playerID
        positions.set(id, position)
        const t = totals.get(id) ?? { games: 0, sums: new Map(), points: 0 }
        t.games += 1
        t.points += scoreLine(line, scoring).points
        for (const [k, v] of Object.entries(line.stats)) t.sums.set(k, (t.sums.get(k) ?? 0) + v)
        totals.set(id, t)
        const share = IDP.has(position) ? defensiveSnapShare(line) : offensiveSnapShare(line)
        if (share !== undefined) { if (!snaps.has(id)) snaps.set(id, []); snaps.get(id)!.push(share) }
        if (line.team) {
          const team = nflverseTeam(line.team) ?? line.team
          teamOf.set(id, team)
          const tt = teams.get(team) ?? { targets: 0, airYards: 0, redZone: 0, targetsByPlayer: new Map() }
          const tgt = line.stats.rec_tgt ?? 0
          tt.targets += tgt
          tt.airYards += line.stats.rec_air_yd ?? 0
          tt.redZone += (line.stats.rec_rz_tgt ?? 0) + (line.stats.rush_rz_att ?? 0)
          if (tgt > 0) tt.targetsByPlayer.set(id, (tt.targetsByPlayer.get(id) ?? 0) + tgt)
          teams.set(team, tt)
        }
      }
    }

    const metrics = new Map<string, Metrics>()
    const qualified = new Set<string>()
    const cohorts: Partial<Record<Position, Partial<Record<GradeMetric, number[]>>>> = {}
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    for (const [id, t] of totals) {
      const position = positions.get(id)
      if (!position || t.games <= 0) continue
      const g = t.games
      const m: Metrics = { pointsPerGame: t.points / g }
      const shares = snaps.get(id) ?? []
      const snapShare = shares.length ? avg(shares) : undefined
      switch (position) {
        case 'QB': case 'RB': case 'WR': case 'TE': {
          if (snapShare !== undefined) m.snapShare = snapShare
          const rushAtt = get(t, 'rush_att'), rec = get(t, 'rec'), tgt = get(t, 'rec_tgt')
          m.touchesPerGame = (rushAtt + rec) / g
          m.rushAttemptsPerGame = rushAtt / g
          m.targetsPerGame = tgt / g
          m.redZoneTouchesPerGame = (get(t, 'rec_rz_tgt') + get(t, 'rush_rz_att')) / g
          const team = teamOf.get(id)
          const tt = team ? teams.get(team) : undefined
          if (tt) {
            if (tt.targets > 0) m.targetShare = tgt / tt.targets
            if (tt.airYards > 0) m.airYardsShare = get(t, 'rec_air_yd') / tt.airYards
          }
          if (tgt >= 5) {
            m.yardsPerTarget = get(t, 'rec_yd') / tgt
            m.catchRate = rec / tgt
            if (t.sums.has('rec_drop')) m.dropRate = get(t, 'rec_drop') / tgt
          }
          if (position === 'QB' && get(t, 'pass_att') >= 10) {
            const att = get(t, 'pass_att')
            m.completionPct = get(t, 'pass_cmp') / att
            m.yardsPerAttempt = get(t, 'pass_yd') / att
            m.interceptionRate = get(t, 'pass_int') / att
            m.sackRate = get(t, 'pass_sack') / (att + get(t, 'pass_sack'))
            const rating = passerRating(get(t, 'pass_cmp'), att, get(t, 'pass_yd'), get(t, 'pass_td'), get(t, 'pass_int'))
            if (rating !== undefined) m.passerRating = rating
          }
          const gsis = context.gsisIDsBySleeper.get(id)
          const usage = gsis !== undefined ? context.inSeason.usage?.weeks(gsis) : undefined
          if (usage && usage.length) {
            const pick = (f: (u: UsageWeek) => number | undefined) => usage.map(f).filter((x): x is number => x !== undefined)
            const xfp = pick((u) => u.expectedPoints)
            if (xfp.length) m.expectedPointsPerGame = avg(xfp)
            const ybc = pick((u) => u.yardsBeforeContactPerAttempt)
            if (ybc.length) m.yardsBeforeContact = avg(ybc)
            const yac = pick((u) => u.yardsAfterContactPerAttempt)
            if (yac.length) m.yardsAfterContact = avg(yac)
            const broken = pick((u) => u.brokenTackles)
            const touches = rushAtt + rec
            if (broken.length && touches >= 10) m.brokenTacklesPerTouch = broken.reduce((s, v) => s + v, 0) / touches
          }
          if ((snapShare ?? 0) >= MINIMUM_SNAP_SHARE || (position === 'QB' && get(t, 'pass_att') >= 10 * g)) qualified.add(id)
          break
        }
        case 'K':
          if (get(t, 'fga') > 0) m.fieldGoalPct = get(t, 'fgm') / get(t, 'fga')
          m.fieldGoalAttemptsPerGame = get(t, 'fga') / g
          if (get(t, 'fga') + get(t, 'xpa') > 0) qualified.add(id)
          break
        case 'DEF':
          m.pointsAllowedPerGame = get(t, 'pts_allow') / g
          m.takeawaysPerGame = (get(t, 'int') + get(t, 'fum_rec')) / g
          m.defensiveSacksPerGame = get(t, 'sack') / g
          qualified.add(id)
          break
        case 'LB': case 'DL': case 'DB': {
          if (snapShare !== undefined) m.defensiveSnapShare = snapShare
          const tackles = t.sums.has('idp_tkl') ? get(t, 'idp_tkl') : get(t, 'idp_tkl_solo') + get(t, 'idp_tkl_ast')
          m.tacklesPerGame = tackles / g
          m.sacksPerGame = get(t, 'idp_sack') / g
          m.passesDefendedPerGame = get(t, 'idp_pass_def') / g
          if ((snapShare ?? 0) >= MINIMUM_SNAP_SHARE) qualified.add(id)
          break
        }
      }
      metrics.set(id, m)
      if (qualified.has(id)) {
        const byMetric = (cohorts[position] ??= {})
        for (const [metric, value] of Object.entries(m) as [GradeMetric, number][]) {
          if (Number.isFinite(value)) (byMetric[metric] ??= []).push(value)
        }
      }
    }
    for (const byMetric of Object.values(cohorts)) for (const list of Object.values(byMetric!)) list!.sort((a, b) => a - b)
    return new GradeContext(metrics, cohorts, qualified, context.scoring.profile, context, snaps, teams, teamOf, totals)
  }

  grade(id: string): PlayerGrade | undefined {
    const position = this.context.position(id)
    const metrics = this.metricsByPlayer.get(id)
    if (!position || !metrics) return undefined
    const weights = applyScoringProfile(weeklyGradeWeights(position), this.profile)
    return computePlayerGrade(metrics, this.cohorts[position] ?? {}, weights)
  }

  chips(id: string): SituationChip[] {
    const { context } = this
    const position = context.position(id)
    if (!position) return []
    const team = this.playerTeam.get(id) ?? context.nflTeam(id)
    const out: SituationChip[] = []
    const teamFile = context.inSeason.teamContext
    const allTeams = teamFile?.allTeams() ?? {}
    const teamMean = (weeks: TeamContextWeek[], key: (w: TeamContextWeek) => number | undefined) => {
      const values = weeks.map(key).filter((v): v is number => v !== undefined)
      return values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined
    }
    const leagueSet = (key: (w: TeamContextWeek) => number | undefined) =>
      Object.values(allTeams).map((w) => teamMean(w, key)).filter((v): v is number => v !== undefined).sort((a, b) => a - b)
    const teamChip = (metric: SituationMetric, detail: (v: number) => string, key: (w: TeamContextWeek) => number | undefined, inverted = false) => {
      if (!team || !teamFile) return
      const value = teamMean(teamFile.weeks(team), key)
      if (value === undefined) return
      const set = leagueSet(key)
      if (set.length < 12) return
      let pct = percentileRank(value, set)
      if (inverted) pct = 1 - pct
      out.push({ metric, value, percentile: pct, detail: detail(value), comparedTo: `${set.length} teams` })
    }
    const pctIf = (value: number, set: number[], inverted = false) => (set.length >= 12 ? (inverted ? 1 - percentileRank(value, set) : percentileRank(value, set)) : undefined)
    const samePosition = (f: (p: string) => number | undefined) =>
      [...this.qualified].filter((p) => context.position(p) === position).map(f).filter((v): v is number => v !== undefined).sort((a, b) => a - b)

    if (position === 'QB' || position === 'WR' || position === 'TE') {
      teamChip('passProtection', (v) => `pressured on ${formatFixed(v, 0)}% of dropbacks`, (w) => (w.pressureRate === undefined ? undefined : w.pressureRate * 100), true)
    }
    if (position === 'RB' || position === 'QB') {
      teamChip('runBlocking', (v) => `${formatFixed(v, 1)} yards before contact per carry`, (w) => w.yardsBeforeContactPerAttempt)
    }
    if (position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE') {
      teamChip('quarterbackPlay', (v) => `QBR ${formatFixed(v, 0)}`, (w) => w.qbr)
      teamChip('teamPace', (v) => `${formatFixed(v, 0)} plays per game`, (w) => w.plays)
    }
    if (position === 'RB' || position === 'WR' || position === 'TE') {
      // The share of team targets the top two *other* pass-catchers take; less is better.
      const competition = (player: string) => {
        const tm = this.playerTeam.get(player)
        const tt = tm ? this.teamTotals.get(tm) : undefined
        if (!tt || !(tt.targets > 0)) return undefined
        const others = [...tt.targetsByPlayer].filter(([k]) => k !== player).map(([, v]) => v).sort((a, b) => b - a).slice(0, 2)
        return others.reduce((s, v) => s + v, 0) / tt.targets
      }
      const comp = competition(id)
      if (comp !== undefined) {
        const set = samePosition(competition)
        out.push({ metric: 'targetCompetition', value: comp, percentile: pctIf(comp, set, true), detail: `top two teammates take ${formatFixed(comp * 100, 0)}% of targets`, comparedTo: `${set.length} ${position}s` })
      }
      const ays = this.metricsByPlayer.get(id)?.airYardsShare
      if (ays !== undefined) {
        const set = this.cohorts[position]?.airYardsShare ?? []
        out.push({ metric: 'airYardsShare', value: ays, percentile: pctIf(ays, set), detail: `${formatFixed(ays * 100, 0)}% of team air yards`, comparedTo: `${set.length} ${position}s` })
      }
      const redZoneShare = (player: string) => {
        const tm = this.playerTeam.get(player)
        const tt = tm ? this.teamTotals.get(tm) : undefined
        const t = this.playerTotals.get(player)
        if (!tt || !(tt.redZone > 0) || !t) return undefined
        return (get(t, 'rec_rz_tgt') + get(t, 'rush_rz_att')) / tt.redZone
      }
      const rz = redZoneShare(id)
      if (rz !== undefined) {
        const set = samePosition(redZoneShare)
        out.push({ metric: 'redZoneShare', value: rz, percentile: pctIf(rz, set), detail: `${formatFixed(rz * 100, 0)}% of team red zone touches`, comparedTo: `${set.length} ${position}s` })
      }
    }
    const lines = weekLines(context.schedule, context.currentWeek)
    const implied = team ? lines[team]?.impliedTotal : undefined
    if (implied !== undefined) {
      const set = Object.values(lines).map((l) => l.impliedTotal).filter((v): v is number => v !== undefined).sort((a, b) => a - b)
      out.push({ metric: 'gameEnvironment', value: implied, percentile: pctIf(implied, set), detail: `implied ${formatFixed(implied, 1)} points this week (recorded line)`, comparedTo: `${set.length} teams this week` })
    }
    const trend = (player: string) => {
      const shares = this.snapSharesByPlayer.get(player)
      if (!shares || shares.length < 2) return undefined
      const season = shares.reduce((s, v) => s + v, 0) / shares.length
      const recent = shares.slice(-3)
      return recent.reduce((s, v) => s + v, 0) / recent.length - season
    }
    const tr = position !== 'K' && position !== 'DEF' ? trend(id) : undefined
    if (tr !== undefined) {
      const set = samePosition(trend)
      out.push({ metric: 'snapTrend', value: tr, percentile: pctIf(tr, set), detail: `last 3 games ${formatFixed(tr * 100, 0, { sign: true })} points of snap share against his season`, comparedTo: `${set.length} ${position}s` })
    }
    const gsis = context.gsisIDsBySleeper.get(id)
    const rank = gsis !== undefined ? context.inSeason.depthCharts?.rank(gsis, team, position) : undefined
    if (rank !== undefined) {
      out.push({ metric: 'depthChartRank', value: rank + 1, detail: `listed #${rank + 1} at ${position} on the official depth chart`, comparedTo: 'his team' })
    }
    return out
  }
}
