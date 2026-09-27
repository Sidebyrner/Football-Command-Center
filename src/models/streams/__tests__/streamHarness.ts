/**
 * Spec-local helpers for the stream screen specs: the Swift tests' per-test
 * store directory becomes a fresh in-memory storage, and every model is built
 * on its own harness and loader, as `Harness.make` did.
 */
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { makeHarness, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText } from '../../../../tests/swiftFixtures'
import { MemoryStreamStorage, StreamStore } from '../StreamStore'

export function makeLoader(transport: StubTransport): LeagueContextLoader {
  const { sleeper, staticData } = makeHarness(transport)
  return new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
}

/** `StreamStore(directory: storeDirectory)` — one storage per test, shared by every model in it. */
export function testStore(storage: MemoryStreamStorage): StreamStore {
  return new StreamStore({ directory: 'test-store', storage })
}

/** `transport.on(path, fixture: name)`. */
export function onFixture(transport: StubTransport, path: string, name: string): StubTransport {
  return transport.json(path, fixtureText('FCApp', `${name}.json`))
}
