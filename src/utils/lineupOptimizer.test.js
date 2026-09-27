// node --test src/utils/lineupOptimizer.test.js
//
// Ported from the iOS app's LineupOptimizerTests, which each guard a bug that
// actually happened. The web optimizer used to be greedy with a hill-climb and
// failed the overlapping-flex case below.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimizeLineup } from './lineupOptimizer.js'
import { parseRosterPositions } from './rosterSlots.js'

const players = {
  qb1: { position: 'QB' }, qb2: { position: 'QB' },
  rb1: { position: 'RB' }, rb2: { position: 'RB' }, rb3: { position: 'RB' },
  wr1: { position: 'WR' }, wr2: { position: 'WR' }, wr3: { position: 'WR' },
  te1: { position: 'TE' },
}

const run = (tokens, starters, roster, values, extra = {}) =>
  optimizeLineup({
    currentStarterIds: starters,
    playerIds: roster,
    template: parseRosterPositions(tokens),
    playersById: players,
    valueOf: (id) => values[id] ?? null,
    ...extra,
  })

test('a player the basis cannot value is unranked, never scored as zero', () => {
  const r = run(['QB', 'RB', 'FLEX'], ['qb1', 'rb1', 'wr1'], ['qb1', 'rb1', 'wr1', 'rb2', 'wr2'],
    { qb1: 20, rb1: 12, wr1: 9, rb2: 11 })
  assert.deepEqual(r.unranked, ['wr2'])
  assert.ok(!r.proposedIds.includes('wr2'))
  assert.equal(r.proposedTotal, 43)
})

test('overlapping flex slots do not strand a better player', () => {
  // WRRB_FLEX takes RB or WR; REC_FLEX takes WR or TE. Seating the best receiver
  // in WRRB_FLEX strands the back. The best lineup is rb1 + wr1 = 19.
  const r = run(['WRRB_FLEX', 'REC_FLEX'], [], ['wr1', 'rb1', 'wr2'], { wr1: 10, rb1: 9, wr2: 3 })
  assert.equal(r.proposedTotal, 19)
  assert.ok(r.proposedIds.includes('rb1') && r.proposedIds.includes('wr1'))
})

test('super flex and a dedicated QB slot both fill', () => {
  const r = run(['QB', 'SUPER_FLEX'], [], ['qb1', 'qb2', 'rb1'], { qb1: 25, qb2: 20, rb1: 12 })
  assert.equal(r.proposedTotal, 45)
})

test('no cosmetic swap between interchangeable slots', () => {
  const r = run(['QB', 'SUPER_FLEX'], ['qb2', 'qb1'], ['qb1', 'qb2'], { qb1: 25, qb2: 20 })
  assert.deepEqual(r.proposedIds, ['qb2', 'qb1'])
  assert.equal(r.swaps.length, 0)
})

test('a marginal upgrade inside the incumbency margin is not proposed', () => {
  const r = run(['RB'], ['rb1'], ['rb1', 'rb2'], { rb1: 12.0, rb2: 12.02 })
  assert.deepEqual(r.proposedIds, ['rb1'])
  assert.equal(r.swaps.length, 0)
})

test('a real upgrade is proposed with its gain', () => {
  const r = run(['RB'], ['rb1'], ['rb1', 'rb2'], { rb1: 10, rb2: 14 })
  assert.deepEqual(r.proposedIds, ['rb2'])
  assert.equal(r.gain, 4)
  assert.deepEqual(r.swaps.map((s) => [s.outId, s.inId, s.delta]), [['rb1', 'rb2', 4]])
})

test('an unset slot is filled and counts as gain', () => {
  const r = run(['QB', 'RB'], ['qb1', '0'], ['qb1', 'rb1'], { qb1: 20, rb1: 11 })
  assert.deepEqual(r.proposedIds, ['qb1', 'rb1'])
  assert.equal(r.swaps[0].outId, null)
  assert.equal(r.swaps[0].delta, 11)
})

test('swaps fully explain the proposed lineup and are ordered by gain', () => {
  const current = ['qb1', 'rb1', 'rb2', 'wr1']
  const r = run(['QB', 'RB', 'RB', 'WR'], current, ['qb1', 'qb2', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2'],
    { qb1: 10, qb2: 20, rb1: 5, rb2: 12, rb3: 9, wr1: 4, wr2: 15 })
  const rebuilt = [...current]
  for (const s of r.swaps) rebuilt[s.slotIndex] = s.inId
  assert.deepEqual(rebuilt, r.proposedIds)
  const deltas = r.swaps.map((s) => s.delta)
  assert.deepEqual(deltas, [...deltas].sort((a, b) => b - a))
})

// ── Locks ──────────────────────────────────────────────────────────────────

test('a locked starter is never swapped out', () => {
  const r = run(['QB', 'RB', 'RB', 'FLEX'], ['qb1', 'rb1', 'rb2', 'wr1'], ['qb1', 'qb2', 'rb1', 'rb2', 'wr1'],
    { qb1: 5, qb2: 30, rb1: 10, rb2: 9, wr1: 8 }, { locked: ['qb1'] })
  assert.equal(r.proposedIds[0], 'qb1')
  assert.ok(!r.swaps.some((s) => s.outId === 'qb1' || s.inId === 'qb2'))
})

test('a locked bench player is never started and is not unranked', () => {
  const r = run(['QB', 'RB', 'RB', 'FLEX'], ['qb1', 'rb1', 'rb2', 'wr1'], ['qb1', 'rb1', 'rb2', 'rb3', 'wr1'],
    { qb1: 20, rb1: 10, rb2: 9, rb3: 25, wr1: 8 }, { locked: ['rb3'] })
  assert.ok(!r.proposedIds.includes('rb3'))
  assert.ok(!r.unranked.includes('rb3'))
})

test('unlocked slots are still optimized, with full-lineup slot indices', () => {
  const r = run(['QB', 'RB', 'RB', 'FLEX'], ['qb1', 'rb1', 'rb2', 'wr1'], ['qb1', 'rb1', 'rb2', 'rb3', 'wr1'],
    { qb1: 20, rb1: 10, rb2: 4, rb3: 12, wr1: 8 }, { locked: ['rb1'] })
  assert.equal(r.proposedIds[1], 'rb1')
  const swap = r.swaps.find((s) => s.inId === 'rb3')
  assert.equal(swap.outId, 'rb2')
  assert.equal(swap.slotIndex, 2)
})

test('totals include locked starters', () => {
  const r = run(['QB', 'RB', 'RB', 'FLEX'], ['qb1', 'rb1', 'rb2', 'wr1'], ['qb1', 'rb1', 'rb2', 'rb3', 'wr1'],
    { qb1: 20, rb1: 10, rb2: 4, rb3: 12, wr1: 8 }, { locked: ['qb1'] })
  assert.equal(r.currentTotal, 42)
  assert.equal(r.proposedTotal, 50)
  assert.equal(r.gain, 8)
})

test('no locks gives exactly the plain result', () => {
  const values = { qb1: 20, qb2: 22, rb1: 10, rb2: 4, rb3: 12, wr1: 8 }
  const roster = ['qb1', 'qb2', 'rb1', 'rb2', 'rb3', 'wr1']
  const starters = ['qb1', 'rb1', 'rb2', 'wr1']
  const tokens = ['QB', 'RB', 'RB', 'FLEX']
  assert.deepEqual(run(tokens, starters, roster, values, { locked: [] }), run(tokens, starters, roster, values))
})

test('defenders are started through fantasy_positions, and a dual-eligible one fills either slot', () => {
  const roster = {
    de: { position: 'DE', fantasyPositions: ['DL'] },
    hybrid: { position: 'LB', fantasyPositions: ['DL', 'LB'] },
    ilb: { position: 'ILB' }, // no fantasy_positions: falls back to LB
  }
  const r = optimizeLineup({
    currentStarterIds: ['0', '0'],
    playerIds: Object.keys(roster),
    template: parseRosterPositions(['DL', 'LB']),
    playersById: roster,
    valueOf: (id) => ({ de: 5, hybrid: 9, ilb: 4 })[id],
  })
  assert.deepEqual(r.proposedIds, ['de', 'hybrid'], 'hybrid at LB and the DE at DL beats hybrid at DL and the ILB')
  assert.equal(r.proposedTotal, 14)
})
