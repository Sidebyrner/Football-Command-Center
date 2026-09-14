import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStatsSeason, statsSeasonNote } from './statsSeason.js'

const manifest = (weeks2026) => [
  ...(weeks2026 == null ? [] : [{ season: 2026, weeks: weeks2026 }]),
  { season: 2025, weeks: 18 },
]

test('no current-season file uses last season, and says so', () => {
  const r = pickStatsSeason(manifest(null), 2026)
  assert.deepEqual(r, { statsSeason: 2025, currentSeasonWeeks: 0 })
  assert.match(statsSeasonNote({ ...r, scheduleSeason: 2026 }), /no 2026 weekly data yet/)
})

test('two weeks is not enough to switch', () => {
  const r = pickStatsSeason(manifest(2), 2026)
  assert.equal(r.statsSeason, 2025)
  assert.match(statsSeasonNote({ ...r, scheduleSeason: 2026 }), /until 2026 has 3 weeks of games \(it has 2\)/)
})

test('three weeks switches to the current season, with no note', () => {
  const r = pickStatsSeason(manifest(3), 2026)
  assert.equal(r.statsSeason, 2026)
  assert.equal(statsSeasonNote({ ...r, scheduleSeason: 2026 }), null)
})

test('a season newer than the schedule season is never used', () => {
  assert.equal(pickStatsSeason(manifest(10), 2025).statsSeason, 2025)
})

test('with only a thin season available, it is still better than nothing', () => {
  assert.equal(pickStatsSeason([{ season: 2026, weeks: 1 }], 2026).statsSeason, 2026)
})

test('an empty manifest yields no stats season', () => {
  assert.deepEqual(pickStatsSeason([], 2026), { statsSeason: null, currentSeasonWeeks: 0 })
})
