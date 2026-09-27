import { describe, expect, it } from 'vitest'
import type { Position } from '@core/Position'
import { distribution, distributionOfWeeks } from '@core/Distribution'
import { ByeCalendar } from '@core/ByeWeeks'
import { KickoffCalendar, kickoffDate } from '@core/GameClock'
import { fuzzyScore } from '@core/FuzzyNameMatch'
import { DEPTH_WEIGHT, gradeLetter, gradeTeams } from '@core/TeamGrades'
import { percentileRank } from '@core/Percentile'
import { nflverseTeam } from '@core/NFLTeams'
import { decodeSchedule } from '@core/Schedule'
import { scoreSeason } from '@core/ScoringEngine'
import { LEAGUE_DEFAULT } from '@core/ScoringProfile'
import { parseSlots } from '@core/RosterSlots'
import { optimizeLineup } from '@core/LineupOptimizer'
import { Player, schedule, weekly2025 } from '../../../tests/coreFixtures'

const utc = (iso: string) => Date.parse(iso)

/** Port of DistributionTests. */
describe('Distribution', () => {
  it('uses p20 and p80, not min and max', () => {
    const d = distribution([0, 10, 11, 12, 13, 14, 15, 16, 17, 60])
    expect([d.floor, d.ceiling, d.median, d.sampleCount]).toEqual([10.8, 16.2, 13.5, 10])
  })

  it('has no coefficient at a zero mean, and no claims when empty', () => {
    const zero = distribution([0, 0, 0, 0])
    expect([zero.coefficientOfVariation, zero.mean, zero.standardDeviation]).toEqual([undefined, 0, 0])
    expect(distribution([-2, 0, 1, 0.4]).coefficientOfVariation).toBeUndefined()
    expect(distribution([])).toEqual({ sampleCount: 0 })
  })

  it('makes a single week its own floor and ceiling', () => {
    const d = distribution([18.4])
    expect([d.floor, d.ceiling, d.standardDeviation]).toEqual([18.4, 18.4, 0])
  })

  it('matches real season ranges', () => {
    const file = weekly2025()
    const allen = distributionOfWeeks(scoreSeason(file.rows(Player.joshAllen), LEAGUE_DEFAULT, 'QB').weeks)
    expect([allen.sampleCount, allen.floor, allen.median, allen.ceiling, allen.mean, allen.standardDeviation, allen.coefficientOfVariation])
      .toEqual([16, 12.3, 30.17, 44.55, 29.89, 17.38, 0.58])
    const rodgers = distributionOfWeeks(scoreSeason(file.rows(Player.aaronRodgers), LEAGUE_DEFAULT, 'QB').weeks)
    expect([rodgers.floor, rodgers.ceiling, rodgers.coefficientOfVariation]).toEqual([-2, 25.85, 0.86])
  })
})

/** Port of ByeWeeksTests. */
describe('ByeCalendar', () => {
  const calendar = new ByeCalendar(schedule(2025))

  it('finds all 32 teams in the nflverse dialect', () => {
    expect(calendar.teams).toHaveLength(32)
    expect(calendar.teams).toEqual([...calendar.teams].sort())
    expect(calendar.teams).toContain('LA')
    expect(calendar.teams).not.toContain('LAR')
  })

  it("reproduces known weeks' byes exactly, one per team", () => {
    expect(calendar.byWeek[5]).toEqual(['ATL', 'CHI', 'GB', 'PIT'])
    expect(calendar.byWeek[6]).toEqual(['HOU', 'MIN'])
    expect(calendar.byWeek[8]).toEqual(['ARI', 'DET', 'JAX', 'LA', 'LV', 'SEA'])
    expect(calendar.byWeek[10]).toEqual(['CIN', 'DAL', 'KC', 'TEN'])
    expect(Object.keys(calendar.byTeam)).toHaveLength(32)
    expect(Object.keys(calendar.byWeek).map(Number).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 14])
    expect(Object.values(calendar.byWeek).reduce((n, t) => n + t.length, 0)).toBe(32)
  })

  it('invents no byes for a week with no games', () => {
    const padded = new ByeCalendar({ byWeek: { ...schedule(2025).byWeek, 19: [], 20: [] } })
    expect(padded.byWeek[19]).toBeUndefined()
    expect(padded.byWeek[20]).toBeUndefined()
    expect(Object.keys(padded.byTeam)).toHaveLength(32)
  })

  it('needs the Rams normalised', () => {
    expect(calendar.byTeam.LA).toBe(8)
    expect(calendar.isOnBye('LAR', 8)).toBe(false)
    expect(calendar.isOnBye(nflverseTeam('LAR'), 8)).toBe(true)
    expect(calendar.byeTeams(1).size).toBe(0)
    expect(calendar.byeTeams(8).size).toBe(6)
  })

  it('works on 2026 and records the earliest week', () => {
    const c2026 = new ByeCalendar(schedule(2026))
    expect([c2026.teams.length, Object.keys(c2026.byTeam).length]).toEqual([32, 32])
    expect(Object.values(c2026.byWeek).reduce((n, t) => n + t.length, 0)).toBe(32)
    const small = new ByeCalendar(decodeSchedule(JSON.parse('{"byWeek":{"2":[{"home":"PHI","away":"DAL"}],"1":[{"home":"PHI","away":"DAL"},{"home":"KC","away":"BUF"}],"3":[{"home":"KC","away":"BUF"}]}}')))
    expect(small.teams).toEqual(['BUF', 'DAL', 'KC', 'PHI'])
    expect([small.byTeam.KC, small.byTeam.BUF, small.byTeam.PHI]).toEqual([2, 2, 3])
  })
})

/** Port of GameClockTests. */
describe('KickoffCalendar', () => {
  const calendar = new KickoffCalendar(schedule(2025))

  it('reads kickoffs as US Eastern across the clock change', () => {
    expect(calendar.kickoff('PHI', 1)).toBe(utc('2025-09-05T00:20:00Z'))
    expect(calendar.kickoff('DAL', 1)).toBe(utc('2025-09-05T00:20:00Z'))
    expect(calendar.kickoff('ATL', 1)).toBe(utc('2025-09-07T17:00:00Z'))
    expect(calendar.kickoff('CAR', 10)).toBe(utc('2025-11-09T18:00:00Z'))
  })

  it('treats malformed times as missing, and normalises Sleeper codes', () => {
    expect(kickoffDate({ home: 'PHI', away: 'DAL', kickoff: '2025-09-04', time: 'TBD' })).toBeUndefined()
    expect(kickoffDate({ home: 'PHI', away: 'DAL', kickoff: '2025-09-04' })).toBeUndefined()
    expect(calendar.kickoff('LAR', 7)).toBeDefined()
    expect(calendar.kickoff('LAR', 7)).toBe(calendar.kickoff('LA', 7))
  })

  it('locks early games only, mid-Sunday', () => {
    const now = utc('2025-10-19T18:30:00Z')
    expect(['JAX', 'CHI', 'CIN'].every((t) => calendar.isLocked(t, 7, now))).toBe(true)
    const late = ['GB', 'ARI', 'SF', 'ATL', 'DAL', 'WAS', 'DEN', 'NYG', 'IND', 'LAC', 'TB', 'DET', 'SEA', 'HOU']
    expect(late.some((t) => !calendar.isLocked(t, 7, now))).toBe(true)
  })

  it('locks at the kickoff instant, never on a bye, and is live for four hours', () => {
    const kickoff = calendar.kickoff('PHI', 1)!
    expect(calendar.isLocked('PHI', 1, kickoff - 1000)).toBe(false)
    expect(calendar.isLocked('PHI', 1, kickoff)).toBe(true)
    expect(calendar.kickoff('BUF', 7)).toBeUndefined()
    expect(calendar.isLocked('BUF', 7, utc('2025-10-21T00:00:00Z'))).toBe(false)
    expect(calendar.isLive('PHI', 1, kickoff - 60_000)).toBe(false)
    expect(calendar.isLive('PHI', 1, kickoff + 60_000)).toBe(true)
    expect(calendar.isLive('PHI', 1, kickoff + KickoffCalendar.LIVE_WINDOW_MS + 60_000)).toBe(false)
  })

  it('lists lock windows and finds the next lock', () => {
    const windows = calendar.lockWindows(7)
    expect(windows).toEqual([...windows].sort((a, b) => a - b))
    expect(new Set(windows).size).toBe(windows.length)
    expect(windows[0]).toBe(utc('2025-10-17T00:15:00Z'))
    expect(calendar.nextLock(7, ['CHI', 'GB', undefined, 'BUF'], utc('2025-10-19T18:30:00Z'))).toBe(calendar.kickoff('GB', 7))
  })
})

/** Port of LockedLineupOptimizerTests. */
describe('LineupOptimizer with locked players', () => {
  const positions: Record<string, Position> = { qb1: 'QB', qb2: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR' }
  const template = parseSlots(['QB', 'RB', 'RB', 'FLEX'])
  const optimize = (starters: string[], roster: string[], values: Record<string, number>, locked: string[]) =>
    optimizeLineup({ currentStarterIDs: starters, playerIDs: roster, template, positions: (id) => positions[id], valueOf: (id) => values[id], locked: new Set(locked) })
  const starters = ['qb1', 'rb1', 'rb2', 'wr1']

  it('never swaps a locked starter out or starts a locked bench player', () => {
    const a = optimize(starters, ['qb1', 'qb2', 'rb1', 'rb2', 'wr1'], { qb1: 5, qb2: 30, rb1: 10, rb2: 9, wr1: 8 }, ['qb1'])
    expect(a.proposedIDs[0]).toBe('qb1')
    expect(a.swaps.some((s) => s.outID === 'qb1' || s.inID === 'qb2')).toBe(false)
    const b = optimize(starters, ['qb1', 'rb1', 'rb2', 'rb3', 'wr1'], { qb1: 20, rb1: 10, rb2: 9, rb3: 25, wr1: 8 }, ['rb3'])
    expect(b.proposedIDs).not.toContain('rb3')
    expect(b.unranked).not.toContain('rb3')
  })

  it('keeps full-lineup indices and totals', () => {
    const values = { qb1: 20, rb1: 10, rb2: 4, rb3: 12, wr1: 8 }
    const roster = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1']
    const a = optimize(starters, roster, values, ['rb1'])
    expect(a.proposedIDs[1]).toBe('rb1')
    const swap = a.swaps.find((s) => s.inID === 'rb3')!
    expect([swap.outID, swap.slotIndex]).toEqual(['rb2', 2])
    const b = optimize(starters, roster, values, ['qb1'])
    expect([b.currentTotal, b.proposedTotal, b.gain]).toEqual([42, 50, 8])
  })

  it('matches the plain optimizer with no locks, and proposes nothing when all are locked', () => {
    const values = { qb1: 20, qb2: 22, rb1: 10, rb2: 4, rb3: 12, wr1: 8 }
    const roster = ['qb1', 'qb2', 'rb1', 'rb2', 'rb3', 'wr1']
    const plain = optimizeLineup({ currentStarterIDs: starters, playerIDs: roster, template, positions: (id) => positions[id], valueOf: (id) => (values as Record<string, number>)[id] })
    expect(optimize(starters, roster, values, [])).toEqual(plain)
    const all = optimize(starters, roster, { qb1: 1, qb2: 30, rb1: 1, rb2: 1, rb3: 30, wr1: 1 }, starters)
    expect(all.swaps).toEqual([])
    expect(all.proposedIDs).toEqual(starters)
  })
})

/** Port of FuzzyNameMatchTests. */
describe('FuzzyNameMatch', () => {
  const matches = (q: string, name: string, extra: string[] = []) => fuzzyScore(q, name, extra) !== undefined

  it('forgives a typo in any word, in any order, with the team', () => {
    expect(matches('Cedric Grey', 'Cedric Gray')).toBe(true)
    expect(matches('bolten', 'Nick Bolton')).toBe(true)
    expect(matches('anthony hil', 'Anthony Hill Jr.')).toBe(true)
    expect(matches('smtih', "D'Anthony Smith")).toBe(true)
    expect(matches('gray ten', 'Cedric Gray', ['TEN', 'Tennessee Titans'])).toBe(true)
    expect(matches('titans gray', 'Cedric Gray', ['TEN', 'Tennessee Titans'])).toBe(true)
    expect(matches('gray kc', 'Cedric Gray', ['TEN', 'Tennessee Titans'])).toBe(false)
  })

  it('ignores punctuation; short words must be exact or prefixes', () => {
    expect(matches('danthony', "D'Anthony Smith")).toBe(true)
    expect(matches('smith-njigba', 'Jaxon Smith-Njigba')).toBe(true)
    expect(matches('aj', 'A.J. Brown')).toBe(true)
    expect(matches('gry', 'Cedric Gray')).toBe(false)
    expect(matches('gra', 'Cedric Gray')).toBe(true)
    expect(matches('xyz', 'Cedric Gray')).toBe(false)
  })

  it('scores closer matches higher', () => {
    const exact = fuzzyScore('gray', 'Cedric Gray')!
    const typo = fuzzyScore('grey', 'Cedric Gray')!
    const prefix = fuzzyScore('gra', 'Cedric Gray')!
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(typo)
  })
})

/** Port of TeamGradesTests, plus Percentile. */
describe('TeamGrades and Percentile', () => {
  it('grades from lineup and depth', () => {
    const g = Object.fromEntries(gradeTeams([
      { rosterID: 1, lineupPoints: 150, shortWeeks: 0, remainingWeeks: 10 },
      { rosterID: 2, lineupPoints: 100, shortWeeks: 5, remainingWeeks: 10 },
      { rosterID: 3, lineupPoints: 125, shortWeeks: 0, remainingWeeks: 10 },
      { rosterID: 4, shortWeeks: 0, remainingWeeks: 10 },
    ]).map((t) => [t.rosterID, t]))
    expect([g[1]!.lineupScore, g[1]!.score, g[1]!.letter, g[1]!.rank]).toEqual([100, 100, 'A+', 1])
    expect([g[2]!.lineupScore, g[2]!.depthScore, g[2]!.score, g[2]!.letter]).toEqual([0, 50, Math.round(50 * DEPTH_WEIGHT), 'F'])
    expect([g[3]!.lineupScore, g[3]!.letter]).toEqual([50, 'B'])
    expect([g[4]!.letter, g[4]!.depthScore]).toEqual([undefined, 100])
    expect([gradeLetter(90), gradeLetter(79.9), gradeLetter(0)]).toEqual(['A+', 'B+', 'F'])
  })

  it('ranks against a sorted cohort', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(0.5)
    expect(percentileRank(0, [1, 2])).toBe(0)
    expect(percentileRank(3, [1, 2])).toBe(1)
    expect(percentileRank(3, [])).toBe(0.5)
  })
})
