import { describe, expect, it } from 'vitest'
import type { Position } from '@core/Position'
import { assignSlots, dedicatedCounts, dedicatedSlot, flexSlot, flexSlots, isFlex, parseSlots, totalStarterSlots, type SlotTemplate } from '@core/RosterSlots'
import { optimizeLineup } from '@core/LineupOptimizer'
import { scoreSeason } from '@core/ScoringEngine'
import { LEAGUE_DEFAULT } from '@core/ScoringProfile'
import { LEAGUE_ROSTER_POSITIONS, Player, weekly2025 } from '../../../tests/coreFixtures'

const leagueTemplate = () => parseSlots(LEAGUE_ROSTER_POSITIONS)

/** Port of RosterSlotsTests. */
describe('RosterSlots', () => {
  it("parses the league's own template", () => {
    const t = leagueTemplate()
    expect([totalStarterSlots(t), t.benchCount, t.unrecognized]).toEqual([11, 6, []])
    expect(t.starters.map((s) => s.token)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'IDP_FLEX', 'IDP_FLEX'])
    expect(dedicatedCounts(t)).toEqual({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 })
    expect(flexSlots(t)).toHaveLength(3)
  })

  it('ignores IR and taxi but counts the bench', () => {
    const t = parseSlots(['QB', 'BN', 'BN', 'IR', 'TAXI', 'IR'])
    expect([totalStarterSlots(t), t.benchCount, t.unrecognized]).toEqual([1, 2, []])
  })

  it('knows each flex eligibility set', () => {
    const t = parseSlots(['FLEX', 'SUPER_FLEX', 'WRRB_FLEX', 'WRTE_FLEX', 'REC_FLEX', 'IDP_FLEX'])
    const e = Object.fromEntries(t.starters.map((s) => [s.token, s.eligible]))
    expect(e.FLEX).toEqual(new Set(['RB', 'WR', 'TE']))
    expect(e.SUPER_FLEX).toEqual(new Set(['QB', 'RB', 'WR', 'TE']))
    expect(e.WRRB_FLEX).toEqual(new Set(['RB', 'WR']))
    expect(e.WRTE_FLEX).toEqual(new Set(['WR', 'TE']))
    expect(e.REC_FLEX).toEqual(new Set(['WR', 'TE']))
    expect(e.IDP_FLEX).toEqual(new Set(['LB', 'DL', 'DB']))
    expect(t.starters.every(isFlex)).toBe(true)
  })

  it('keeps and reports an unknown flex; reports an unknown token without a slot', () => {
    const hybrid = parseSlots(['QB', 'OP_FLEX'])
    expect([totalStarterSlots(hybrid), hybrid.unrecognized]).toEqual([2, ['OP_FLEX']])
    expect(isFlex(hybrid.starters[1]!)).toBe(true)
    expect(hybrid.starters[1]!.eligible).toEqual(new Set(['RB', 'WR', 'TE']))
    const unknown = parseSlots(['QB', 'WHAT'])
    expect([totalStarterSlots(unknown), unknown.unrecognized]).toEqual([1, ['WHAT']])
    expect([totalStarterSlots(parseSlots(undefined)), parseSlots(undefined).benchCount]).toEqual([0, 0])
  })

  it('assigns dedicated slots first, then flex, then bench, then overflow', () => {
    const positions: Record<string, Position> = { qb1: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', te1: 'TE', wr2: 'WR' }
    const a = assignSlots(['rb2', 'qb1', 'wr1', 'rb1', 'te1', 'wr2'], parseSlots(['QB', 'RB', 'WR', 'FLEX', 'BN']), (id) => positions[id])
    expect(a.filled).toEqual(['qb1', 'rb2', 'wr1', 'rb1'])
    expect(a.bench).toEqual(['te1'])
    expect(a.overflow).toEqual(['wr2'])
    const unset = assignSlots(['0', 'qb1'], parseSlots(['QB', 'RB']), (id) => (id === 'qb1' ? 'QB' : undefined))
    expect(unset.filled).toEqual(['qb1', undefined])
    expect(unset.overflow).toEqual([])
  })
})

const positions: Record<string, Position> = {
  qb1: 'QB', qb2: 'QB', rb1: 'RB', rb2: 'RB', rb3: 'RB', wr1: 'WR', wr2: 'WR', wr3: 'WR',
  te1: 'TE', te2: 'TE', k1: 'K', def1: 'DEF', lb1: 'LB', db1: 'DB',
}
const optimize = (template: SlotTemplate, starters: string[], roster: string[], values: Record<string, number>, locked?: string[]) =>
  optimizeLineup({
    currentStarterIDs: starters, playerIDs: roster, template,
    positions: (id) => positions[id], valueOf: (id) => values[id], locked: locked && new Set(locked),
  })

/** Port of LineupOptimizerTests. */
describe('LineupOptimizer', () => {
  it('reports an unvalued player as unranked, never zero', () => {
    const p = optimize(parseSlots(['QB', 'RB', 'FLEX']), ['qb1', 'rb1', 'wr1'], ['qb1', 'rb1', 'wr1', 'rb2', 'wr2'], { qb1: 20, rb1: 12, wr1: 9, rb2: 11 })
    expect(p.unranked).toEqual(['wr2'])
    expect(p.valuedCount).toBe(4)
    expect(p.proposedIDs).not.toContain('wr2')
    expect(p.swaps.some((s) => s.inID === 'wr2')).toBe(false)
    expect(p.proposedTotal).toBeCloseTo(43, 3)
  })

  it('proposes nothing when the basis values nobody', () => {
    const p = optimize(parseSlots(['QB', 'RB']), ['qb1', 'rb1'], ['qb1', 'rb1'], {})
    expect([...p.unranked].sort()).toEqual(['qb1', 'rb1'])
    expect(p.valuedCount).toBe(0)
    expect(p.proposedIDs).toEqual([undefined, undefined])
    expect(p.currentTotal).toBeUndefined()
    expect(p.gain).toBeUndefined()
    expect(p.swaps).toEqual([])
  })

  it("doesn't strand a better player behind overlapping eligibility", () => {
    const template: SlotTemplate = { starters: [flexSlot('WRRB_FLEX', ['RB', 'WR']), dedicatedSlot('WR')], benchCount: 2, unrecognized: [] }
    const p = optimize(template, [], ['wr1', 'rb1', 'wr2'], { wr1: 10, rb1: 9, wr2: 3 })
    expect(p.proposedIDs).toEqual(['rb1', 'wr1'])
    expect(p.proposedTotal).toBeCloseTo(19, 3)
  })

  it('fills both a QB slot and a superflex', () => {
    const p = optimize(parseSlots(['QB', 'SUPER_FLEX']), [], ['qb1', 'qb2', 'rb1'], { qb1: 25, qb2: 22, rb1: 14 })
    expect(new Set(p.proposedIDs)).toEqual(new Set(['qb1', 'qb2']))
    expect(p.proposedTotal).toBeCloseTo(47, 3)
  })

  it('makes no cosmetic swap between interchangeable slots', () => {
    const p = optimize(parseSlots(['QB', 'SUPER_FLEX']), ['qb2', 'qb1'], ['qb1', 'qb2'], { qb1: 25, qb2: 22 })
    expect(p.proposedIDs).toEqual(['qb2', 'qb1'])
    expect(p.swaps).toEqual([])
    expect(p.gain).toBe(0)
  })

  it('ignores a marginal upgrade and proposes a real one', () => {
    expect(optimize(parseSlots(['RB']), ['rb1'], ['rb1', 'rb2'], { rb1: 12.0, rb2: 12.02 }).swaps).toEqual([])
    const p = optimize(parseSlots(['RB']), ['rb1'], ['rb1', 'rb2'], { rb1: 12, rb2: 18 })
    expect(p.proposedIDs).toEqual(['rb2'])
    expect(p.swaps).toHaveLength(1)
    expect([p.swaps[0]!.outID, p.swaps[0]!.inID, p.swaps[0]!.delta, p.gain]).toEqual(['rb1', 'rb2', 6, 6])
  })

  it('fills an unset slot and counts it as gain', () => {
    const p = optimize(parseSlots(['QB', 'RB']), ['qb1', '0'], ['qb1', 'rb1'], { qb1: 20, rb1: 14 })
    expect(p.proposedIDs).toEqual(['qb1', 'rb1'])
    expect([p.swaps[0]!.outID, p.swaps[0]!.inID, p.swaps[0]!.delta, p.gain]).toEqual([undefined, 'rb1', 14, 14])
  })

  it('explains every change with a swap', () => {
    const starters = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'wr3', 'k1', 'def1', 'lb1', '0']
    const roster = [...starters.filter((s) => s !== '0'), 'rb3', 'te2', 'db1', 'qb2']
    const values = { qb1: 24, qb2: 9, rb1: 18, rb2: 11, rb3: 16, wr1: 15, wr2: 12, wr3: 10, te1: 8, te2: 13, k1: 7, def1: 6, lb1: 5, db1: 4 }
    const p = optimize(leagueTemplate(), starters, roster, values)
    expect(p.unranked).toEqual([])
    expect(p.proposedIDs).toHaveLength(starters.length)
    p.proposedIDs.forEach((proposed, i) => {
      const current = starters[i] === '0' ? undefined : starters[i]
      const swap = p.swaps.find((s) => s.slotIndex === i)
      if (proposed === current) expect(swap, `slot ${i}`).toBeUndefined()
      else if (proposed !== undefined) expect([swap?.inID, swap?.outID], `slot ${i}`).toEqual([proposed, current])
    })
  })

  it('orders swaps by gain', () => {
    const p = optimize(parseSlots(['QB', 'RB', 'WR']), ['qb1', 'rb1', 'wr1'], ['qb1', 'qb2', 'rb1', 'rb2', 'wr1', 'wr2'], { qb1: 10, qb2: 30, rb1: 10, rb2: 14, wr1: 10, wr2: 11 })
    expect(p.swaps.map((s) => s.inID)).toEqual(['qb2', 'rb2', 'wr2'])
    expect(p.swaps.map((s) => s.delta)).toEqual([20, 4, 1])
  })

  it('lets two bases disagree, and proposes nothing for an empty template', () => {
    expect(optimize(parseSlots(['FLEX']), ['rb1'], ['rb1', 'wr1'], { rb1: 14, wr1: 12 }).proposedIDs).toEqual(['rb1'])
    expect(optimize(parseSlots(['FLEX']), ['rb1'], ['rb1', 'wr1'], { rb1: 18, wr1: 26 }).proposedIDs).toEqual(['wr1'])
    const empty = optimize(parseSlots([]), [], ['qb1'], { qb1: 10 })
    expect(empty.proposedIDs).toEqual([])
    expect(empty.swaps).toEqual([])
  })

  it('keeps locked starters in place and never starts a locked bench player', () => {
    const p = optimize(parseSlots(['RB', 'RB', 'WR']), ['rb1', 'rb2', 'wr1'], ['rb1', 'rb2', 'rb3', 'wr1', 'wr2'],
      { rb1: 5, rb2: 12, rb3: 15, wr1: 6, wr2: 20 }, ['rb1', 'wr2'])
    expect(p.proposedIDs[0]).toBe('rb1')
    expect(p.proposedIDs).not.toContain('wr2')
    expect(p.proposedIDs).toEqual(['rb1', 'rb3', 'wr1'])
    expect(p.swaps.map((s) => [s.slotIndex, s.outID, s.inID])).toEqual([[1, 'rb2', 'rb3']])
    expect([p.currentTotal, p.proposedTotal, p.gain]).toEqual([23, 26, 3])
  })

  it('works on real season pace values', () => {
    const file = weekly2025()
    const pace: Record<string, number> = {}
    const pos: Record<string, Position> = {}
    for (const id of [Player.joshAllen, Player.bijanRobinson, Player.aaronRodgers]) {
      pos[id] = file.position(id)!
      pace[id] = scoreSeason(file.rows(id), LEAGUE_DEFAULT, pos[id]).pointsPerGame!
    }
    const p = optimizeLineup({
      currentStarterIDs: [Player.aaronRodgers, Player.bijanRobinson, '0', '0', '0', '0', '0'],
      playerIDs: [Player.joshAllen, Player.bijanRobinson, Player.aaronRodgers],
      template: parseSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']),
      positions: (id) => pos[id], valueOf: (id) => pace[id],
    })
    expect(p.proposedIDs[0]).toBe(Player.joshAllen)
    expect(Math.abs(p.gain! - 14.8)).toBeLessThanOrEqual(0.05)
    expect(p.unranked).toEqual([])
  })
})
