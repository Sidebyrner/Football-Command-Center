import { describe, expect, it } from 'vitest'
import {
  TEStreamPriors, TE_SCORING_REFERENCE_DEFAULTS, decodeTECandidate, decodeTEScoring, inferTERole, projectTE,
  teConversionRates, teEstimatedRouteShare, teMatchupMultipliers, tePointsBreakdown, teProjectedTargetShare,
  teScoringFromSleeper, teStreamReport, teUnmodelledKeys, type TECandidate, type TEScoring,
} from '../streams/TEStream'
import { readFixture } from '../../../tests/swiftFixtures'

/**
 * Port of TEStreamTests. The TE engine has no reference implementation, so it
 * is pinned by a fixture computed by an independent re-implementation of its
 * formulas (seven tight ends, two scorings) and hand-checked properties.
 */

const candidates = (): TECandidate[] =>
  readFixture<{ candidates: unknown[] }>('FCCore', 'te-stream/candidates.json').candidates.map((c) => decodeTECandidate(c))

type Reference = { scorings: Record<string, unknown>; projections: Record<string, Record<string, unknown>[]> }
const reference = () => readFixture<Reference>('FCCore', 'te-stream/projections.json')

const scoring = (name: string): TEScoring => decodeTEScoring(reference().scorings[name])

/** `XCTAssertEqual(a, b, accuracy:)`. */
function near(actual: number, expected: number, accuracy: number, message = '') {
  expect(Math.abs(actual - expected) <= accuracy, `${message}: ${actual} vs ${expected}`).toBe(true)
}

describe('TEStreamTests', () => {
  it('matches independent projections under both scorings', () => {
    const all = candidates()
    expect(all.length).toBe(7)
    const { projections } = reference()
    for (const name of ['league', 'tePremium']) {
      const s = scoring(name)
      const rows = projections[name]!
      expect(rows.length).toBe(all.length)
      all.forEach((c, i) => {
        const ref = rows[i]!
        const p = projectTE(c, s)
        expect(p.name).toBe(ref.name)
        const check = (key: string, value: number | undefined) => {
          const label = `${name} ${p.name} ${key}`
          if (ref[key] === null) return expect(value, label).toBeUndefined()
          expect(typeof ref[key], `${name} ${p.name}: no ${key}`).toBe('number')
          expect(value, label).toBeDefined()
          near(value!, ref[key] as number, 1e-9, label)
        }
        check('expPassAttempts', p.expPassAttempts)
        check('envMult', p.envMult)
        check('estRouteShare', p.estRouteShare)
        check('targetShare', p.targetShare)
        check('expTargets', p.expTargets)
        check('dvpMult', p.dvpMult)
        check('coverageMult', p.coverageMult)
        check('redZoneMult', p.redZoneMult)
        check('eRec', p.eRec)
        check('eRecYd', p.eRecYd)
        check('eFirstDowns', p.eFirstDowns)
        check('eTouchdowns', p.eTouchdowns)
        check('e30', p.e30)
        check('e40', p.e40)
        check('e50', p.e50)
        check('eTouchdowns40', p.eTouchdowns40)
        check('eTouchdowns50', p.eTouchdowns50)
        check('meanIfPlays', p.meanIfPlays)
        check('sdIfPlays', p.sdIfPlays)
        check('pPlay', p.pPlay)
        check('expPts', p.expPts)
        check('floorP25', p.floorP25)
        check('ceilingP75', p.ceilingP75)
        check('utility', p.utility)
      })
    }
  })

  it('breakdown sums to mean', () => {
    for (const name of ['league', 'tePremium']) {
      const s = scoring(name)
      for (const c of candidates()) {
        const p = projectTE(c, s)
        near(tePointsBreakdown(p, s).reduce((t, b) => t + b.points, 0), p.meanIfPlays, 1e-9, `${name} ${p.name}`)
      }
    }
  })

  it('TE premium adds exactly premium × events', () => {
    const c = candidates()[0]!
    const plain = { ...TE_SCORING_REFERENCE_DEFAULTS }
    const premium = { ...plain, premiumReception: 0.5, premiumFirstDown: 0.25 }
    const a = projectTE(c, plain)
    const b = projectTE(c, premium)
    near(b.meanIfPlays - a.meanIfPlays, 0.5 * a.eRec + 0.25 * a.eFirstDowns, 1e-9, 'premium delta')
    expect(tePointsBreakdown(b, premium).some((s) => s.stat === 'TE premium')).toBe(true)
    expect(tePointsBreakdown(a, plain).some((s) => s.stat === 'TE premium')).toBe(false)
  })

  it('Sleeper scoring reads premium keys and stacks tiers', () => {
    const s = teScoringFromSleeper({
      rec: 0.5, rec_yd: 0.1, rec_fd: 1, rec_td: 6, rec_30_39: 1, rec_40p: 2,
      bonus_rec_te: 0.5, bonus_fd_te: 0.5, rec_2pt: 2, bonus_rec_yd_200: 5, bonus_rec_wr: 1,
    })
    expect(s.premiumReception).toBe(0.5)
    expect(s.premiumFirstDown).toBe(0.5)
    expect(s.bonus30).toBe(1)
    expect(s.bonus40).toBe(1)
    expect(teUnmodelledKeys({ bonus_rec_te: 0.5, rec_2pt: 2, bonus_rec_yd_200: 5, bonus_rec_wr: 1, rec_fd: 1 }))
      .toEqual(['bonus_rec_yd_200', 'rec_2pt'])
  })

  /** Same snaps and share: the one who blocks on more of them runs fewer routes, so his share is pulled lower. */
  it('route proxy depends on role', () => {
    const mover: TECandidate = { ...candidates()[0]!, roleConf: 0.5 }
    const blocker: TECandidate = { ...mover, role: 'ROTATIONAL' }
    const moverRoutes = teEstimatedRouteShare(mover)
    const blockerRoutes = teEstimatedRouteShare(blocker)
    expect(moverRoutes).toBeDefined()
    expect(blockerRoutes).toBeDefined()
    near(moverRoutes!, 0.82 * 0.85, 1e-12, 'mover routes')
    near(blockerRoutes!, 0.82 * 0.55, 1e-12, 'blocker routes')
    expect(teProjectedTargetShare(mover)).toBeGreaterThan(teProjectedTargetShare(blocker))
  })

  /** Three TDs on nine targets is a 33% rate; the model keeps it near the prior. */
  it('touchdown streak is regressed', () => {
    const goalLine = candidates()[3]!
    const rates = teConversionRates(goalLine, TEStreamPriors.prior('RED_ZONE'))
    near(rates.touchdowns, (9.0 / 169) * (3.0 / 9) + (160.0 / 169) * 0.095, 1e-12, 'TD rate')
    expect(rates.touchdowns).toBeLessThan(0.12)
    expect(projectTE(goalLine, TE_SCORING_REFERENCE_DEFAULTS).flags).toContain('TD rate well above norm — regressed')
  })

  it('matchup and boost caps', () => {
    const all = candidates()
    // Goal Line Blocker: DvP +30% over 3 games → w·30% = 10% (under the cap);
    // seam coverage 1.5 caps at +30%; red-zone share 33% caps at +70%.
    const m = teMatchupMultipliers(all[3]!)
    near(m.dvp, 1 + (0.3 * 3) / 9, 1e-12, 'dvp')
    near(m.coverage, 1.3, 1e-12, 'coverage')
    near(m.redZone, 1.7, 1e-12, 'red zone')
    // Committee TE2: a 0.20 vacated boost is capped at 0.10.
    const committee = all[4]!
    const unboosted = { ...committee, vacatedTargetBoost: 0 }
    near(teProjectedTargetShare(committee) - teProjectedTargetShare(unboosted), 0.1, 1e-12, 'boost cap')
  })

  it('role inference', () => {
    expect(inferTERole({ targetShare: 0.22, adot: 5, redZoneShare: 0.3, snapShare: 0.4 })).toBe('FEATURED')
    expect(inferTERole({ targetShare: 0.1, adot: 5, redZoneShare: 0.25, snapShare: 0.7 })).toBe('RED_ZONE')
    expect(inferTERole({ targetShare: 0.12, adot: 10, redZoneShare: 0.1, snapShare: 0.45 })).toBe('ROTATIONAL')
    expect(inferTERole({ targetShare: 0.15, adot: 10, redZoneShare: 0.1, snapShare: 0.75 })).toBe('SEAM')
    expect(inferTERole({ targetShare: 0.15, adot: 7 })).toBe('CHECKDOWN')
    expect(inferTERole({})).toBe('CHECKDOWN')
  })

  it('OUT player has zero expected points and ranks last', () => {
    const report = teStreamReport(candidates(), scoring('league'))
    const out = report.ranked.find((p) => p.name === 'Injured Starter')
    expect(out).toBeDefined()
    expect(out!.expPts).toBe(0)
    expect(report.ranked[0]?.name).toBe('Featured Move TE')
  })
})
