import { describe, expect, it } from 'vitest'
import { KickoffCalendar } from '@core/GameClock'
import { decodeSchedule } from '@core/Schedule'
import { CacheTTL } from '@data/cache'
import { SleeperCacheKey } from '@data/SleeperService'
import { isGameDayActive, playerIndexMaxAge } from '../../league/GameDayWindow'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { leftToPlay, MatchupModel } from '../../lineup/MatchupModel'
import { MatchupFixture } from '../../lineup/__tests__/lineupFixtures'
import { LineupAlertKind } from '../DashboardModel'
import { dashboardTransport, makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { readFixture } from '../../../../tests/swiftFixtures'
import { makeDashboard } from './dashboardHarness'

/**
 * Port of GameDayFreshnessTests: game-day freshness and live matchups, against
 * week 7 of the real 2025 schedule — Thursday 8:15pm ET (CIN), Sunday 9:30am
 * ET London, 1pm, 4:05, 4:25, Sunday night, and two Monday games.
 */
const at = (iso: string) => {
  const date = Date.parse(iso)
  return () => date
}

const kickoffs = () => new KickoffCalendar(decodeSchedule(readFixture('FCApp', 'schedule-2025.json')))

const WEEK7_STATE = '{"week":7,"season":"2025","season_type":"regular"}'

/**
 * A four-hour-old player index — and its injury tags — is kept midweek but
 * replaced on Sunday afternoon.
 */
async function playerDownloads(now: () => number): Promise<number> {
  const transport = standardTransport().override('/state/nfl', WEEK7_STATE)
  const { sleeper, staticData } = makeHarness(transport)
  const loader = new LeagueContextLoader(sleeper, staticData, now)

  await loader.load({ leagueID: 'L1', userRosterID: 1, season: 2025 })

  // Age the cached index by four hours.
  const hit = await sleeper.cache.load(SleeperCacheKey.players, { allowingStale: true })
  expect(hit).toBeDefined()
  await sleeper.cache.store(hit!.value, SleeperCacheKey.players, CacheTTL.players, Date.now() - 4 * 60 * 60 * 1000)

  await loader.load({ leagueID: 'L1', userRosterID: 1, season: 2025, force: true })
  return transport.requestedPaths().filter((p) => p.endsWith('/players/nfl')).length
}

async function matchup(now: () => number): Promise<{ model: MatchupModel; transport: StubTransport }> {
  const transport = standardTransport()
    .override('/state/nfl', WEEK7_STATE)
    .override('/league/L1/rosters', MatchupFixture.rosters)
    .override('/players/nfl', MatchupFixture.players)
    .override('/matchups/7', MatchupFixture.matchups())
  const { sleeper, staticData } = makeHarness(transport)
  const model = new MatchupModel(new LeagueContextLoader(sleeper, staticData, now), sleeper)
  await model.load('L1', 1, 2025)
  if (model.errorMessage !== undefined) throw new Error(`load failed: ${model.errorMessage}`)
  return { model, transport }
}

describe('Game-day freshness', () => {
  // MARK: - The window

  it('the window opens six hours before a kickoff', () => {
    const calendar = kickoffs()
    // Sunday 4:00am ET: 5.5h before London's 9:30 kickoff.
    expect(isGameDayActive(calendar, 7, at('2025-10-19T08:00:00Z')())).toBe(true)
    // Sunday 3:00am ET: 6.5h before — not yet.
    expect(isGameDayActive(calendar, 7, at('2025-10-19T07:00:00Z')())).toBe(false)
  })

  it('the window closes four hours after a kickoff', () => {
    const calendar = kickoffs()
    // Friday 12:00am ET: 3h45m after Thursday's 8:15pm kickoff.
    expect(isGameDayActive(calendar, 7, at('2025-10-17T04:00:00Z')())).toBe(true)
    // Friday 1:00am ET: 4h45m after — closed.
    expect(isGameDayActive(calendar, 7, at('2025-10-17T05:00:00Z')())).toBe(false)
  })

  it('midweek is not a game day', () => {
    const calendar = kickoffs()
    expect(isGameDayActive(calendar, 7, at('2025-10-15T16:00:00Z')())).toBe(false)
    expect(playerIndexMaxAge(calendar, 7, at('2025-10-15T16:00:00Z')())).toBe(CacheTTL.players)
    expect(playerIndexMaxAge(calendar, 7, TestClock.week7MidSunday())).toBe(3 * 60 * 60)
  })

  // MARK: - The loader honours it

  it('the loader keeps an older index midweek', async () => {
    expect(await playerDownloads(at('2025-10-15T16:00:00Z'))).toBe(1)
  })

  it('the loader replaces an older index on game day', async () => {
    expect(await playerDownloads(TestClock.week7MidSunday)).toBe(2)
  })

  // MARK: - Live matchup

  /**
   * Mid-Sunday the 1pm games are on: a tick re-reads the matchups, stamps the
   * update, and reuses the defense table rather than recomputing it.
   */
  it('a live tick during games refreshes scores', async () => {
    const { model, transport } = await matchup(TestClock.week7MidSunday)
    expect(model.anyGameLive).toBe(true)
    const before = transport.requestedPaths().filter((p) => p.endsWith('/matchups/7')).length

    const polled = await model.liveTick()

    const after = transport.requestedPaths().filter((p) => p.endsWith('/matchups/7')).length
    expect(polled).toBe(true)
    expect(after).toBe(before + 1)
    expect(model.lastLiveUpdate).toBeDefined()
    expect(model.defenseTableBuilds, 'the defense table is computed once per load').toBe(1)
  })

  /** Midweek nothing is on, so a tick costs nothing at all. */
  it('a live tick outside games does nothing', async () => {
    const { model, transport } = await matchup(at('2025-10-15T16:00:00Z'))
    expect(model.anyGameLive).toBe(false)
    const before = transport.requestCount

    const polled = await model.liveTick()

    expect(polled).toBe(false)
    expect(transport.requestCount).toBe(before)
    expect(model.lastLiveUpdate).toBeUndefined()
  })

  /**
   * At 2:30pm Sunday: Barkley (1pm) and Chase (Thursday) are playing or done,
   * Allen and the BAL kicker are on bye, the flex is empty — which leaves the
   * SEA back (Monday), the DAL receiver (4:25) and the GB lineman (4:25).
   */
  it('left to play counts only starters yet to kick off', async () => {
    const { model } = await matchup(TestClock.week7MidSunday)
    expect(model.mySide && leftToPlay(model.mySide)).toBe(3)
    expect(model.mySide?.rows.find((r) => r.name === 'Saquon Barkley')?.isLive).toBe(true)
    expect(model.mySide?.rows.find((r) => r.name === 'Receiver Two')?.kickoff).toBeDefined()
  })

  // MARK: - Dashboard

  it('injury alerts say how old the tag is', async () => {
    const model = makeDashboard(dashboardTransport())
    await model.load('L1', 1, 2025)

    const injured = model.alerts.find((a) => a.kind === LineupAlertKind.injured)
    expect(injured).toBeDefined()
    expect(injured!.asOf).toBeDefined()
    expect(model.alerts.find((a) => a.kind === LineupAlertKind.onBye)?.asOf, 'only injury tags age').toBeUndefined()
  })

  it('this week card counts left to play', async () => {
    const transport = dashboardTransport().override('/matchups/7', `
        [{"roster_id":1,"matchup_id":1,"points":40.0,
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","0","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"matchup_id":1,"points":30.0,
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]`)
    const model = makeDashboard(transport, { now: TestClock.week7MidSunday })
    await model.load('L1', 1, 2025)
    const week = model.thisWeek
    expect(week).toBeDefined()

    // Mine: rb_sea (Mon), wr2 (DAL 4:25), dl1 (GB 4:25).
    expect(week!.myLeftToPlay).toBe(3)
    expect(week!.opponentLeftToPlay).toBeDefined()
  })
})
