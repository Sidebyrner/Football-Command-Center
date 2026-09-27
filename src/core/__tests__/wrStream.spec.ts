import { describe, expect, it } from 'vitest'
import {
  WRStreamPriors, WR_SCORING_REFERENCE_DEFAULTS, decodeWRCandidate, makeWRCandidate, projectWR, wrPointsBreakdown,
  wrScoringFromSleeper, wrStreamReport, wrUnmodelledKeys, type WRCandidate, type WRProjection,
} from '../streams/WRStream'
import { fixtureText, readFixture } from '../../../tests/swiftFixtures'

/** Port of WRStreamTests (WRStreamParityTests + WRScoringTests). */

const candidates = (): WRCandidate[] =>
  readFixture<{ candidates: unknown[] }>('FCCore', 'wr-stream/week3_2026_candidates.json')
    .candidates.map((c) => decodeWRCandidate(c, { snakeCase: true }))

const reference = () => readFixture<Record<string, unknown>[]>('FCCore', 'wr-stream/week3_2026_wr_projections.json')

/** `XCTAssertEqual(a, b, accuracy:)`. */
function near(actual: number, expected: number, accuracy: number, message: string) {
  expect(Math.abs(actual - expected) <= accuracy, `${message}: ${actual} vs ${expected}`).toBe(true)
}

describe('WRStreamParityTests', () => {
  it('matches reference projections for every receiver', () => {
    const all = candidates()
    expect(all.length).toBe(19)
    const rows = new Map(reference().filter((r) => typeof r.name === 'string').map((r) => [r.name as string, r]))
    for (const c of all) {
      const p = projectWR(c, WR_SCORING_REFERENCE_DEFAULTS)
      const ref = rows.get(p.name)
      expect(ref, `no reference row for ${p.name}`).toBeDefined()
      const check = (key: string, value: number) => {
        const expected = ref![key]
        expect(typeof expected, `${p.name}: no ${key}`).toBe('number')
        near(value, expected as number, 1e-6, `${p.name} ${key}`)
      }
      check('exp_pass_att', p.expPassAttempts)
      check('env_mult', p.envMult)
      check('tgt_share', p.targetShare)
      check('exp_targets', p.expTargets)
      check('dvp_mult', p.dvpMult)
      check('cov_mult', p.coverageMult)
      check('rz_mult', p.redZoneMult)
      check('e_rec', p.eRec)
      check('e_rec_yd', p.eRecYd)
      check('e_fd', p.eFirstDowns)
      check('e_td', p.eTouchdowns)
      check('e_30', p.e30)
      check('e_40', p.e40)
      check('e_50', p.e50)
      check('e_rush_yd', p.eRushYd)
      check('e_rush_fd', p.eRushFirstDowns)
      check('mean_if_plays', p.meanIfPlays)
      check('sd_if_plays', p.sdIfPlays)
      check('p_play', p.pPlay)
      check('exp_pts', p.expPts)
      check('floor_p25', p.floorP25)
      check('ceiling_p75', p.ceilingP75)
      check('utility', p.utility)
      expect(p.flags, p.name).toEqual(ref!.flags)
    }
  })

  it('ranking order matches reference', () => {
    const report = wrStreamReport(candidates(), WR_SCORING_REFERENCE_DEFAULTS)
    expect(report.ranked.map((p) => p.name)).toEqual(reference().filter((r) => typeof r.name === 'string').map((r) => r.name))
  })

  /** The reference's second report sets illustrative stacked bonuses 2/3/5; E[pts] is printed to one decimal. */
  it('matches reference with long-catch bonuses', () => {
    const scoring = { ...WR_SCORING_REFERENCE_DEFAULTS, bonus30: 2, bonus40: 3, bonus50: 5 }
    const text = fixtureText('FCCore', 'wr-stream/week3_2026_wr_stream_report_with_bonuses.md')
    const expected = new Map<string, number>()
    // Swift `split` drops empty pieces; `Int(_:)` / `Double(_:)` are strict parses.
    for (const line of text.split('\n').filter((l) => l.length > 0)) {
      if (!line.startsWith('| ')) continue
      const cells = line.split('|').filter((s) => s.length > 0).map((s) => s.trim())
      if (cells.length <= 6 || !/^[+-]?\d+$/.test(cells[0]!) || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cells[5]!)) continue
      expected.set(cells[1]!, Number(cells[5]))
    }
    expect(expected.size).toBe(19)
    for (const c of candidates()) {
      const p = projectWR(c, scoring)
      const want = expected.get(p.name)
      expect(want, p.name).toBeDefined()
      near(p.expPts, want!, 0.05, p.name)
    }
  })
})

describe('WRScoringTests', () => {
  const whackAMole = (): Record<string, number> => {
    const json = readFixture<Record<string, unknown>>('FCCore', 'scoring-whack-a-mole.json')
    const nested = json.scoring_settings
    return (typeof nested === 'object' && nested !== null ? nested : json) as Record<string, number>
  }

  it('Sleeper ranges become stacked tiers', () => {
    const s = wrScoringFromSleeper(whackAMole())
    expect(s.reception).toBe(0)
    expect(s.receivingYard).toBe(0.1)
    expect(s.firstDown).toBe(1)
    expect(s.touchdown).toBe(6)
    expect(s.bonus30).toBe(1)
    expect(s.bonus40, 'a 40+ catch earns rec_40p = 2 in total').toBe(1)
    expect(s.bonus30 + s.bonus40).toBe(2)
    expect(s.bonus50, 'no rec_50p key in this league').toBe(0)
    expect(s.touchdownBonus40).toBe(4)
    expect(s.touchdownBonus50).toBe(8)
    const unmodelled = wrUnmodelledKeys(whackAMole())
    expect(unmodelled).toContain('bonus_rec_yd_200')
    expect(unmodelled).toContain('rec_2pt')
    expect(unmodelled).not.toContain('rec_fd')
  })

  it('long touchdown bonuses only add when scored', () => {
    const c = makeWRCandidate({
      name: 'Deep', team: 'CLE', role: 'DEEP', opponent: 'vs CAR', teamPassAttempts: 66, teamGames: 2,
      targetShareLast1: 0.2, targetShareLast3: 0.2, roleConf: 0.8, statTargets: 12, receptions: 6,
      receivingYards: 140, firstDowns: 5, touchdowns: 2, catches30: 2, catches40: 2, catches50: 1,
    })
    const scoring = { ...WR_SCORING_REFERENCE_DEFAULTS }
    const without: WRProjection = projectWR(c, scoring)
    expect(without.eTouchdowns40).toBeGreaterThan(0)
    scoring.touchdownBonus40 = 4
    scoring.touchdownBonus50 = 8
    const withBonus = projectWR(c, scoring)
    near(withBonus.meanIfPlays - without.meanIfPlays, withBonus.eTouchdowns40 * 4 + withBonus.eTouchdowns50 * 8, 1e-9, 'long-TD delta')
    expect(withBonus.sdIfPlays).toBeGreaterThan(without.sdIfPlays)
    near(wrPointsBreakdown(withBonus, scoring).reduce((s, b) => s + b.points, 0), withBonus.meanIfPlays, 1e-9, 'breakdown sum')
  })

  it('role priors apply with no stats', () => {
    const c = makeWRCandidate({ name: 'New', team: 'KC', role: 'SLOT', opponent: '@MIA' })
    const p = projectWR(c, WR_SCORING_REFERENCE_DEFAULTS)
    near(p.targetShare, WRStreamPriors.targetShare('SLOT'), 0.03, 'target share')
    expect(p.flags).toContain('thin target sample')
    expect(p.flags).toContain('target share estimated')
  })
})
