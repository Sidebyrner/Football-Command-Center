import { RelayClient } from '@data/RelayClient'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { DashboardModel } from '../DashboardModel'
import { dashboardTransport, makeHarness, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'

/** A Dashboard wired to a stub, on the given clock (Swift's per-test `makeModel`). */
export function makeDashboard(
  transport: StubTransport,
  options: { now?: () => number; relay?: RelayClient } = {},
): DashboardModel {
  const { sleeper, staticData } = makeHarness(transport)
  return new DashboardModel(new LeagueContextLoader(sleeper, staticData, options.now ?? TestClock.beforeKickoffs), sleeper, options.relay)
}

/** Loaded on the week-7 dashboard fixture; a failed load fails the test (Swift skips). */
export async function loadedDashboard(
  options: { now?: () => number; relay?: RelayClient; configure?: (t: StubTransport) => void } = {},
): Promise<DashboardModel> {
  const transport = dashboardTransport()
  options.configure?.(transport)
  const model = makeDashboard(transport, options)
  await model.load('L1', 1, 2025)
  if (model.errorMessage !== undefined) throw new Error(`load failed: ${model.errorMessage}`)
  return model
}
