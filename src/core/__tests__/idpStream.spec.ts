import { describe, expect, it } from 'vitest'
import { bidBandForGain, bidDollars, isSpend } from '../Stream'
import {
  IDP_STREAM_KNOBS, compare, decodeIDPCandidate, decodeIDPScoring, idpCandidate, idpPrior, idpScoring,
  idpScoringFromSleeper, idpUnmodelledKeys, pointsBreakdown, project, report,
  type IDPCandidate, type IDPProjection,
} from '../streams/IDPStream'
import type { StreamPractice } from '../Stream'
import { readFixture } from '../../../tests/swiftFixtures'

/** Swift decodes this file with `.convertFromSnakeCase`. */
function candidatesFile() {
  const raw = readFixture<{ scoring: unknown; candidates: unknown[] }>('FCCore', 'idp-stream/week3_2026_candidates.json')
  const opts = { convertFromSnakeCase: true }
  return { scoring: decodeIDPScoring(raw.scoring, opts), candidates: raw.candidates.map((c) => decodeIDPCandidate(c, opts)) }
}

type RefRow = Record<string, unknown> & { name: string }
const referenceList = () => readFixture<RefRow[]>('FCCore', 'idp-stream/week3_2026_projections.json')

/** Port of IDPStreamParityTests — pinned to the reference engine's week-3 2026 output. */
describe('IDP stream parity', () => {
  it('matches reference projections for every candidate', () => {
    const file = candidatesFile()
    expect(file.candidates.length).toBe(34)
    const reference = new Map(referenceList().map((r) => [r.name, r]))
    const r = report(file.candidates, file.scoring, { incumbentID: 'Cedric Gray', risk: 'neutral' })
    const all = [...r.ranked, ...(r.incumbent ? [r.incumbent] : [])]
    expect(all.length).toBe(34)
    expect(r.incumbent?.name).toBe('Cedric Gray')

    for (const p of all) {
      const ref = reference.get(p.name)
      expect(ref, `no reference row for ${p.name}`).toBeDefined()
      const check = (key: string, value: number | undefined) => {
        const expected = ref![key]
        expect(typeof expected, `${p.name}: reference has no ${key}`).toBe('number')
        expect(value, `${p.name} ${key}`).toBeDefined()
        expect(Math.abs(value! - (expected as number)), `${p.name} ${key}: ${value} vs ${expected}`).toBeLessThanOrEqual(1e-6)
      }
      check('exp_plays', p.expPlays)
      check('snap_share', p.snapShare)
      check('e_solo', p.eSolo)
      check('e_ast', p.eAst)
      check('e_sack', p.eSack)
      check('e_tfl', p.eTfl)
      check('mean_if_plays', p.meanIfPlays)
      check('sd_if_plays', p.sdIfPlays)
      check('exp_pts', p.expPts)
      check('floor_p25', p.floorP25)
      check('ceiling_p75', p.ceilingP75)
      check('utility', p.utility)
      if (p.name !== 'Cedric Gray') {
        check('p_beat_incumbent', p.pBeatIncumbent)
        check('exp_gain', p.expGain)
        expect(p.bidBand?.label, p.name).toBe(ref!['faab_band'])
      }
      expect(p.flags, p.name).toEqual(ref!['flags'])
    }
  })

  it('ranking order matches reference', () => {
    const file = candidatesFile()
    const referenceOrder = referenceList().map((r) => r.name)
    const r = report(file.candidates, file.scoring, { incumbentID: 'Cedric Gray' })
    expect(r.ranked.map((p) => p.name)).toEqual(referenceOrder.filter((n) => n !== 'Cedric Gray'))
  })
})

/** Port of IDPStreamEngineTests. */
describe('IDP stream engine', () => {
  const scoring = idpScoring({ solo: 2, ast: 1, sack: 5, tfl: 2 })

  const candidate = ({ practice = 'none', statSnaps = 0, dvpPct = 0, dvpGames = 0 }:
    { practice?: StreamPractice; statSnaps?: number; dvpPct?: number; dvpGames?: number } = {}): IDPCandidate =>
    idpCandidate({
      name: 'Test LB', team: 'TEN', position: 'LB', opponent: '@NYG',
      teamDefPlays: 124, teamGames: 2, snapShareLast1: 1, snapShareLast3: 1,
      roleConf: 0.9, statSnaps, dvpPct, dvpGames, practice, available: true, playerID: '1',
    })

  it('no stats falls back to the position prior', () => {
    const p = project(candidate(), scoring)
    const prior = idpPrior('LB')
    expect(Math.abs((p.eSolo + p.eAst) / (p.expSnaps * p.tklMult) - prior.tackles)).toBeLessThanOrEqual(1e-9)
    expect(p.flags).toContain('thin conversion sample')
  })

  it('an OUT player projects zero', () => {
    const p = project(candidate({ practice: 'OUT' }), scoring)
    expect(p.expPts).toBe(0)
    expect(p.floorP25).toBe(0)
    expect(p.ceilingP75).toBe(0)
  })

  it('matchup multiplier is capped', () => {
    const huge = project(candidate({ dvpPct: 500, dvpGames: 16 }), scoring)
    expect(Math.abs(huge.tklMult - (1 + IDP_STREAM_KNOBS.dvpCap))).toBeLessThanOrEqual(1e-12)
    const ignored = project(candidate({ dvpPct: 500, dvpGames: 0 }), scoring)
    expect(ignored.tklMult).toBe(1)
  })

  it('ceiling risk ranks above floor risk', () => {
    const floor = project(candidate(), scoring, 'floor')
    const ceiling = project(candidate(), scoring, 'ceiling')
    expect(ceiling.utility).toBeGreaterThan(floor.utility)
    expect(ceiling.expPts).toBe(floor.expPts)
  })

  it('incumbent is excluded from ranked and others get the comparison', () => {
    const other = { ...candidate(), name: 'Other', playerID: '2', snapShareLast1: 0.5, snapShareLast3: 0.5 }
    const r = report([candidate(), other], scoring, { incumbentID: '1' })
    expect(r.incumbent?.id).toBe('1')
    expect(r.ranked.map((p) => p.id)).toEqual(['2'])
    expect(r.ranked[0]!.pBeatIncumbent).toBeDefined()
    expect(r.ranked[0]!.expGain ?? 0).toBeLessThan(0)
  })

  it('only-available drops rostered players but keeps the incumbent', () => {
    const mine = { ...candidate(), available: false }
    const rival = { ...candidate(), playerID: '2', name: 'Rival', available: false }
    const open = { ...candidate(), playerID: '3', name: 'Open' }
    const r = report([mine, rival, open], scoring, { incumbentID: '1', onlyAvailable: true })
    expect(r.incumbent?.id).toBe('1')
    expect(r.ranked.map((p) => p.id)).toEqual(['3'])
  })

  it('bid band dollars', () => {
    expect(bidDollars(bidBandForGain(7), 100)).toBe('$11–18')
    expect(isSpend(bidBandForGain(1))).toBe(false)
  })
})

/** Port of IDPScoringTests. */
describe('IDP scoring', () => {
  it('per-tackle key stacks on solo and assist', () => {
    const s = idpScoringFromSleeper({ idp_tkl: 1, idp_tkl_solo: 0.5, idp_tkl_ast: 0 })
    expect(s.solo).toBe(1.5)
    expect(s.ast).toBe(1)
  })

  it('missing keys score zero', () => {
    expect(idpScoringFromSleeper({})).toEqual(idpScoring())
  })

  it('Whack-A-Mole scoring', () => {
    const json = readFixture<Record<string, unknown>>('FCCore', 'scoring-whack-a-mole.json')
    const nested = json['scoring_settings']
    const settings = (nested && typeof nested === 'object' ? nested : json) as Record<string, number>
    const s = idpScoringFromSleeper(settings)
    expect(s.solo).toBe(2)
    expect(s.ast).toBe(1)
    expect(s.sack).toBe(5)
    expect(s.tfl).toBe(2)
    expect(s.int).toBe(5)
    expect(s.ff).toBe(3)
    expect(s.qbHit).toBe(0.5)
    expect(s.pd).toBe(0)
    const unmodelled = idpUnmodelledKeys(settings)
    expect(unmodelled).toContain('idp_fum_rec')
    expect(unmodelled).toContain('idp_def_td')
    expect(unmodelled).not.toContain('idp_sack')
    expect(unmodelled, 'zero-valued keys are not listed').not.toContain('idp_tkl')
  })
})

/** Port of IDPStreamDegenerateTests. */
describe('IDP stream degenerate', () => {
  it('no scoring gives a finite comparison', () => {
    const a = idpCandidate({ name: 'A', team: 'KC', position: 'LB', opponent: '@MIA', playerID: '1' })
    const b = idpCandidate({ name: 'B', team: 'KC', position: 'LB', opponent: '@MIA', playerID: '2' })
    const r = report([a, b], idpScoring(), { incumbentID: '1' })
    const p = r.ranked[0]?.pBeatIncumbent ?? Number.NaN
    expect(Math.abs(p - 0.5)).toBeLessThanOrEqual(1e-9)
  })
})

/** Port of IDPComparisonTests. */
describe('IDP comparison', () => {
  const scoring = idpScoring({ solo: 2, ast: 1, sack: 5, tfl: 2, int: 5, ff: 3, qbHit: 0.5 })

  const player = (id: string, share: number, practice: StreamPractice = 'none'): IDPProjection =>
    project(idpCandidate({
      name: id, team: 'KC', position: 'EDGE', opponent: '@MIA', teamDefPlays: 130, teamGames: 2,
      snapShareLast1: share, snapShareLast3: share, roleConf: 0.8, statSnaps: 120,
      solo: 6, ast: 4, sacks: 1, tfl: 2, qbHits: 3, practice, playerID: id,
    }), scoring)

  it('breakdown sums to the projection if he plays', () => {
    const p = player('a', 0.8)
    const breakdown = pointsBreakdown(p, scoring)
    expect(Math.abs(breakdown.reduce((s, b) => s + b.points, 0) - p.meanIfPlays)).toBeLessThanOrEqual(1e-9)
    expect(breakdown.some((b) => b.stat === 'Pass def'), 'stats the league does not pay for are left out').toBe(false)
    expect(breakdown.map((b) => b.points)).toEqual(breakdown.map((b) => b.points).sort((x, y) => y - x))
  })

  it('head-to-head is complementary with an undefined diagonal', () => {
    const comparison = compare([player('a', 0.9), player('b', 0.6), player('c', 0.4)])
    for (let i = 0; i < 3; i++) {
      expect(comparison.headToHead[i]![i]).toBeUndefined()
      for (let j = 0; j < 3; j++) {
        if (i === j) continue
        const sum = (comparison.headToHead[i]![j] ?? 0) + (comparison.headToHead[j]![i] ?? 0)
        expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-9)
      }
    }
    expect(comparison.headToHead[0]![2] ?? 0, 'the bigger role wins more often').toBeGreaterThan(0.5)
  })
})

/** Port of StreamVerdictTests. */
describe('stream verdict (IDP)', () => {
  const scoring = idpScoring({ solo: 2, ast: 1, sack: 5, tfl: 2 })

  const player = (id: string, share: number, roleConf = 0.85): IDPProjection =>
    project(idpCandidate({
      name: id, team: 'KC', position: 'LB', opponent: '@MIA', teamDefPlays: 130, teamGames: 2,
      snapShareLast1: share, snapShareLast3: share, roleConf, statSnaps: 120, solo: 8, ast: 5, playerID: id,
    }), scoring)

  it('no verdict for one player', () => {
    expect(compare([player('a', 1)]).verdict).toBeUndefined()
  })

  it('clear leader is named with odds against everyone', () => {
    const comparison = compare([player('low', 0.4), player('high', 1.0), player('mid', 0.7)])
    const verdict = comparison.verdict!
    expect(verdict).toBeDefined()
    expect(comparison.players[verdict.leader]!.id).toBe('high')
    expect(verdict.odds.map((o) => o.index)).toEqual([0, 2])
    expect(verdict.odds.every((o) => o.pBeats > 0.5)).toBe(true)
    expect(comparison.players[verdict.runnerUp]!.id).toBe('mid')
    expect(verdict.margin).toBeGreaterThan(0)
  })

  it('near twins are a toss-up', () => {
    const verdict = compare([player('a', 0.9), player('b', 0.91)]).verdict!
    expect(verdict.confidence).toBe('tossUp')
  })
})
