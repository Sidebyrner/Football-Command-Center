import { describe, expect, it } from 'vitest'
import { metricApplies, PlayerMetricsIndex } from '@models/player/PlayerMetrics'
import { buildTrend, chartSpecsFrom, encodeChartSpecs, MAX_CHARTS, metricStoredAs, smoothed, trendWeeks } from '@models/player/TrendComparison'
import { WorkspaceFixture as F } from '../../../../tests/workspaceFixture'

// Swift reads `services.discovery.metrics`; that index is built from the same shared context.
const index = async () => new PlayerMetricsIndex(await F.context())

/** Port of PlayerMetricsTests: weekly metrics from the recorded week-2 lines (served for weeks 1 and 2). */
describe('PlayerMetricsIndex', () => {
  it("takes counting stats from Sleeper's lines", async () => {
    const i = await index()
    expect(i.series('carries', F.cook).map((p) => p.value)).toEqual([21, 21])
    expect(i.series('rushingYards', F.cook).map((p) => p.value)).toEqual([135, 135])
    expect(i.series('receptions', F.cook).map((p) => p.value)).toEqual([1, 1])
    expect(i.series('targets', F.cook).map((p) => p.week)).toEqual([1, 2])
    expect(i.series('redZoneTouches', F.cook)[0]?.value).toBe(5)
    expect(i.series('snapShare', F.cook)[0]?.value).toBeCloseTo(55 / 74, 9)
  })

  it("computes target share over his team's targets that week", async () => {
    const i = await index()
    expect(i.series('targetShare', F.jsn)[0]?.value).toBeCloseTo(1, 9)
    const cook = i.series('targetShare', F.cook)[0]!.value
    expect(cook).toBeGreaterThan(0)
    expect(cook).toBeLessThanOrEqual(1)
  })

  it('reads defensive metrics and the zeros Sleeper leaves out', async () => {
    const i = await index()
    expect(i.series('tackles', F.bolton).map((p) => p.value)).toEqual([13, 13])
    expect(i.series('sacks', F.bolton).map((p) => p.value)).toEqual([0, 0])
    expect(i.series('snapShare', F.bolton)[0]?.value).toBeCloseTo(1, 9)
  })

  it('applies metrics only where they mean something', async () => {
    const i = await index()
    expect(i.series('tackles', F.cook)).toEqual([])
    expect(i.series('targets', F.mahomes)).toEqual([])
    expect(i.series('fantasyPoints', F.mahomes).length).toBeGreaterThan(0)
    expect(metricApplies('yardsAfterContact', 'RB')).toBe(true)
    expect(metricApplies('yardsAfterContact', 'WR')).toBe(false)
  })

  it('summarises and ranks at his position', async () => {
    const i = await index()
    const s = i.summary('rushingYards', F.cook)!
    expect([s.games, s.seasonAverage, s.lastGame, s.lastWeek, s.lastThreeAverage, s.trend]).toEqual([2, 135, 135, 2, 135, undefined])
    const board = i.leaderboard('rushingYards', 'RB')
    expect(s.rankOf).toBe(board.length)
    expect(board.map((b) => b.average)).toEqual([...board.map((b) => b.average)].sort((a, b) => b - a))
    expect(board[s.rank! - 1]?.id).toBe(F.cook)
  })

  it('lists my players best first, leaving IR out', async () => {
    const i = await index()
    const roster = i.rosterPlayers('fantasyPoints')
    expect(roster).not.toContain(F.kyren)
    const averages = roster.map((id) => i.summary('fantasyPoints', id)!.seasonAverage)
    expect(averages).toEqual([...averages].sort((a, b) => b - a))
    expect(i.rosterPlayers('tackles')).toEqual([F.bolton])
  })
})

/** Port of TrendComparisonTests. */
describe('TrendComparison', () => {
  it('lists the compare list in order, then the clicked player uncoloured', async () => {
    const t = buildTrend(await index(), 'fantasyPoints', [F.jsn, F.cook], F.mahomes, 'compare', 8)
    expect(t.lines.map((l) => l.id)).toEqual([F.jsn, F.cook, F.mahomes])
    expect(t.lines.map((l) => l.compareIndex)).toEqual([0, 1, undefined])
    expect(t.lines.map((l) => l.isFocused)).toEqual([false, false, true])
    expect(t.lines.every((l) => l.points.length > 0)).toBe(true)
    expect(trendWeeks(t)).toEqual([1, 2])
  })

  it('keeps the colour of a clicked player already compared; player scope shows only him', async () => {
    const i = await index()
    const a = buildTrend(i, 'fantasyPoints', [F.jsn, F.cook], F.cook, 'compare', 8)
    expect(a.lines).toHaveLength(2)
    expect([a.lines[1]!.compareIndex, a.lines[1]!.isFocused]).toEqual([1, true])
    const b = buildTrend(i, 'fantasyPoints', [F.jsn], F.cook, 'player', 8)
    expect(b.lines.map((l) => l.id)).toEqual([F.cook])
    expect(b.lines[0]!.compareIndex).toBeUndefined()
  })

  it("lists a player the metric doesn't apply to with an empty line; last N keeps recent weeks", async () => {
    const i = await index()
    const t = buildTrend(i, 'targets', [F.cook, F.mahomes], undefined, 'compare', 8)
    expect(t.lines.map((l) => l.applies)).toEqual([true, false])
    expect(t.lines[1]!.points).toEqual([])
    expect(t.lines[1]!.summary).toBeUndefined()
    expect(buildTrend(i, 'carries', [F.cook], undefined, 'compare', 1).lines[0]!.points.map((p) => p.week)).toEqual([2])
  })

  it('smooths looking back into history before the window', () => {
    const history = [4, 8, 12, 2].map((value, i) => ({ week: i + 1, value }))
    const window = history.slice(-2)
    const s = smoothed(window, 3, history)
    expect(s.map((p) => p.week)).toEqual([3, 4])
    expect(s[0]!.value).toBeCloseTo(8, 9)
    expect(s[1]!.value).toBeCloseTo(22 / 3, 9)
    expect(smoothed(window, 1, history).map((p) => p.value)).toEqual([12, 2])
    expect(smoothed(history.slice(0, 1), 3, history)[0]!.value).toBe(4)
  })

  it('reads stored metric keys and round-trips chart lists', () => {
    expect([metricStoredAs('points'), metricStoredAs('snapShare'), metricStoredAs(undefined), metricStoredAs('nonsense')]).toEqual(['fantasyPoints', 'snapShare', undefined, undefined])
    const specs = [{ metric: 'targets', smoothing: 1 }, { metric: 'snapShare', smoothing: 3 }, { metric: 'fantasyPoints', smoothing: 1 }] as const
    const stored = encodeChartSpecs(specs)
    expect(stored).toBe('targets,snapShare:3,fantasyPoints')
    expect(chartSpecsFrom(stored)).toEqual(specs)
    expect(chartSpecsFrom(undefined)).toEqual([{ metric: 'fantasyPoints', smoothing: 1 }])
    expect(chartSpecsFrom('')).toEqual([])
    expect(encodeChartSpecs([])).toBe('')
    expect(chartSpecsFrom('bogus,points:3,sacks')).toEqual([{ metric: 'fantasyPoints', smoothing: 3 }, { metric: 'sacks', smoothing: 1 }])
    expect(chartSpecsFrom(Array(9).fill('targets').join(','))).toHaveLength(MAX_CHARTS)
  })

  it.todo('every metric has a picker group — the groups live in the Compare charts view, ported with Phase 3')
})
