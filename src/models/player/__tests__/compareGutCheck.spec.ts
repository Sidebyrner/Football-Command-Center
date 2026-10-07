import { describe, expect, it } from 'vitest'
import { assessGutCheck, buildGutCheck, buildStartGutCheck, luck, type GutConfidence, type GutPoint } from '@models/player/CompareGutCheck'
import { computeVerdict, verdictInputs, type VerdictLeague } from '@models/player/CompareVerdict'
import type { PlayerLogWeek } from '@models/player/PlayerCardModel'
import { PlayerComparison, type ComparisonPlayer } from '@models/player/PlayerComparison'
import { computeStartVerdict, posture, type StartVerdict } from '@models/player/StartVerdict'

/** Port of CompareGutCheckTests.swift — same inputs, same strings. */
describe('CompareGutCheck', () => {
  const now = new Date(1_790_000_000 * 1000)
  const week = (w: number, points?: number, expected?: number, snaps?: number): PlayerLogWeek =>
    ({ week: w, played: true, points, expectedPoints: expected, snapShare: snaps })
  const player = (name: string, o: Partial<ComparisonPlayer> = {}): ComparisonPlayer =>
    ({ id: name.toLowerCase(), name, position: 'WR', seriesIndex: 0, log: [], values: {}, ...o })
  const texts = (points: readonly GutPoint[]) => points.map((p) => p.text).join(' | ')

  it('an unlucky player has a case', () => {
    const bravo = player('Bravo', { log: [week(1, 6, 11), week(2, 7, 12)] })
    const check = assessGutCheck(player('Alpha'), bravo, 0.3, now)
    expect(texts(check.caseForAlternative)).toContain('Scoring 5.0 pts/gm under his expected points')
    expect(check.caseForAlternative[0]!.strength).toBe(2)
  })

  it('luck falls back to the table values', () => {
    expect(luck(player('Bravo', { values: { expectedPointsLast4: 12, pointsPerGame: 9 } }))).toBe(3)
  })

  it('a growing role and a hot stretch', () => {
    const log = [week(1, 5, undefined, 0.40), week(2, 6, undefined, 0.46), week(3, 14, undefined, 0.70), week(4, 16, undefined, 0.76)]
    const bravo = player('Bravo', { log, values: { pointsPerGame: 9 } })
    const text = texts(assessGutCheck(player('Alpha'), bravo, 0.3, now).caseForAlternative)
    expect(text).toContain('Snap share up from 43% to 73%')
    expect(text).toContain('Averaging 12.0 over his last 3, up from 9.0')
  })

  it('ceiling, depth and schedule', () => {
    const alpha = player('Alpha', { depthRank: 2, ceiling: 18, strengthOfSchedule: 0.95 })
    const bravo = player('Bravo', { depthRank: 1, ceiling: 27, strengthOfSchedule: 1.10 })
    const text = texts(assessGutCheck(alpha, bravo, 0.3, now).caseForAlternative)
    expect(text).toContain('Best game 27.0 vs 18.0')
    expect(text).toContain('First on his depth chart; Alpha is No. 2.')
    expect(text).toContain('Softer schedule ahead (1.10× vs 0.95×)')
  })

  it('risks for the pick', () => {
    const alpha = player('Alpha', { values: { expectedPointsLast4: 8, pointsPerGame: 13 }, injuryDesignation: 'Questionable' })
    const text = texts(assessGutCheck(alpha, player('Bravo'), 0.3, now).risksForPick)
    expect(text).toContain('Alpha is listed Questionable.')
    expect(text).toContain('scoring 5.0 pts/gm over his expected points')
  })

  it('recent news is context only and old news is dropped', () => {
    const recent = { title: 'Named the starter', published: new Date(now.getTime() - 3_600_000) }
    const fresh = assessGutCheck(player('Alpha'), player('Bravo', { headline: recent }), 0.3, now)
    expect(fresh.caseForAlternative.map((p) => p.strength)).toEqual([0])
    expect(fresh.confidence).toBe('clear')
    const old = { title: 'Old news', published: new Date(now.getTime() - 10 * 24 * 3_600_000) }
    expect(assessGutCheck(player('Alpha'), player('Bravo', { headline: old }), 0.3, now).caseForAlternative).toEqual([])
  })

  it('confidence bands', () => {
    const strong = player('Bravo', { log: [week(1, 4, 10), week(2, 5, 11)], ceiling: 30 })
    expect(assessGutCheck(player('Alpha'), player('Bravo'), 0.02, now).confidence).toBe('coinFlip')
    expect(assessGutCheck(player('Alpha'), strong, 0.10, now).confidence).toBe('coinFlip')
    expect(assessGutCheck(player('Alpha'), player('Bravo'), 0.08, now).confidence).toBe('lean')
    expect(assessGutCheck(player('Alpha'), strong, 0.4, now).confidence).toBe('lean')
    const clear = assessGutCheck(player('Alpha'), player('Bravo'), 0.4, now)
    expect(clear.confidence).toBe('clear')
    expect(clear.summary).toContain('Paper and gut agree')
  })

  it("build follows the verdict's pick and alternative", () => {
    const alpha = player('Alpha', { values: { restOfSeason: 14, projectedThisWeek: 14, expectedPointsLast4: 14 }, availability: { kind: 'mine' } })
    const bravo = player('Bravo', { values: { restOfSeason: 9, projectedThisWeek: 9, expectedPointsLast4: 9 }, availability: { kind: 'freeAgent' } })
    const league: VerdictLeague = { waivers: { kind: 'reverseStandings' }, teamCount: 8, currentWeek: 1, playoffStartWeek: 15 }
    const comparison = new PlayerComparison([alpha, bravo], 4, [])
    const check = buildGutCheck(comparison, computeVerdict(verdictInputs(comparison), league), now)
    expect([check?.pickName, check?.alternativeName]).toEqual(['Alpha', 'Bravo'])
    const single = new PlayerComparison([alpha], 4, [])
    expect(buildGutCheck(single, computeVerdict(verdictInputs(single), league), now)).toBeUndefined()
  })

  // MARK: - This week

  const start = (pick: string, alternative: string, confidence: GutConfidence): StartVerdict => {
    const inputs = [{ id: pick.toLowerCase(), name: pick, signals: { projected: 20 } },
                    { id: alternative.toLowerCase(), name: alternative, signals: { projected: 5 } }]
    const verdict = computeStartVerdict(inputs, posture.unknown)
    return { ranked: verdict.ranked, blocked: [], headline: verdict.headline, pickID: verdict.pickID,
             alternativeID: verdict.alternativeID, confidence, thinData: false, edgeLine: undefined,
             postureLine: '', votingSignals: [], signalLeaders: {}, contingency: undefined, notes: [] }
  }

  it("this week drops the schedule and keeps the tally's confidence", () => {
    const alpha = player('Alpha', { depthRank: 1, strengthOfSchedule: 0.90 })
    const bravo = player('Bravo', { depthRank: 1, strengthOfSchedule: 1.20 })
    const comparison = new PlayerComparison([alpha, bravo], 4, [])
    const check = buildStartGutCheck(comparison, start('Alpha', 'Bravo', 'clear'), posture.unknown, now)!
    expect(check).toBeDefined()
    expect(texts(check.caseForAlternative), "next week's schedule doesn't decide this one").not.toContain('schedule')
    expect(check.confidence).toBe('clear')
  })

  it('this week the range counts only when the tally left it out', () => {
    const alpha = player('Alpha', { values: { ceilingThisWeek: 12 } })
    const bravo = player('Bravo', { values: { ceilingThisWeek: 22 } })
    const comparison = new PlayerComparison([alpha, bravo], 4, [])
    const verdict = start('Alpha', 'Bravo', 'clear')
    const close = buildStartGutCheck(comparison, verdict, posture.close(0), now)!
    expect(close.caseForAlternative[0]?.text).toBe('Bigger ceiling this week (22.0 vs 12.0).')
    expect(close.caseForAlternative[0]?.strength).toBe(1)
    const behind = buildStartGutCheck(comparison, verdict, posture.underdog(-12), now)!
    expect(behind.caseForAlternative[0]?.strength, 'the ceiling already voted').toBe(0)
  })

  it('this week practice is the risk and can cost a step', () => {
    const alpha = player('Alpha', { values: { ceilingThisWeek: 10, floorThisWeek: 2 }, injuryDesignation: 'Questionable', practice: 'DNP' })
    const bravo = player('Bravo', { values: { ceilingThisWeek: 20, floorThisWeek: 8 } })
    const comparison = new PlayerComparison([alpha, bravo], 4, [])
    const check = buildStartGutCheck(comparison, start('Alpha', 'Bravo', 'clear'), posture.close(0), now)!
    expect(check.risksForPick[0]?.text).toBe('Alpha: did not practice in the latest practice report.')
    expect(texts(check.risksForPick), "Q itself isn't a penalty this week").not.toContain('listed Questionable')
    expect(check.confidence, 'practice and range together take a clear call down a step').toBe('lean')
  })
})
