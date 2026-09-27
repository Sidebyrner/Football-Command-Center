import { describe, expect, it, vi } from 'vitest'
import { LeagueContextLoader } from '../LeagueContextLoader'
import { makeHarness, standardTransport, TestClock, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'

function setUp(reuseForSeconds = 60): { loader: LeagueContextLoader; transport: StubTransport } {
  const transport = standardTransport()
  const { sleeper, staticData } = makeHarness(transport)
  return { loader: new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs, reuseForSeconds * 1000), transport }
}

/** Counts real assemblies — the TS `ContextMemo` is private, so its `make` is the loader's `assemble`. */
const countAssemblies = (loader: LeagueContextLoader) =>
  vi.spyOn(loader as unknown as { assemble: (...a: unknown[]) => Promise<unknown> }, 'assemble')

const request = { leagueID: 'L1', userRosterID: 1, season: 2025 }

/** Port of ContextSharingTests: Dashboard, Matchup and Planning share one loader. */
describe('Context sharing', () => {
  it("a second screen reuses the first screen's context", async () => {
    const { loader, transport } = setUp()

    const first = await loader.load(request)
    const afterFirst = transport.requestCount
    const second = await loader.load(request)
    const afterSecond = transport.requestCount

    expect(afterSecond, 'the second load must not touch the data layer at all').toBe(afterFirst)
    expect(second.seasonProfiles.length).toBe(first.seasonProfiles.length)
  })

  /** Two screens asking at the same instant share one in-flight load. */
  it('simultaneous loads share one in-flight assembly', async () => {
    const { loader, transport } = setUp()
    await Promise.all([loader.load(request), loader.load(request)])
    const concurrent = transport.requestCount

    const solo = setUp()
    await solo.loader.load(request)
    const single = solo.transport.requestCount

    expect(concurrent).toBe(single)
  })

  /** Switching team is a different key, so it is never served the previous team's context. */
  it('a different roster is a different context', async () => {
    const { loader } = setUp()
    const mine = await loader.load(request)
    const theirs = await loader.load({ ...request, userRosterID: 2 })
    expect(mine.userRosterID).toBe(1)
    expect(theirs.userRosterID).toBe(2)
  })

  // MARK: - The memo itself (exercised through the loader; ContextMemo isn't exported)

  it('force rebuilds even when a fresh entry exists', async () => {
    const { loader } = setUp(3_600)
    const assemble = countAssemblies(loader)

    await loader.load(request)
    await loader.load(request)
    const reused = assemble.mock.calls.length
    await loader.load({ ...request, force: true })
    const forced = assemble.mock.calls.length

    expect(reused, 'a fresh entry is reused').toBe(1)
    expect(forced, 'force rebuilds regardless').toBe(2)
  })

  it('an entry older than max age is rebuilt', async () => {
    const { loader } = setUp(0)
    const assemble = countAssemblies(loader)

    await loader.load(request)
    await loader.load(request)

    expect(assemble.mock.calls.length).toBe(2)
  })

  /** A failure is not remembered: the next screen tries again. */
  it('a failure is not memoised', async () => {
    const transport = new StubTransport().json('/state/nfl', TestLeague.nflState).fail('/league/L1')
    const { sleeper, staticData } = makeHarness(transport)
    const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)

    await expect(loader.load(request), 'expected the first load to fail').rejects.toThrow()
    const afterFirst = transport.requestCount

    await loader.load(request).catch(() => {})
    const afterSecond = transport.requestCount

    expect(afterSecond, 'the second attempt must actually try again').toBeGreaterThan(afterFirst)
  })
})
