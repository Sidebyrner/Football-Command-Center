import { describe, expect, it } from 'vitest'
import { dashboardTransport } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import type { DashboardModel } from '../DashboardModel'
import { makeDashboard } from './dashboardHarness'

/**
 * Port of RefreshTests: pull-to-refresh must actually re-read what changes
 * during a week, and an ordinary repeat load must not.
 */
function make(): { model: DashboardModel; transport: StubTransport } {
  const transport = dashboardTransport()
  return { model: makeDashboard(transport), transport }
}

describe('Refresh', () => {
  it('a repeat load is served from cache', async () => {
    const { model, transport } = make()
    await model.load('L1', 1, 2025)
    const afterFirst = transport.requestCount

    await model.load('L1', 1, 2025)
    const afterSecond = transport.requestCount

    // Only the uncached-by-design reads may repeat; the league context and its
    // rosters must not be refetched.
    expect(afterSecond - afterFirst).toBeLessThan(afterFirst / 2)
  })

  /** The whole point of the gesture: rosters, league and week are re-read even though fresh cached copies exist. */
  it('refresh re-reads rosters and the current week', async () => {
    const { model, transport } = make()
    await model.load('L1', 1, 2025)
    await model.load('L1', 1, 2025)
    const beforeRefresh = transport.requestCount

    await model.refresh()
    const afterRefresh = transport.requestCount

    const rosterReads = transport.requestedPaths().filter((p) => p.endsWith('/rosters')).length
    const stateReads = transport.requestedPaths().filter((p) => p.endsWith('/state/nfl')).length
    expect(afterRefresh).toBeGreaterThan(beforeRefresh)
    expect(rosterReads, 'once on load, once on refresh — not on the cached repeat').toBe(2)
    expect(stateReads).toBeGreaterThanOrEqual(2)
  })

  /** The player index is 5 MB and Sleeper asks for it once a day; a refresh must not re-download it. */
  it('refresh does not refetch the player index', async () => {
    const { model, transport } = make()
    await model.load('L1', 1, 2025)
    await model.refresh()
    const playerReads = transport.requestedPaths().filter((p) => p.endsWith('/players/nfl')).length
    expect(playerReads).toBe(1)
  })

  it('a successful refresh is counted', async () => {
    const { model } = make()
    await model.load('L1', 1, 2025)
    expect(model.refreshCount, 'first load is not a refresh').toBe(0)

    await model.refresh()
    expect(model.refreshCount).toBe(1)
  })

  /**
   * A refresh that can't reach Sleeper keeps the screen useful by falling back
   * to the cached copy — labelled offline — and is not confirmed with a
   * success haptic, because nothing was actually refreshed.
   */
  it('a refresh that cannot reach Sleeper falls back and is not counted', async () => {
    const { model, transport } = make()
    await model.load('L1', 1, 2025)
    expect(model.context).toBeDefined()

    transport.fail('/league/L1')
    transport.fail('/state/nfl')
    await model.refresh()

    const context = model.context
    expect(context, 'the previous content stays').toBeDefined()
    expect(context!.provenance.kind, `expected the offline fallback, got ${JSON.stringify(context?.provenance)}`).toBe('staleCache')
    expect(model.refreshCount).toBe(0)
  })

  it('refresh before any load does nothing', async () => {
    const { model, transport } = make()
    await model.refresh()
    expect(transport.requestCount).toBe(0)
  })
})
