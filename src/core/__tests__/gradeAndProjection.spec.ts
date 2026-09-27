import { describe, expect, it } from 'vitest'
import { percentileRank } from '@core/Percentile'
import { applyScoringProfile, computePlayerGrade, computeWeightedGrade, gradeTier, isThin, topFactors, weeklyGradeWeights } from '@core/PlayerGrade'
import { projectCommandCenter, isValued, type CommandCenterInputs } from '@core/CommandCenterProjection'
import { baselineLines, MINIMUM_GAMES_FOR_LINE, seasonPaceBaselines } from '@core/Baselines'
import { runSeasonScan } from '@core/SeasonProfile'
import { parseSlots } from '@core/RosterSlots'
import { LEAGUE_DEFAULT } from '@core/ScoringProfile'
import type { Position } from '@core/Position'
import { weekly2025 } from '../../../tests/coreFixtures'

const cohort = Array.from({ length: 20 }, (_, i) => i + 1)

/** Port of PlayerGradeTests. */
describe('PlayerGrade', () => {
  it('ranks percentiles as the web app did', () => {
    const c = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect([percentileRank(5, c), percentileRank(10, c), percentileRank(0.5, c), percentileRank(5.5, c), percentileRank(5, [])]).toEqual([0.5, 1, 0, 0.5, 0.5])
  })

  it('grades the weighted percentile over metrics with data', () => {
    const g = computePlayerGrade(
      { targetShare: 15, targetsPerGame: 20, dropRate: 2 },
      { targetShare: cohort, targetsPerGame: cohort, dropRate: cohort, snapShare: cohort },
      { targetShare: 10, targetsPerGame: 10, dropRate: 10, snapShare: 10 },
    )
    expect([g.score, g.coverage, g.missing, isThin(g), gradeTier(g)]).toEqual([88, 0.75, ['snapShare'], false, 'Tier 1 — Elite'])
    expect(topFactors(g)[0]?.metric).toBe('targetsPerGame')
    expect(g.factors.find((f) => f.metric === 'dropRate')?.percentile).toBe(0.9)
  })

  it('excludes a thin cohort or missing value rather than defaulting', () => {
    const g = computePlayerGrade({ targetShare: 15 }, { targetShare: [1, 2, 3], snapShare: cohort }, { targetShare: 10, snapShare: 10 })
    expect([g.score, g.coverage, isThin(g), gradeTier(g)]).toEqual([undefined, 0, true, undefined])
  })

  it('nudges weights toward what the league pays', () => {
    const profile = { ...LEAGUE_DEFAULT, receptionPoints: 0, incompletion: -1, idpSack: 5, idpTackle: 0 }
    const wr = applyScoringProfile(weeklyGradeWeights('WR'), profile)
    expect([wr.targetsPerGame, wr.yardsPerTarget]).toEqual([7, 9])
    expect(applyScoringProfile(weeklyGradeWeights('QB'), profile).completionPct).toBe(11)
    const lb = applyScoringProfile(weeklyGradeWeights('LB'), profile)
    expect([lb.sacksPerGame, lb.tacklesPerGame, lb.targetShare]).toEqual([9, 5, undefined])
  })

  it('folds chips under visible weights and reports coverage', () => {
    const grade = computePlayerGrade({ pointsPerGame: 20 }, { pointsPerGame: cohort }, { pointsPerGame: 10 })
    const w = computeWeightedGrade(grade, [
      { metric: 'quarterbackPlay', value: 80, percentile: 0.5, detail: '', comparedTo: '32 teams' },
      { metric: 'teamPace', value: 60, detail: '', comparedTo: '' },
    ], { cohortGrade: 50, quarterbackPlay: 50 })
    expect(w.score).toBe(75)
    expect(w.missing).toContain('Team pace')
    expect(w.coverage).toBeLessThan(1)
    expect(w.parts[0]?.name).toBe('Cohort grade')
  })
})

/** Port of CommandCenterProjectionTests. */
describe('CommandCenterProjection', () => {
  const inputs = (o: Partial<CommandCenterInputs> = {}): CommandCenterInputs => ({ position: 'RB', thisSeasonGames: 0, ...o })

  it('regresses this season toward last season by games played', () => {
    const p = projectCommandCenter(inputs({ thisSeasonPointsPerGame: 30, thisSeasonGames: 2, lastSeasonPointsPerGame: 12 }))
    expect(p.pace).toBeCloseTo(18, 2)
    expect([p.weekly, p.restOfSeasonPerGame]).toEqual([18, 18])
    expect(p.factors.map((f) => f.name)).toEqual(['Pace', 'Usage', 'Matchup'])
  })

  it('uses the replacement line for a rookie, and last season with no games', () => {
    const rookie = projectCommandCenter(inputs({ thisSeasonPointsPerGame: 20, thisSeasonGames: 4, replacementLine: 8 }))
    expect(rookie.pace).toBeCloseTo(14, 2)
    expect(rookie.factors[0]!.detail).toContain('replacement line')
    expect(projectCommandCenter(inputs({ lastSeasonPointsPerGame: 15 })).weekly).toBe(15)
  })

  it('has no number, not zero, with nothing to project from', () => {
    const p = projectCommandCenter(inputs())
    expect([isValued(p), p.weekly]).toEqual([false, undefined])
    expect(p.note).toBeDefined()
  })

  it('bounds usage and matchup', () => {
    const p = projectCommandCenter(inputs({ thisSeasonPointsPerGame: 10, thisSeasonGames: 8, lastSeasonPointsPerGame: 10, expectedPointsRecent: 30, expectedPointsSeason: 10, opponentAllowedPerGame: 20, leagueAverageAllowed: 10 }))
    expect(p.pace).toBeCloseTo(10, 3)
    expect(Math.abs(p.weekly! - 10 * 1.2 * 1.25)).toBeLessThanOrEqual(0.05)
    expect(p.factors.find((f) => f.name === 'Usage')?.value).toBe(1.2)
    expect(p.factors.find((f) => f.name === 'Matchup')?.value).toBe(1.25)
  })

  it('uses the mean remaining matchup, and never divides by a zero average', () => {
    const p = projectCommandCenter(inputs({ thisSeasonPointsPerGame: 10, thisSeasonGames: 8, lastSeasonPointsPerGame: 10, opponentAllowedPerGame: 10, leagueAverageAllowed: 10, remainingOpponents: [{ allowed: 12, average: 10 }, { allowed: 8, average: 10 }] }))
    expect([p.weekly, p.restOfSeasonPerGame, p.factors.at(-1)?.name]).toEqual([10, 10, 'Remaining schedule'])
    expect(projectCommandCenter(inputs({ thisSeasonPointsPerGame: 10, thisSeasonGames: 8, lastSeasonPointsPerGame: 10, opponentAllowedPerGame: 5, leagueAverageAllowed: 0 })).weekly).toBe(10)
  })
})

/** Port of ProjectedLinesTests. */
describe('projected lines', () => {
  const template = parseSlots(['QB', 'RB', 'RB', 'WR', 'FLEX', 'BN'])

  it('takes the Nth best per dedicated slot times teams', () => {
    const lines = baselineLines({ RB: [30, 25, 20, 15, 10, 5], QB: [22, 18, 14] }, template, 2)
    expect([lines.RB?.starters, lines.RB?.startLine, lines.RB?.replacementLine]).toEqual([4, 15, 10])
    expect([lines.QB?.starters, lines.QB?.startLine, lines.QB?.replacementLine]).toEqual([2, 18, 14])
  })

  it('falls back to the worst of a shallow pool with no replacement', () => {
    const lines = baselineLines({ RB: [12, 9] }, template, 2)
    expect([lines.RB?.startLine, lines.RB?.replacementLine]).toEqual([9, undefined])
  })

  it('gives no line without a dedicated slot, values or teams', () => {
    const lines = baselineLines({ TE: [10, 8], WR: [] }, template, 2)
    expect([lines.TE, lines.WR]).toEqual([undefined, undefined])
    expect(baselineLines({ RB: [1] }, template, 0)).toEqual({})
  })

  it('builds season pace the same way', () => {
    const profiles = runSeasonScan(weekly2025(), LEAGUE_DEFAULT)
    const league = parseSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'])
    const byPosition: Partial<Record<Position, number[]>> = {}
    for (const p of profiles) if (p.games >= MINIMUM_GAMES_FOR_LINE) (byPosition[p.position] ??= []).push(p.pointsPerGame)
    expect(seasonPaceBaselines(profiles, league, 8)).toEqual(baselineLines(byPosition, league, 8))
  })
})
