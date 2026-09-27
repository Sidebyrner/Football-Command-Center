import { describe, expect, it } from 'vitest'
import type { Position } from '@core/Position'
import type { Baselines } from '@core/Baselines'
import type { RosterEntry } from '@core/ByeCrunch'
import { parseSlots } from '@core/RosterSlots'
import { ByeCalendar } from '@core/ByeWeeks'
import { buildTeamNeeds, isDepthOnly, needWeeks, surplusAt } from '@core/TeamNeeds'
import { schedule } from '../../../tests/coreFixtures'

/**
 * Port of TeamNeedsTests: needs and surplus on the real 2025 schedule.
 * Week 8 byes: ARI, DET, JAX, LA, LV, SEA. Week 5 byes: ATL, CHI, GB, PIT.
 */
const template = parseSlots(['QB', 'RB', 'RB', 'WR', 'FLEX', 'DEF', 'BN', 'BN', 'BN'])
const baselines = (): Baselines => ({
  RB: { position: 'RB', starters: 24, startLine: 12, replacementLine: 10, pool: 60 },
  WR: { position: 'WR', starters: 24, startLine: 11, replacementLine: 9, pool: 80 },
})
const roster: RosterEntry[] = [
  { id: 'qb', position: 'QB', team: 'BUF' },
  { id: 'rb_la', position: 'RB', team: 'LA' },
  { id: 'rb_sea', position: 'RB', team: 'SEA' },
  { id: 'rb_atl', position: 'RB', team: 'ATL' },
  { id: 'wr_min', position: 'WR', team: 'MIN' },
  { id: 'wr_dal', position: 'WR', team: 'DAL' },
  { id: 'PHI', position: 'DEF', team: 'PHI' },
  { id: 'DAL', position: 'DEF', team: 'DAL' },
]
const starters = ['qb', 'rb_la', 'rb_sea', 'wr_min', 'wr_dal', 'PHI']
const values: Record<string, number> = { qb: 20, rb_la: 15, rb_sea: 8, rb_atl: 11, wr_min: 13, wr_dal: 10 }

const build = (r: RosterEntry[], s: string[], v: Record<string, number>, weeks: number[]) =>
  buildTeamNeeds({ roster: r, starters: s, template, values: v, baselines: baselines(), calendar: new ByeCalendar(schedule(2025)), weeks })

describe('TeamNeeds', () => {
  /** Both starting backs are off in week 8; the ATL back covers one slot, so RB is short by one — a dedicated need. */
  it('makes a short dedicated slot a need for that position', () => {
    const needs = build(roster, starters, values, [7, 8])
    const rb = needs.needs.find((n) => n.positions.size === 1 && n.positions.has('RB' as Position) && needWeeks(n) !== undefined)
    expect(rb).toBeDefined()
    expect(needWeeks(rb!)).toEqual([8])
    expect(rb!.viaFlex).toBe(false)
  })

  /** The SEA back averages 8, four under the RB start line of 12. */
  it('makes a starter below the start line a weak-starter need', () => {
    const needs = build(roster, starters, values, [7])
    const weak = needs.needs.flatMap((n) => (n.kind.kind === 'weakStarter' ? [[n.kind.playerID, n.kind.gap] as const] : []))
    expect(weak[0]?.[0]).toBe('rb_sea')
    expect(Math.abs((weak[0]?.[1] ?? 0) - 4)).toBeLessThanOrEqual(0.001)
    expect(weak.some(([id]) => id === 'wr_dal'), "a flex starter isn't measured against one position's line").toBe(false)
  })

  /** Three backs for two RB slots: the bench back is surplus, above replacement, and off in ATL's week 5 bye. */
  it('makes a bench player at a covered position surplus', () => {
    const needs = build(roster, starters, values, [5, 6])
    const atl = needs.surplus.find((s) => s.playerID === 'rb_atl')
    expect(atl).toBeDefined()
    expect(atl!.aboveReplacement).toBe(true)
    expect(atl!.playsWeeks).toEqual([6])
  })

  /** Only two receivers, one starting at WR and one in the flex: nothing spare. */
  it('has no surplus when the position is not covered', () => {
    const needs = build(roster, starters, values, [7])
    expect(surplusAt(needs, new Set<Position>(['WR']))).toEqual([])
  })

  /** A spare team defense is depth only — no production data, never a value. */
  it('treats a spare defense as depth only', () => {
    const needs = build(roster, starters, values, [7])
    const dal = needs.surplus.find((s) => s.playerID === 'DAL')
    expect(dal).toBeDefined()
    expect(isDepthOnly(dal!)).toBe(true)
    expect(dal!.value).toBeUndefined()
    expect(dal!.aboveReplacement).toBe(false)
  })

  /** Surplus is listed best value first, with no-value players last. */
  it('orders surplus by value', () => {
    const deeper = [...roster, { id: 'rb_kc', position: 'RB' as Position, team: 'KC' }]
    const needs = build(deeper, starters, { ...values, rb_kc: 14 }, [7])
    expect(needs.surplus[0]?.playerID).toBe('rb_kc')
    expect(needs.surplus[needs.surplus.length - 1]?.value).toBeUndefined()
  })
})
