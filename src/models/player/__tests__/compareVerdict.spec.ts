import { describe, expect, it } from 'vitest'
import type { Availability } from '@models/league/LeagueContext'
import { computeVerdict, type VerdictInput, type VerdictLeague } from '@models/player/CompareVerdict'

/** Port of CompareVerdictTests.swift — same inputs, same strings. */
describe('CompareVerdict', () => {
  const priorityLeague: VerdictLeague = {
    waivers: { kind: 'reverseStandings' }, waiverPosition: 3, teamCount: 8, currentWeek: 4, playoffStartWeek: 15,
  }
  const cap = (id: string) => id.charAt(0).toUpperCase() + id.slice(1)
  const fa = (id: string, ros?: number, o: { adds?: number; playoffs?: number; injury?: string } = {}): VerdictInput => ({
    id, name: cap(id), availability: { kind: 'freeAgent' }, restOfSeason: ros, projectedThisWeek: ros,
    expectedPointsLast4: ros, trendingAdds: o.adds, playoffMatchups: o.playoffs, injuryDesignation: o.injury,
  })
  const mine = (id: string, ros?: number, baseline = false): VerdictInput =>
    ({ ...fa(id, ros), availability: { kind: 'mine' }, isBaseline: baseline })
  const rival = (input: VerdictInput, availability: Availability): VerdictInput => ({ ...input, availability })
  const faabLeague: VerdictLeague = {
    waivers: { kind: 'faab', budget: 100 }, faabRemaining: 60, teamCount: 0, currentWeek: 4, playoffStartWeek: 15,
  }

  it('ranks targets and names the top two', () => {
    const v = computeVerdict([fa('low', 6), fa('high', 14), fa('mid', 10)], priorityLeague)
    expect(v.ranked.map((r) => r.id)).toEqual(['high', 'mid', 'low'])
    expect(v.headline).toBe('Best add: High, then Mid')
    expect(v.faab).toBeUndefined()
  })

  it('keeps your better player', () => {
    const v = computeVerdict([mine('mine', 30), fa('target', 8)], priorityLeague)
    expect(v.ranked.map((r) => r.id)).toEqual(['mine', 'target'])
    expect(v.ranked[0]!.isBaseline).toBe(true)
    expect(v.headline).toBe('Keep Mine over Target')
    expect(v.priority.kind).toBe('keep')
    expect(v.priority.text).toContain('22.0 pts/gm less')
    expect([v.pickID, v.alternativeID]).toEqual(['mine', 'target'])
  })

  it('a clear upgrade says add and drop', () => {
    const v = computeVerdict([mine('mine', 8), fa('big', 12)], priorityLeague)
    expect(v.headline).toBe('Add Big, drop Mine')
    expect(v.priority.kind).toBe('spend')
    expect(v.priority.text).toContain('+4.0 pts/gm over Mine')
    expect([v.pickID, v.alternativeID]).toEqual(['big', 'mine'])
  })

  it('a small upgrade keeps your player', () => {
    const v = computeVerdict([mine('mine', 8), fa('small', 9)], priorityLeague)
    expect(v.ranked[0]!.id).toBe('small')
    expect(v.headline).toBe('Keep Mine over Small')
    expect(v.priority.kind).toBe('keep')
    expect(v.priority.text).toContain('only +1.0 pts/gm')
  })

  it('without a chosen baseline your weakest player is the yardstick', () => {
    const v = computeVerdict([mine('star', 20), mine('scrub', 6), fa('target', 10)], priorityLeague)
    expect(v.ranked.map((r) => r.id)).toEqual(['star', 'target', 'scrub'])
    expect(v.ranked.find((r) => r.isBaseline)?.id).toBe('scrub')
    expect(v.headline).toBe('Add Target, drop Scrub')
  })

  it('a chosen baseline wins', () => {
    const v = computeVerdict([mine('star', 20, true), mine('scrub', 6), fa('target', 10)], priorityLeague)
    expect(v.headline).toBe('Keep Star over Target')
  })

  it('a rival target ahead of your player is a trade', () => {
    const starter = rival(fa('starter', 20), { kind: 'rivalStarter', rosterID: 2, manager: 'Mike' })
    const v = computeVerdict([mine('mine', 6), starter], priorityLeague)
    expect(v.headline).toBe('Best target: Starter (trade — Mike), over Mine')
    expect(v.priority.kind).toBe('notAClaim')
  })

  it('all yours ranks them', () => {
    const v = computeVerdict([mine('a', 6), mine('b', 12)], priorityLeague)
    expect(v.ranked.map((r) => r.id)).toEqual(['b', 'a'])
    expect(v.headline).toBe('B ranks highest of yours')
    expect(v.priority.kind).toBe('nothing')
  })

  it('a rival starter is discounted and reads as a trade', () => {
    const starter = rival(fa('starter', 12), { kind: 'rivalStarter', rosterID: 2, manager: 'Mike' })
    expect(computeVerdict([starter, fa('free', 11.5)], priorityLeague).ranked[0]!.id).toBe('free')
    const runaway = computeVerdict([starter, fa('free', 4)], priorityLeague)
    expect(runaway.ranked[0]!.id).toBe('starter')
    expect(runaway.headline.startsWith('Best target: Starter (trade — Mike)')).toBe(true)
    expect(runaway.priority.kind).toBe('notAClaim')
  })

  it('an injury pushes a player down', () => {
    const v = computeVerdict([fa('hurt', 12, { injury: 'Out' }), fa('healthy', 11)], priorityLeague)
    expect(v.ranked[0]!.id).toBe('healthy')
    expect(v.ranked.at(-1)!.reasons).toContain('Out')
  })

  it('missing measures are flagged as thin', () => {
    const sparse: VerdictInput = { id: 'sparse', name: 'Sparse', availability: { kind: 'freeAgent' }, pointsPerGame: 9 }
    const v = computeVerdict([sparse, fa('full', 9, { adds: 10, playoffs: 1 })], priorityLeague)
    expect(v.ranked.find((r) => r.id === 'sparse')!.thinData).toBe(true)
    expect(v.ranked.find((r) => r.id === 'full')!.thinData).toBe(false)
  })

  it('against a baseline the gap decides spend or keep', () => {
    const base = mine('mine', 8, true)
    const upgrade = computeVerdict([base, fa('big', 10.5)], priorityLeague)
    expect(upgrade.priority.kind).toBe('spend')
    expect(upgrade.priority.text).toContain('+2.5 pts/gm over Mine')
    expect(upgrade.priority.text).toContain('waiver priority')
    const marginal = computeVerdict([base, fa('small', 9)], priorityLeague)
    expect(marginal.priority.kind).toBe('keep')
    expect(marginal.priority.text).toContain('only +1.0')
    expect(marginal.priority.text).not.toContain('back of the order')
  })

  it('without a baseline demand decides', () => {
    expect(computeVerdict([fa('hot', 12, { adds: 40_000 }), fa('next', 9, { adds: 200 })], priorityLeague).priority.kind).toBe('spend')
    const quiet = computeVerdict([fa('quiet', 12, { adds: 50 }), fa('next', 9, { adds: 20 })], priorityLeague)
    expect(quiet.priority.kind).toBe('hold')
    expect(quiet.priority.text).toContain('clear waivers')
    expect(quiet.priority.text).not.toContain('back of the order')
  })

  it('near the back of the order a hold says a claim is cheap', () => {
    const league: VerdictLeague = { ...priorityLeague, waiverPosition: 8 }
    expect(computeVerdict([fa('quiet', 12), fa('next', 11)], league).priority.text).toContain('back of the order')
  })

  it('nothing to go after', () => {
    const v = computeVerdict([mine('mine', 8)], priorityLeague)
    expect(v.ranked.map((r) => r.id)).toEqual(['mine'])
    expect(v.headline).toBe('Mine is yours')
    expect(v.alternativeID).toBeUndefined()
    expect(v.priority.kind).toBe('nothing')
  })

  it('a keep never shows a bid', () => {
    expect(computeVerdict([mine('mine', 14), fa('target', 8, { adds: 40_000 })], faabLeague).faab).toBeUndefined()
    expect(computeVerdict([mine('mine', 6), fa('target', 14, { adds: 40_000 })], faabLeague).faab).toBeDefined()
  })

  it('a FAAB bid stays inside the budget and scales with the call', () => {
    const hot = computeVerdict([fa('hot', 14, { adds: 40_000 }), fa('next', 8)], faabLeague).faab!
    const quiet = computeVerdict([fa('quiet', 12, { adds: 10 }), fa('next', 11.5)], faabLeague).faab!
    expect(hot.low).toBeGreaterThan(quiet.high)
    for (const bid of [hot, quiet]) {
      expect(bid.low).toBeGreaterThanOrEqual(0)
      expect(bid.high).toBeLessThanOrEqual(60)
      expect(bid.low).toBeLessThanOrEqual(bid.high)
    }
    expect(computeVerdict([fa('hot', 14)], { ...faabLeague, faabRemaining: 0 }).faab).toBeUndefined()
  })
})
