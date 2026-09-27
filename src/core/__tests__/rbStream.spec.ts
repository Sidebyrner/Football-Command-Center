import { describe, expect, it } from 'vitest'
import {
  RB_REFERENCE_SCORING, decodeRBCandidate, projectRB, rbCandidate, rbPointsBreakdown, rbScoringFromSleeper,
  rbStreamReport, rbUnmodelledKeys, withLongPlayBonuses, type RBCandidate, type RBProjection, type RBScoring,
} from '../streams/RBStream'
import { readFixture } from '../../../tests/swiftFixtures'

type Row = Record<string, unknown>

const candidates = (): RBCandidate[] =>
  readFixture<{ candidates: unknown[] }>('FCCore', 'rb-stream/week3_2026_candidates.json').candidates.map(decodeRBCandidate)

const rows = (fixture: string): Map<string, Row> => {
  const list = readFixture<Row[]>('FCCore', `rb-stream/${fixture}`)
  return new Map(list.filter((r) => typeof r['name'] === 'string').map((r) => [r['name'] as string, r]))
}

/** XCTAssertEqual(value, expected, accuracy: 1e-6). */
function check(p: RBProjection, ref: Row, key: string, value: number | undefined) {
  const expected = ref[key]
  expect(typeof expected, `${p.name}: no ${key}`).toBe('number')
  expect(value, `${p.name}: nil ${key}`).not.toBeUndefined()
  expect(Math.abs(value! - (expected as number)), `${p.name} ${key}: ${value} vs ${expected}`).toBeLessThanOrEqual(1e-6)
}

/**
 * Port of RBStreamParityTests: pinned to the reference output on its frozen
 * week-3 2026 dataset, 15 backs, reference scoring, incumbent Tyler Allgeier.
 */
describe('RBStream parity', () => {
  it('matches reference projections for every back', () => {
    const all = candidates()
    expect(all.length).toBe(15)
    const reference = rows('week3_2026_rb_projections.json')
    for (const c of all) {
      const p = projectRB(c, RB_REFERENCE_SCORING)
      const ref = reference.get(p.name)
      expect(ref, `no reference row for ${p.name}`).toBeDefined()
      check(p, ref!, 'exp_rush_att', p.expRushAttempts)
      check(p, ref!, 'exp_pass_att', p.expPassAttempts)
      check(p, ref!, 'rush_env', p.rushEnv)
      check(p, ref!, 'pass_env', p.passEnv)
      check(p, ref!, 'implied', p.implied)
      check(p, ref!, 'implied_mult', p.impliedMult)
      check(p, ref!, 'carry_share', p.carryShare)
      check(p, ref!, 'tgt_share', p.targetShare)
      check(p, ref!, 'exp_carries', p.expCarries)
      check(p, ref!, 'exp_targets', p.expTargets)
      check(p, ref!, 'dvp_mult', p.dvpMult)
      check(p, ref!, 'line_mult', p.lineMult)
      check(p, ref!, 'rz_mult', p.redZoneMult)
      check(p, ref!, 'e_rush_yd', p.eRushYd)
      check(p, ref!, 'e_rush_fd', p.eRushFirstDowns)
      check(p, ref!, 'e_rush_td', p.eRushTouchdowns)
      check(p, ref!, 'e_rec', p.eRec)
      check(p, ref!, 'e_rec_yd', p.eRecYd)
      check(p, ref!, 'e_rec_fd', p.eRecFirstDowns)
      check(p, ref!, 'e_rec_td', p.eRecTouchdowns)
      check(p, ref!, 'e_30', p.e30)
      check(p, ref!, 'e_40', p.e40)
      check(p, ref!, 'e_50', p.e50)
      check(p, ref!, 'e_fumbles', p.eFumbles)
      check(p, ref!, 'mean_if_plays', p.meanIfPlays)
      check(p, ref!, 'sd_if_plays', p.sdIfPlays)
      check(p, ref!, 'exp_pts', p.expPts)
      check(p, ref!, 'floor_p25', p.floorP25)
      check(p, ref!, 'ceiling_p75', p.ceilingP75)
      check(p, ref!, 'utility', p.utility)
      expect(p.flags, p.name).toEqual(ref!['flags'])
    }
  })

  it('ranking order matches reference', () => {
    const order = readFixture<Row[]>('FCCore', 'rb-stream/week3_2026_rb_projections.json')
      .map((r) => r['name']).filter((n): n is string => typeof n === 'string')
    const report = rbStreamReport(candidates(), RB_REFERENCE_SCORING)
    expect(report.ranked.map((p) => p.name)).toEqual(order)
  })

  function checkAgainstIncumbentFixture(fixture: string, scoring: RBScoring) {
    const expected = rows(fixture)
    const report = rbStreamReport(candidates(), scoring, { incumbentID: 'Tyler Allgeier' })
    expect(report.incumbent?.name).toBe('Tyler Allgeier')
    const all = [...report.ranked, ...(report.incumbent ? [report.incumbent] : [])]
    expect(all.length).toBe(expected.size)
    for (const p of all) {
      const ref = expected.get(p.name)
      expect(ref, `no expected row for ${p.name}`).toBeDefined()
      check(p, ref!, 'exp_pts', p.expPts)
      check(p, ref!, 'utility', p.utility)
      check(p, ref!, 'sd_if_plays', p.sdIfPlays)
      check(p, ref!, 'mean_if_plays', p.meanIfPlays)
      check(p, ref!, 'floor_p25', p.floorP25)
      check(p, ref!, 'ceiling_p75', p.ceilingP75)
      check(p, ref!, 'exp_carries', p.expCarries)
      check(p, ref!, 'exp_targets', p.expTargets)
      if (p.name !== 'Tyler Allgeier') check(p, ref!, 'p_beat_incumbent', p.pBeatIncumbent)
    }
  }

  it('matches reference against the incumbent', () => {
    checkAgainstIncumbentFixture('expected_rb_week3.json', RB_REFERENCE_SCORING)
  })

  it('matches reference with long-play bonuses', () => {
    checkAgainstIncumbentFixture('expected_rb_week3_bonus235.json', withLongPlayBonuses(RB_REFERENCE_SCORING, 2, 3, 5))
  })
})

/** Port of RBScoringTests. */
describe('RBScoring', () => {
  const whackAMole = (): Record<string, number> => {
    const json = readFixture<Record<string, unknown>>('FCCore', 'scoring-whack-a-mole.json')
    const nested = json['scoring_settings']
    if (typeof nested === 'object' && nested !== null) return nested as Record<string, number>
    return json as Record<string, number>
  }

  it('tiers runs and catches separately', () => {
    const s = rbScoringFromSleeper(whackAMole())
    expect(s.rushingYard).toBe(0.1)
    expect(s.firstDown).toBe(1)
    expect(s.touchdown).toBe(6)
    expect(s.runBonus30, 'no 30–39 run tier in this league').toBe(0)
    expect(s.runBonus40).toBe(2)
    expect(s.catchBonus30).toBe(1)
    expect(s.catchBonus30 + s.catchBonus40).toBe(2)
    expect(s.touchdownBonus40).toBe(4)
    expect(s.touchdownBonus50).toBe(8)
    // A lost fumble records both fum and fum_lost: −3 and −5 more.
    expect(s.fumble).toBe(-3)
    expect(s.fumbleLost).toBe(-5)
    const unmodelled = rbUnmodelledKeys(whackAMole())
    expect(unmodelled).toContain('bonus_rush_yd_200')
    expect(unmodelled).toContain('rush_2pt')
    expect(unmodelled).not.toContain('rush_fd')
  })

  const back = (spread: number): RBCandidate =>
    rbCandidate({
      name: 'Back', team: 'KC', role: 'LEAD', opponent: '@MIA', spreadOff: spread, total: 46,
      teamRushAttempts: 52, teamPassAttempts: 66, teamGames: 2, carryShareLast1: 0.5, carryShareLast3: 0.5,
      roleConf: 0.8, statCarries: 26, rushYards: 120, rushFirstDowns: 7, rushTouchdowns: 1,
      runs30: 1, runs40: 1, runs50: 1,
    })

  it('favorites run more and score more', () => {
    const fav = projectRB(back(-7), RB_REFERENCE_SCORING)
    const dog = projectRB(back(7), RB_REFERENCE_SCORING)
    expect(fav.expCarries).toBeGreaterThan(dog.expCarries)
    expect(fav.implied).toBeGreaterThan(dog.implied)
    expect(dog.expTargets, 'underdogs throw more').toBeGreaterThan(fav.expTargets)
  })

  it('long rushing touchdowns only add when scored', () => {
    let scoring: RBScoring = { ...RB_REFERENCE_SCORING }
    const without = projectRB(back(0), scoring)
    scoring = { ...scoring, touchdownBonus40: 4, touchdownBonus50: 8 }
    const withTD = projectRB(back(0), scoring)
    expect(Math.abs((withTD.meanIfPlays - without.meanIfPlays) - (withTD.eTouchdowns40 * 4 + withTD.eTouchdowns50 * 8))).toBeLessThanOrEqual(1e-9)
    const total = rbPointsBreakdown(withTD, scoring).reduce((sum, r) => sum + r.points, 0)
    expect(Math.abs(total - withTD.meanIfPlays)).toBeLessThanOrEqual(1e-9)
  })

  it('catch tiers score only the receiving long plays', () => {
    const runOnly: RBScoring = { ...RB_REFERENCE_SCORING, runBonus40: 2 }
    const catchOnly: RBScoring = { ...RB_REFERENCE_SCORING, catchBonus40: 2 }
    const base = projectRB(back(0), RB_REFERENCE_SCORING)
    const r = projectRB(back(0), runOnly)
    const c = projectRB(back(0), catchOnly)
    expect(Math.abs((r.meanIfPlays - base.meanIfPlays) - 2 * base.eRun40)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs((c.meanIfPlays - base.meanIfPlays) - 2 * (base.e40 - base.eRun40))).toBeLessThanOrEqual(1e-9)
  })
})
