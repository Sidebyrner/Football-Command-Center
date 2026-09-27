import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { demoServices } from '../../../../tests/renderScreen'
import type { AppServices } from '@models/app/AppServices'
import { COMPARISON_METRIC_LABEL } from '@models/player/PlayerComparison'
import { PlayerMetricsIndex, type MetricPoint, type PlayerMetric } from '@models/player/PlayerMetrics'
import { buildTrend } from '@models/player/TrendComparison'
import { LINK_GROUP_COLOR, NO_PANEL_COMPARE } from '@models/workspaces/PanelEnvironment'
import type { LinkGroup, PanelSettings } from '@models/workspaces/Workspace'
import { StaticAppProvider } from '@ui/app/AppContext'
import { text } from '../../market/specText'
import { ComparePanel, MetricPanel, TrendComparePanel } from './ChartPanels'
import { PanelEnvProvider, type PanelEnv, type PanelProps } from './PanelEnv'
import {
  areaPath, chartColor, groupedBars, labelStride, linearScale, monotonePath, niceDomain, niceStep, weekDomain,
} from './chartScale'
import { MetricChart, symbolRadius, TrendComparisonChart } from './chartViews'
import { barShortLabel } from './comparePanel'

const GROUP: LinkGroup = 1

function env(services: AppServices, settings: PanelSettings, group: LinkGroup | undefined, onApply: (s: PanelSettings) => void = () => {}): PanelEnv {
  return {
    inWorkspacePanel: true,
    linkGroup: group,
    linkPublish: { group, handler: (change) => { if (group !== undefined) services.linkBus.publish(change, group) } },
    compare: NO_PANEL_COMPARE,
    settingsUpdate: { settings, apply: onApply },
    inline: false,
  }
}

async function render(Panel: ComponentType<PanelProps>, extra: Record<string, string> = {}, linked = true): Promise<string> {
  const services = await demoServices()
  const settings: PanelSettings = { extra }
  const group = linked ? GROUP : undefined
  return text(renderToString(
    <MemoryRouter>
      <StaticAppProvider services={services}>
        <PanelEnvProvider value={env(services, settings, group)}>
          <div className="fcc"><Panel settings={settings} rows={6} /></div>
        </PanelEnvProvider>
      </StaticAppProvider>
    </MemoryRouter>,
  ))
}

/** A metrics index whose weekly series are hand-built (the demo league has no Sleeper stat lines). */
class StubIndex extends PlayerMetricsIndex {
  constructor(context: PlayerMetricsIndex['context'], private readonly data: Record<string, MetricPoint[]>) { super(context) }
  override series(_metric: PlayerMetric, playerID: string): MetricPoint[] { return this.data[playerID] ?? [] }
}

const pts = (...values: number[]): MetricPoint[] => values.map((value, i) => ({ week: i + 1, value }))

async function withStub<T>(data: Record<string, MetricPoint[]>, run: () => Promise<T>): Promise<T> {
  const services = await demoServices()
  const original = services.discovery.metrics
  services.discovery.metrics = new StubIndex(services.dashboard.context!, data)
  try { return await run() } finally { services.discovery.metrics = original }
}

async function roster() {
  const services = await demoServices()
  const ids = services.dashboard.context!.userTeam!.roster.map((e) => e.id)
  return { services, ids, name: (id: string) => services.dashboard.context!.playerName(id)! }
}

const last = (name: string) => name.split(' ').at(-1)!

afterEach(async () => { (await demoServices()).linkBus.clear(GROUP) })

describe('chart scale helpers', () => {
  it('pads the week domain by half a week', () => {
    expect(weekDomain([3, 5, 4])).toEqual([2.5, 5.5])
    expect(weekDomain([])).toEqual([0.5, 1.5])
  })
  it('maps linearly and centres a zero-width domain', () => {
    const s = linearScale([0, 10], [100, 0])
    expect(s(0)).toBe(100)
    expect(s(5)).toBe(50)
    expect(linearScale([2, 2], [0, 40])(2)).toBe(20)
  })
  it('picks nice steps and a zero-based domain with ticks', () => {
    expect(niceStep(23, 4)).toBe(10)
    expect(niceStep(1, 4)).toBe(0.25)
    expect(niceDomain([4.2, 18.7, 11])).toEqual({ domain: [0, 20], ticks: [0, 5, 10, 15, 20] })
    expect(niceDomain([0.31, 0.82])).toEqual({ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] })
    expect(niceDomain([]).domain).toEqual([0, 1])
    expect(niceDomain([-3, 7]).domain).toEqual([-5, 7.5])
  })
  it('thins week labels that would crowd', () => {
    expect(labelStride(6, 300)).toBe(1)
    expect(labelStride(18, 200)).toBe(3)
  })
  it('draws monotone curves and closed areas', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M0,0L10,5')
    const d = monotonePath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 0 }])
    expect(d.startsWith('M0,10C')).toBe(true)
    // A flat stretch stays flat: the control points of the last segment sit on y = 0.
    expect(d.endsWith('C13.33,0,16.67,0,20,0')).toBe(true)
    expect(areaPath([{ x: 0, y: 5 }, { x: 10, y: 2 }], 20)).toBe('M0,5L10,2L10,20L0,20Z')
  })
  it('lays out grouped bars inside each band', () => {
    const slots = groupedBars(2, 2, 200, 0.8, 2)
    expect(slots).toHaveLength(2)
    expect(slots[0]![0]!.x).toBeCloseTo(10)
    expect(slots[0]![0]!.width).toBeCloseTo(39)
    expect(slots[1]![1]!.x + slots[1]![1]!.width).toBeCloseTo(190)
  })
  it('colours series with the link colours in order and converts symbol areas', () => {
    expect(chartColor(0)).toBe(LINK_GROUP_COLOR[1])
    expect(chartColor(5)).toBe(LINK_GROUP_COLOR[2])
    expect(symbolRadius(34)).toBeCloseTo(3.3, 1)
  })
  it('shortens bar labels as Swift does', () => {
    expect(barShortLabel('expectedPointsLast4')).toBe('xFP L4')
    expect(barShortLabel('gradeScore')).toBe('Grade')
  })
})

describe('chart views with hand-built series', () => {
  it('draws a trend chart with week labels, lines, points and an accessible summary', async () => {
    const { services, ids, name } = await roster()
    const index = new StubIndex(services.dashboard.context!, { [ids[0]!]: pts(12, 18.4, 9), [ids[2]!]: pts(20, 7, 14) })
    const trend = buildTrend(index, 'fantasyPoints', [ids[0]!, ids[2]!], undefined, 'compare', 6)
    const html = text(renderToString(<TrendComparisonChart comparison={trend} />))
    expect(html).toContain('role="img"')
    expect(html).toContain(`Fantasy points by week for ${name(ids[0]!)}, ${name(ids[2]!)}`)
    for (const w of ['W1', 'W2', 'W3']) expect(html).toContain(`>${w}<`)
    expect(html.match(/<circle /g)).toHaveLength(6)
    expect(html).toContain(`stroke="${LINK_GROUP_COLOR[1]}"`)
    expect(html).toContain(`stroke="${LINK_GROUP_COLOR[2]}"`)
    expect(html).toContain(`${name(ids[0]!)}: W1 12, W2 18, W3 9.0.`)
  })

  it('draws one line with a soft fill, dashed projection and reference rule', async () => {
    const { services, ids } = await roster()
    const index = new StubIndex(services.dashboard.context!, { [ids[0]!]: pts(12, 18, 9) })
    const trend = buildTrend(index, 'fantasyPoints', [], ids[0]!, 'player', 6)
    const html = text(renderToString(
      <TrendComparisonChart comparison={trend} projection={new Map([[1, 15], [2, 16]])} reference={{ label: 'QB avg', value: 14.6 }} />,
    ))
    expect(html).toContain('linearGradient')
    expect(html).toContain('stroke-dasharray="4 3"')
    expect(html).toContain('QB avg 15')
    expect(html).toContain('stroke-width="3"')
  })

  it('draws a metric chart with percent axis labels', () => {
    const html = text(renderToString(
      <MetricChart metric="snapShare" series={[{ id: 'a', name: 'A Player', color: '#123456', points: [{ week: 4, value: 0.62 }, { week: 5, value: 0.81 }] }]} />,
    ))
    expect(html).toContain('>W4<')
    expect(html).toContain('>100%<')
    expect(html).toContain('Snap share by week for A Player')
    expect(html).toContain('A Player: W4 62%, W5 81%.')
  })
})

describe('Trend panel', () => {
  it('asks for a link colour when unlinked', async () => {
    const html = await render(TrendComparePanel, {}, false)
    expect(html).toContain('Pick a link colour on this panel, then click or ⌘-click players in panels of the same colour.')
    expect(html).toContain('Fantasy points')
    expect(html).toContain('Compare')
    expect(html).toContain('Raw')
  })

  it('waits for a click in the link colour', async () => {
    const html = await render(TrendComparePanel)
    expect(html).toContain('Click a player in any blue panel, or ⌘-click several to compare their trends.')
  })

  it('says nothing is logged on the demo league', async () => {
    const { services, ids } = await roster()
    services.linkBus.publish({ kind: 'addCompare', playerID: ids[0]! }, GROUP)
    services.linkBus.publish({ kind: 'addCompare', playerID: ids[2]! }, GROUP)
    const html = await render(TrendComparePanel, { metric: 'targets', smooth: '3' })
    expect(html).toContain('No targets logged for these players yet.')
    expect(html).toContain('3-game avg')
  })

  it('charts the compare list with a legend, summary table and footnote', async () => {
    const { services, ids, name } = await roster()
    services.linkBus.publish({ kind: 'addCompare', playerID: ids[0]! }, GROUP)
    services.linkBus.publish({ kind: 'addCompare', playerID: ids[2]! }, GROUP)
    const html = await withStub({ [ids[0]!]: pts(22, 25.5, 18, 30), [ids[2]!]: pts(15, 11, 19, 8) }, () => render(TrendComparePanel))
    expect(html).toContain('role="img"')
    expect(html).toContain(`Hide ${name(ids[0]!)}`)
    expect(html).toContain(last(name(ids[2]!)))
    expect(html).toContain('Avg')
    expect(html).toContain('Last 3')
    expect(html).toContain('Trend')
    expect(html).toContain('Rank')
    expect(html).toContain('24') // Allen's season average, 23.9 → "24"
    expect(html).toContain("Last 6 games · tap a name to hide its line · Sleeper's lines in your scoring.")
  })
})

describe('Compare panel', () => {
  it('asks for a link colour when unlinked', async () => {
    const html = await render(ComparePanel, {}, false)
    expect(html).toContain('Pick a link colour on this panel, then ⌘-click players in panels of the same colour.')
  })

  it('shows the empty state with the add field', async () => {
    const html = await render(ComparePanel)
    expect(html).toContain('Compare up to four players')
    expect(html).toContain('⌘-click players in any blue panel (long-press on iPad), or search above.')
    expect(html).toContain('Add a player…')
    expect(html).not.toContain('>Clear<')
  })

  it('compares players: chips, chart grid, per-game bars, table and ranges', async () => {
    const { services, ids, name } = await roster()
    for (const id of ids.slice(0, 3)) services.linkBus.publish({ kind: 'addCompare', playerID: id }, GROUP)
    const html = await render(ComparePanel, { charts: 'fantasyPoints,snapShare:3' })
    expect(html).toContain(name(ids[0]!))
    expect(html).toContain(`Remove ${name(ids[1]!)} from compare`)
    expect(html).toContain('>Clear<')
    expect(html).toContain('Chart data: Fantasy points. Change')
    expect(html).toContain('Chart data: Snap share. Change')
    expect(html).toContain('3-game avg')
    expect(html).toContain('No fantasy points logged for these players.')
    expect(html).toContain('Add chart')
    expect(html).toContain('Chart another stat for these players')
    expect(html).toContain('Per game')
    // The demo league carries rest-of-season projections and defense ranks, not per-game usage.
    expect(html).toContain(COMPARISON_METRIC_LABEL.restOfSeason)
    expect(html).toContain(COMPARISON_METRIC_LABEL.opponentRank)
    expect(html).toContain('>RoS<')
    expect(html).toContain('(best)')
    expect(html).toContain('Per-game numbers for')
    expect(html).toContain('Range this season')
    expect(html).toContain("Worst and best game this season; the dot is this week's projection, else his average.")
  })

  it('stops at four and charts hand-built series in the grid', async () => {
    const { services, ids } = await roster()
    for (const id of ids.slice(0, 4)) services.linkBus.publish({ kind: 'addCompare', playerID: id }, GROUP)
    const html = await withStub({ [ids[0]!]: pts(22, 25, 18), [ids[3]!]: pts(9, 14, 21) }, () => render(ComparePanel))
    expect(html).toContain('Four is the most — remove one to add another.')
    expect(html).toContain('Fantasy points by week for')
    expect(html).toContain('Hide ')
  })
})

describe('Metric panel', () => {
  it('asks for a link colour in player scope when unlinked', async () => {
    const html = await render(MetricPanel, {}, false)
    expect(html).toContain('Pick a link colour on this panel, then click a player in a panel of the same colour.')
    expect(html).toContain('Clicked player')
  })

  it('shows each scope’s empty state', async () => {
    expect(await render(MetricPanel, { scope: 'player' })).toContain('Click a player in any blue panel.')
    expect(await render(MetricPanel, { scope: 'compare' })).toContain('⌘-click players (or ＋ in Player search) to add them to the blue compare list.')
    const pinned = await render(MetricPanel, { scope: 'pinned' })
    expect(pinned).toContain('Search above to pin players to this panel.')
    expect(pinned).toContain('Pin a player…')
    expect(await render(MetricPanel, { scope: 'roster', metric: 'tackles' })).toContain('None of your players has tackles yet.')
  })

  it('shows one clicked player’s headline numbers and chart', async () => {
    const { services, ids, name } = await roster()
    services.linkBus.publish({ kind: 'player', playerID: ids[0]! }, GROUP)
    try {
      const empty = await render(MetricPanel)
      expect(empty).toContain(name(ids[0]!))
      expect(empty).toContain('No fantasy points logged for him yet.')
      expect(await render(MetricPanel, { metric: 'targets' })).toContain("Targets doesn't apply to a QB.")
      const html = await withStub({ [ids[0]!]: pts(22, 25.5, 18, 30) }, () => render(MetricPanel))
      expect(html).toContain('24') // season average 23.9
      expect(html).toContain('pts')
      expect(html).toContain('per game · 4 games')
      expect(html).toContain('Last game (W4)')
      expect(html).toContain('Last 3')
      expect(html).toContain('Trending up')
      expect(html).toContain('Fantasy points by week for')
      expect(html).toContain("Sleeper's lines in your scoring.")
    } finally {
      services.linkBus.selections = new Map()
    }
  })

  it('ranks several pinned players with a chart and unpin buttons', async () => {
    const { ids, name } = await roster()
    const html = await withStub({ [ids[0]!]: pts(22, 25, 18), [ids[2]!]: pts(15, 30, 21) }, () =>
      render(MetricPanel, { scope: 'pinned', pinned: `${ids[0]},${ids[2]}` }))
    expect(html).toContain('Pinned players')
    expect(html).toContain(`Unpin ${name(ids[2]!)}`)
    expect(html).toContain('Avg')
    expect(html.indexOf(last(name(ids[2]!)))).toBeLessThan(html.indexOf(`>${last(name(ids[0]!))}<`))
    expect(html).toContain('Per game this season; rank at his position among players with 2+ games. Sleeper\'s lines in your scoring.')
    expect(html).toContain('Fantasy points by week for')
  })
})
