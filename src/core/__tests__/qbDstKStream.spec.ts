import { describe, expect, it } from 'vitest'
import {
  blendedUtility, rankStream, rosSummary, type StreamHorizon, type StreamProjection, type StreamROS,
} from '@core/Stream'
import { QB_SCORING_REFERENCE, decodeQBCandidate, projectQB, qbScoringFromSleeper } from '@core/streams/QBStream'
import {
  DST_SCORING_REFERENCE, decodeDSTCandidate, dstIsReferencePlaceholder, dstScoringEqual, dstScoringFromSleeper, dstUnmodelledKeys,
  projectDST, tierEV,
} from '@core/streams/DSTStream'
import { K_SCORING_REFERENCE, decodeKCandidate, kMake, kMiss, kScoringFromSleeper, projectK } from '@core/streams/KStream'
import { readFixture } from '../../../tests/swiftFixtures'

type Ref = Record<string, unknown>

const HORIZONS: StreamHorizon[] = ['week', 'balanced', 'ros']

const candidates = <C>(file: string, decode: (raw: unknown) => C): C[] =>
  readFixture<{ candidates: unknown[] }>('FCCore', `qb-dst-k-stream/${file}`).candidates.map(decode)

const reference = (file: string) => readFixture<Ref[]>('FCCore', `qb-dst-k-stream/${file}`)

/** Swift's `check`: null matches a missing value, otherwise equal to 1e-6. */
function check(name: string, ref: Ref, key: string, value: number | undefined) {
  if (ref[key] === null && value === undefined) return
  const expected = ref[key]
  expect(typeof expected, `${name}: no ${key}`).toBe('number')
  expect(value, `${name}: nil ${key}`).toBeDefined()
  expect(Math.abs(value! - (expected as number)), `${name} ${key}: ${value} vs ${expected}`).toBeLessThanOrEqual(1e-6)
}

const asInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const asStrings = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined)

function checkROS(name: string, ref: Ref, ros: StreamROS, perGame: number) {
  expect(ros.games, `${name} ros_games`).toBe(asInt(ref.ros_games))
  check(name, ref, 'ros_avg_dvp', ros.avgDvp)
  check(name, ref, 'ros_per_game', perGame)
  check(name, ref, 'ros_total', ros.total)
  check(name, ref, 'playoff_avg_dvp', ros.playoffAvgDvp)
  expect(ros.byeWeek, `${name} bye`).toBe(asInt(ref.bye_week))
  expect(ros.hardest, `${name} hardest`).toEqual(asStrings(ref.ros_hardest))
  expect(ros.easiest, `${name} easiest`).toEqual(asStrings(ref.ros_easiest))
}

function checkDecision(p: StreamProjection, ref: Ref) {
  if (ref.p_beat_incumbent === null) {
    expect(p.pBeatIncumbent, p.name).toBeUndefined()
  } else {
    check(p.name, ref, 'p_beat_incumbent', p.pBeatIncumbent)
    check(p.name, ref, 'exp_gain', p.expGain)
    expect(p.bidBand?.label, p.name).toBe(typeof ref.faab_band === 'string' ? ref.faab_band : undefined)
  }
}

/** Ranks with the reference's incumbent and checks order, then each row. */
function parity<P extends StreamProjection & { ros: StreamROS }>(
  prefix: string, projections: P[], incumbentName: string, fields: (p: P) => [string, number][],
) {
  const ref = reference(`${prefix}.json`)
  const incumbent = projections.find((p) => p.name === incumbentName)
  const ranked = rankStream(projections, incumbent)
  expect(ranked.map((p) => p.name), `${prefix} order`).toEqual(ref.map((r) => r.name).filter((n): n is string => typeof n === 'string'))
  const byName = new Map(ref.map((r) => [r.name as string, r]))
  for (const p of ranked) {
    const r = byName.get(p.name)
    expect(r, p.name).toBeDefined()
    for (const [key, value] of fields(p)) check(p.name, r!, key, value)
    checkROS(p.name, r!, p.ros, p.ros.perGame)
    checkDecision(p, r!)
    expect(p.flags, p.name).toEqual(asStrings(r!.flags))
  }
}

/**
 * Port of QBDSTKStreamParityTests: the QB, D/ST and K engines pinned to the
 * reference implementation on its frozen week-3 2026 dataset (32 players
 * each), under all three horizons, with the incumbent the reference used.
 */
describe('QB / D/ST / K stream parity', () => {
  it('QB matches the reference under every horizon', () => {
    const cs = candidates('qb_week3_2026.json', decodeQBCandidate)
    expect(cs.length).toBe(32)
    for (const horizon of HORIZONS) {
      parity(`qb_${horizon}`, cs.map((c) => projectQB(c, QB_SCORING_REFERENCE, 'neutral', horizon)), 'Bryce Young', (p) => [
        ['exp_dropbacks', p.expDropbacks], ['env_mult', p.envMult], ['exp_att', p.expAtt], ['e_comp', p.eComp],
        ['e_inc', p.eInc], ['comp_rate', p.compRate], ['e_pass_yd', p.ePassYd], ['e_pass_td', p.ePassTd],
        ['e_int', p.eInt], ['e_sacks', p.eSacks], ['e_pass_fd', p.ePassFd], ['e_rush_att', p.eRushAtt],
        ['e_rush_yd', p.eRushYd], ['e_rush_fd', p.eRushFd], ['e_rush_td', p.eRushTd], ['dvp_mult', p.dvpMult],
        ['comp_adj', p.compAdj], ['sack_adj', p.sackAdj], ['int_adj', p.intAdj],
        ['mean_if_plays', p.meanIfPlays], ['sd_if_plays', p.sdIfPlays], ['p_play', p.pPlay],
        ['exp_pts', p.expPts], ['floor_p25', p.floorP25], ['ceiling_p75', p.ceilingP75],
        ['utility', p.utility], ['neutral_mean', p.neutralMean],
      ])
    }
  })

  it('D/ST matches the reference under every horizon', () => {
    const cs = candidates('dst_week3_2026.json', decodeDSTCandidate)
    expect(cs.length).toBe(32)
    for (const horizon of HORIZONS) {
      parity(`dst_${horizon}`, cs.map((c) => projectDST(c, DST_SCORING_REFERENCE, 'neutral', horizon)), 'MIN D/ST', (p) => [
        ['exp_dropbacks', p.expDropbacks], ['e_sacks', p.eSacks], ['e_int', p.eInt], ['e_fr', p.eFr],
        ['e_td', p.eTd], ['implied_opp', p.impliedOpp], ['pa_mean', p.paMean], ['pa_pts', p.paPts],
        ['ya_mean', p.yaMean], ['ya_pts', p.yaPts], ['dvp_mult', p.dvpMult], ['qb_adj', p.qbAdj],
        ['mean_if_plays', p.meanIfPlays], ['sd_if_plays', p.sdIfPlays], ['exp_pts', p.expPts],
        ['floor_p25', p.floorP25], ['ceiling_p75', p.ceilingP75], ['utility', p.utility],
        ['neutral_mean', p.neutralMean], ['ros_avg_opp_ppg', p.rosAvgOppPpg],
      ])
    }
  })

  it('K matches the reference under every horizon', () => {
    const cs = candidates('k_week3_2026.json', decodeKCandidate)
    expect(cs.length).toBe(32)
    for (const horizon of HORIZONS) {
      parity(`k_${horizon}`, cs.map((c) => projectK(c, K_SCORING_REFERENCE, 'neutral', horizon)), 'Harrison Butker', (p) => [
        ['implied', p.implied], ['e_fga', p.eFga], ['e_fgm', p.eFgm], ['e_miss', p.eMiss],
        ['e_xpa', p.eXpa], ['e_xpm', p.eXpm], ['e_50p_att', p.e50pAtt], ['stall', p.stall],
        ['dvp_mult', p.dvpMult], ['wind_over', p.windOver], ['mean_if_plays', p.meanIfPlays],
        ['sd_if_plays', p.sdIfPlays], ['exp_pts', p.expPts], ['floor_p25', p.floorP25],
        ['ceiling_p75', p.ceilingP75], ['utility', p.utility], ['neutral_mean', p.neutralMean],
      ])
    }
  })
})

/** Port of StreamRestOfSeasonTests: the shared rest-of-season layer and the league's own scoring. */
describe('Stream rest of season', () => {
  it('counts bye and playoff weeks', () => {
    const schedule = new Map([[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'], [6, 'E'], [15, 'F'], [16, 'G'], [17, 'H']])
    const ros = rosSummary({
      currentWeek: 3, schedule, oppDvp: { D: 10, E: -20, F: 30, G: 0, H: 20 }, dvpGames: 6, neutralMean: 10,
    })
    expect(ros.games, 'only weeks after the current one').toBe(5)
    expect(ros.byeWeek, 'the first unscheduled week ahead').toBe(5)
    expect(ros.playoffGames).toBe(3)
    expect(Math.abs(ros.playoffAvgDvp - 50.0 / 3)).toBeLessThanOrEqual(1e-9)
    expect(ros.hardest[0]).toBe('W6 E (-20%)')
    expect(ros.easiest[0]).toBe('W15 F (+30%)')
  })

  it('treats an empty schedule as neutral', () => {
    const ros = rosSummary({ currentWeek: 3, schedule: new Map(), oppDvp: {}, dvpGames: 2, neutralMean: 12 })
    expect(ros.games).toBe(0)
    expect(ros.perGame).toBe(12)
    expect(ros.mult).toBe(1)
  })

  it('weights horizons', () => {
    const week = blendedUtility(20, 5, 10, 1, 'neutral', 'week')
    const ros = blendedUtility(20, 5, 10, 1, 'neutral', 'ros')
    expect(Math.abs(week - (20 - 0.2 * 5))).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(ros - (0.15 * 20 + 0.85 * 10 - 0.2 * 5 * (0.15 + 0.425)))).toBeLessThanOrEqual(1e-9)
  })

  it("maps the league's scoring from Sleeper", () => {
    const settings = readFixture<Record<string, number>>('FCCore', 'scoring-whack-a-mole.json')
    const qb = qbScoringFromSleeper(settings)
    expect(qb.incompletion).toBe(-1)
    expect(qb.sack).toBe(-1)
    expect(qb.interception + qb.pickSixExtra, 'Sleeper records a pick-six as both an INT and a pick-six').toBe(-15)
    expect(qb.bonus40, '40+ completion').toBe(2)
    expect(qb.touchdownBonus50).toBe(8)

    const dst = dstScoringFromSleeper(settings)
    expect(dst.interception).toBe(8)
    expect(dst.pointsAllowed[0]?.points).toBe(15)
    expect(dst.pointsAllowed.at(-1)?.points).toBe(-15)
    expect(dst.yardsAllowed[0]?.points).toBe(20)
    expect(dstIsReferencePlaceholder(dst)).toBe(false)
    expect(dstUnmodelledKeys(settings)).toContain('def_3_and_out')

    const k = kScoringFromSleeper(settings)
    expect(kMake(k, '50_59'), 'each FG made (6) plus the 50–59 value (12)').toBe(6 + 12)
    expect(kMake(k, '60')).toBe(6 + 15)
    expect(kMiss(k, '40_49')).toBe(-2)
    expect(k.extraPoint).toBe(4)
    expect(k.extraPointMiss).toBe(-5)
  })

  it("falls back to Sleeper's defaults for a league without defense scoring", () => {
    expect(dstScoringEqual(dstScoringFromSleeper({ pass_td: 4 }), DST_SCORING_REFERENCE)).toBe(true)
    expect(dstIsReferencePlaceholder(dstScoringFromSleeper({}))).toBe(true)
  })

  it('takes the tier expected value as a weighted average of the tiers', () => {
    const tiers = DST_SCORING_REFERENCE.pointsAllowed
    expect(Math.abs(tierEV(-50, 1, tiers) - 10), 'certain shutout').toBeLessThanOrEqual(1e-9)
    expect(Math.abs(tierEV(100, 1, tiers) - -4)).toBeLessThanOrEqual(1e-9)
    const middle = tierEV(20, 9.5, tiers)
    expect(middle).toBeLessThan(7)
    expect(middle).toBeGreaterThan(-4)
  })
})
