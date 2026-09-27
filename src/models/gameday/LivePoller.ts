/**
 * When to poll during a week of games — a port of FCApp `LivePoller` and its
 * `LiveUpdates` view modifier. One loop drives every live number in the app —
 * Matchup's points and the week's game states — so nothing polls twice, and
 * outside game windows it barely wakes.
 */
import { KickoffCalendar } from '@core/GameClock'
import type { SleeperGameScore } from '@data/gameScore'
import type { LeagueContext } from '@models/league/LeagueContext'

/** While any game may be on (ms). */
export const LIVE_INTERVAL_MS = 60 * 1000
/** The longest it sleeps between checks when nothing is on (ms). */
export const IDLE_CAP_MS = 15 * 60 * 1000
/** Never sooner than this, so a kickoff a second away doesn't spin (ms). */
export const MINIMUM_MS = 30 * 1000

/**
 * Whether a game may be on: a kickoff within its live window (kickoff to four
 * hours after), unless Sleeper already calls every such game final.
 */
export function anyGameLive(kickoffs: number[], games: SleeperGameScore[], now: number): boolean {
  const window = KickoffCalendar.LIVE_WINDOW_MS
  const started = kickoffs.filter((k) => k <= now && now < k + window)
  if (started.length === 0) return games.some((g) => g.status === 'inProgress')
  // Every game that kicked off in the window is final: nothing left live.
  const inWindow = games.filter((g) => g.startTime !== undefined && g.startTime <= now && now < g.startTime + window)
  if (inWindow.length > 0 && inWindow.every((g) => g.status === 'complete')) return false
  return true
}

/**
 * How long to sleep before the next check (ms): a minute while games are on,
 * otherwise until the next kickoff, capped so a changed schedule is noticed.
 */
export function nextDelay(kickoffs: number[], games: SleeperGameScore[], now: number): number {
  if (anyGameLive(kickoffs, games, now)) return LIVE_INTERVAL_MS
  const upcoming = kickoffs.filter((k) => k > now)
  if (upcoming.length === 0) return IDLE_CAP_MS
  const wait = Math.min(...upcoming) - now
  return Math.min(Math.max(wait, MINIMUM_MS), IDLE_CAP_MS)
}

// MARK: - The loop

/**
 * What the loop needs from Swift's `AppServices` (`services.matchup` and
 * `services.gameDay`). `MatchupModel` and `GameDayModel` satisfy these
 * structurally.
 */
export interface LiveMatchupSource {
  readonly context?: LeagueContext
  liveTick(): Promise<boolean>
}

export interface LiveGameDaySource {
  readonly context?: LeagueContext
  readonly games: SleeperGameScore[]
  tick(): Promise<boolean>
}

export interface LiveUpdateServices {
  matchup: LiveMatchupSource
  gameDay: LiveGameDaySource
}

/** A timer, injectable so tests don't wait in real time. */
export interface LiveScheduler {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realScheduler: LiveScheduler = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Swift's `scenePhase == .active`, for a web page: whether the tab is showing. */
export interface VisibilitySource {
  isVisible(): boolean
  /** Calls back whenever visibility may have changed; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/**
 * `document.visibilityState`. Where there is no document (tests, workers) the
 * page counts as always visible.
 */
export const documentVisibility: VisibilitySource = {
  isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  subscribe: (listener) => {
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
}

export interface LiveUpdatesOptions {
  scheduler?: LiveScheduler
  visibility?: VisibilitySource
}

/**
 * Keeps live scores current while the page is showing: one loop for the whole
 * app — start it once, at the root. Paused while the page is hidden; on
 * return it starts over, sleeping first, as Swift's `.task(id: scenePhase)`
 * restarts. Returns a function that stops it.
 */
export function startLiveUpdates(services: LiveUpdateServices, options: LiveUpdatesOptions = {}): () => void {
  const scheduler = options.scheduler ?? realScheduler
  const visibility = options.visibility ?? documentVisibility
  let generation = 0
  let timer: unknown
  let running = false

  const cancel = () => {
    generation += 1
    if (timer !== undefined) scheduler.clearTimeout(timer)
    timer = undefined
    running = false
  }

  const scheduleNext = (gen: number) => {
    const context = services.gameDay.context ?? services.matchup.context
    const delay = context
      ? nextDelay(context.kickoffs.lockWindows(context.currentWeek), services.gameDay.games, context.now())
      : LIVE_INTERVAL_MS
    timer = scheduler.setTimeout(() => {
      timer = undefined
      if (gen !== generation) return
      void Promise.all([
        services.matchup.liveTick().catch(() => false),
        services.gameDay.tick().catch(() => false),
      ]).then(() => {
        if (gen === generation) scheduleNext(gen)
      })
    }, delay)
  }

  const sync = () => {
    const visible = visibility.isVisible()
    if (visible && !running) {
      cancel()
      running = true
      scheduleNext(generation)
    } else if (!visible && running) {
      // Paused in the background; the loop restarts on return.
      cancel()
    }
  }

  const unsubscribe = visibility.subscribe(sync)
  sync()
  return () => {
    unsubscribe()
    cancel()
  }
}
