import { describe, expect, it } from 'vitest'
import type { SleeperGameScore } from '@data/gameScore'
import type { LeagueContext } from '@models/league/LeagueContext'
import {
  IDLE_CAP_MS, LIVE_INTERVAL_MS, startLiveUpdates,
  type LiveScheduler, type LiveUpdateServices, type VisibilitySource,
} from '../LivePoller'

/**
 * Web-only tests for the loop that Swift runs as the `LiveUpdates` view
 * modifier (untested in Swift): its delay choice, the paired ticks, and the
 * page-visibility pause that stands in for `scenePhase`.
 */
class ManualScheduler implements LiveScheduler {
  private next = 1
  readonly pending = new Map<number, { ms: number; callback: () => void }>()
  setTimeout(callback: () => void, ms: number) {
    const id = this.next++
    this.pending.set(id, { ms, callback })
    return id
  }
  clearTimeout(handle: unknown) { this.pending.delete(handle as number) }
  delays() { return [...this.pending.values()].map((p) => p.ms) }
  async fire() {
    const entries = [...this.pending.entries()]
    this.pending.clear()
    for (const [, p] of entries) p.callback()
    await new Promise((r) => setTimeout(r, 0))
  }
}

class ManualVisibility implements VisibilitySource {
  visible = true
  private listeners = new Set<() => void>()
  isVisible() { return this.visible }
  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  set(v: boolean) { this.visible = v; for (const l of this.listeners) l() }
}

function fakeServices(context?: Partial<LeagueContext>, games: SleeperGameScore[] = []) {
  const calls = { matchup: 0, gameDay: 0 }
  const services: LiveUpdateServices = {
    matchup: { context: context as LeagueContext | undefined, liveTick: async () => { calls.matchup++; return true } },
    gameDay: { context: context as LeagueContext | undefined, games, tick: async () => { calls.gameDay++; return true } },
  }
  return { services, calls }
}

const context = (kickoffs: number[], now: number): Partial<LeagueContext> => ({
  currentWeek: 3,
  now: () => now,
  kickoffs: { lockWindows: () => kickoffs } as unknown as LeagueContext['kickoffs'],
})

describe('Live updates loop', () => {
  it('with no context yet it waits a minute, then ticks both models together', async () => {
    const scheduler = new ManualScheduler()
    const { services, calls } = fakeServices()
    const stop = startLiveUpdates(services, { scheduler, visibility: new ManualVisibility() })
    expect(scheduler.delays()).toEqual([LIVE_INTERVAL_MS])
    expect(calls).toEqual({ matchup: 0, gameDay: 0 })

    await scheduler.fire()
    expect(calls).toEqual({ matchup: 1, gameDay: 1 })
    expect(scheduler.delays()).toEqual([LIVE_INTERVAL_MS])
    stop()
    expect(scheduler.pending.size).toBe(0)
  })

  it('sleeps on the poller’s schedule when nothing is on', () => {
    const scheduler = new ManualScheduler()
    const now = 1_790_528_400_000
    const { services } = fakeServices(context([now + 10 * 3_600_000], now))
    startLiveUpdates(services, { scheduler, visibility: new ManualVisibility() })
    expect(scheduler.delays()).toEqual([IDLE_CAP_MS])
  })

  it('pauses while the page is hidden and starts over, sleeping first, on return', async () => {
    const scheduler = new ManualScheduler()
    const visibility = new ManualVisibility()
    const { services, calls } = fakeServices()
    startLiveUpdates(services, { scheduler, visibility })

    visibility.set(false)
    expect(scheduler.pending.size).toBe(0)
    await scheduler.fire()
    expect(calls.gameDay).toBe(0)

    visibility.set(true)
    expect(scheduler.delays()).toEqual([LIVE_INTERVAL_MS])
    expect(calls.gameDay, 'no immediate tick on return').toBe(0)
    visibility.set(true)
    expect(scheduler.pending.size, 'a repeated visible event does not start a second loop').toBe(1)
  })

  it('does not start while hidden', () => {
    const scheduler = new ManualScheduler()
    const visibility = new ManualVisibility()
    visibility.visible = false
    const { services } = fakeServices()
    startLiveUpdates(services, { scheduler, visibility })
    expect(scheduler.pending.size).toBe(0)
  })
})
