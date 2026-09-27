import { describe, expect, it } from 'vitest'
import { isNonScoringKey, scoreSleeperStats, SLEEPER_STANDARD } from '@core/SleeperStatScoring'
import { readFixture } from '../../../tests/swiftFixtures'

interface Line { player_id: string; stats: Record<string, number | null>; player?: { first_name?: string; last_name?: string; position?: string } }
const lines = (name: string) =>
  readFixture<Line[]>('FCCore', name).map((l) => ({
    ...l,
    stats: Object.fromEntries(Object.entries(l.stats).filter((e): e is [string, number] => typeof e[1] === 'number')),
    name: [l.player?.first_name, l.player?.last_name].filter(Boolean).join(' '),
  }))
const league = () => readFixture<Record<string, number>>('FCCore', 'scoring-whack-a-mole.json')

/** Port of SleeperStatScoringTests. */
describe('SleeperStatScoring', () => {
  it("reproduces Sleeper's own standard points on real stat lines", () => {
    let checked = 0
    for (const line of lines('stats-2026-w2.json')) {
      const position = line.player?.position
      const reference = line.stats.pts_std
      if (!position || !['QB', 'RB', 'WR', 'TE'].includes(position) || reference === undefined) continue
      expect(Math.abs(scoreSleeperStats(line.stats, SLEEPER_STANDARD).points - reference), `${line.name} (${position})`).toBeLessThanOrEqual(0.011)
      checked++
    }
    expect(checked).toBeGreaterThan(40)
  })

  it('scores IDP through the league rules', () => {
    const scoring = league()
    const idp = lines('stats-2026-w2.json').filter((l) => ['LB', 'DL', 'DB'].includes(l.player?.position ?? ''))
    expect(idp.length).toBeGreaterThan(0)
    let viaIDP = 0
    for (const line of idp) {
      const scored = scoreSleeperStats(line.stats, scoring)
      for (const c of scored.components) {
        expect(scoring[c.key], `${line.name}: ${c.key}`).toBeDefined()
        expect(isNonScoringKey(c.key)).toBe(false)
      }
      if (scored.components.some((c) => c.key.startsWith('idp_'))) viaIDP++
    }
    expect(viaIDP).toBeGreaterThan(10)
    expect(scoring.idp_sack).toBe(5)
    expect(scoring.idp_tkl).toBe(0)
  })

  it('fires at most one points-allowed bucket for a defense', () => {
    const scoring = league()
    const defenses = lines('stats-2026-w2.json').filter((l) => l.player?.position === 'DEF')
    expect(defenses.length).toBeGreaterThan(0)
    for (const line of defenses) {
      const buckets = scoreSleeperStats(line.stats, scoring).components.filter((c) => c.key.startsWith('pts_allow_'))
      expect(buckets.length).toBeLessThanOrEqual(1)
    }
  })

  it('scores a projection with a breakdown', () => {
    const gibbs = lines('projections-2026-w3.json').find((l) => l.name === 'Jahmyr Gibbs')!
    const scored = scoreSleeperStats(gibbs.stats, league())
    expect(scored.points).toBeGreaterThan(10)
    expect(Math.abs(scored.components.reduce((s, c) => s + c.points, 0) - scored.points)).toBeLessThanOrEqual(0.011)
    const mags = scored.components.map((c) => Math.abs(c.points))
    expect(mags).toEqual([...mags].sort((a, b) => b - a))
    expect(scored.components.some((c) => c.key === 'rush_yd')).toBe(true)
  })

  it('leaves ranks, totals and snaps out of the unscored keys', () => {
    const scored = scoreSleeperStats({ pts_std: 12, pos_rank_ppr: 3, off_snp: 40, tm_off_snp: 60, rec_tgt: 7, rec_yd: 50, gp: 1 }, { rec_yd: 0.1 })
    expect(scored.points).toBe(5)
    expect(scored.unscoredKeys).toEqual(['rec_tgt'])
  })

  it('ignores zero and non-finite units', () => {
    const scored = scoreSleeperStats({ rec_yd: 0, rush_yd: NaN, rec_td: 1 }, { rec_yd: 0.1, rush_yd: 0.1, rec_td: 6 })
    expect(scored.points).toBe(6)
    expect(scored.components).toHaveLength(1)
  })
})
