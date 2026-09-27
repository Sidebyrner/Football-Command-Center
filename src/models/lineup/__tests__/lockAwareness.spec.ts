import { describe, expect, it } from 'vitest'
import { formatCountdown, sleeperTeamLink } from '../../league/GameDayWindow'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { MatchupModel } from '../MatchupModel'
import { SitStartModel } from '../SitStartModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import { MatchupFixture, SitStartFixture } from './lineupFixtures'

/**
 * Port of LockAwarenessTests: lineup locks against week 7 of the real 2025
 * schedule, on Sunday 2025-10-19 at 2:30pm ET. By then the Thursday (CIN),
 * London (LA at JAX) and 1pm games have kicked off; the 4:05, 4:25, Sunday
 * night and Monday games haven't. BUF and BAL are on bye and never lock.
 */
async function sitStart(now: () => number): Promise<SitStartModel> {
  const transport = standardTransport()
    .override('/state/nfl', '{"week":7,"season":"2025","season_type":"regular"}')
    .override('/league/L1/rosters', SitStartFixture.rosters)
    .override('/players/nfl', SitStartFixture.players)
  const { sleeper, staticData } = makeHarness(transport)
  const model = new SitStartModel(new LeagueContextLoader(sleeper, staticData, now))
  await model.load('L1', 1, 2025)
  if (model.errorMessage !== undefined) throw new Error(`load failed: ${model.errorMessage}`)
  return model
}

describe('Lock awareness', () => {
  // MARK: - Sit/Start

  it('locked starters stay put and are never started or sat', async () => {
    const model = await sitStart(TestClock.week7MidSunday)
    const rb = model.lineup.find((s) => s.playerID === '4866')
    expect(rb).toBeDefined()
    expect(rb!.isLocked).toBe(true)
    expect(rb!.changed).toBe(false)

    const touched = new Set([...model.starts.map((c) => c.playerID), ...model.sits.map((c) => c.playerID)])
    expect(touched.has('4866')).toBe(false)
    expect(touched.has('7564')).toBe(false)
    expect(model.lockedStarters, 'Barkley, Chase, the KC tight end, the PHI defense, the CHI linebacker').toBe(5)
  })

  it('a locked bench player is not started', async () => {
    const before = await sitStart(TestClock.beforeKickoffs)
    expect(before.starts.some((c) => c.name === 'Puka Nacua'), 'fixture precondition').toBe(true)

    const during = await sitStart(TestClock.week7MidSunday)
    expect(during.starts.some((c) => c.name === 'Puka Nacua')).toBe(false)
    expect(during.lockedBench).toEqual(['Puka Nacua'])
  })

  it('unlocked moves are still recommended', async () => {
    const model = await sitStart(TestClock.week7MidSunday)
    expect(model.starts.some((c) => c.name === 'Jared Goff')).toBe(true)
    expect(model.sits.some((c) => c.name === 'Josh Allen')).toBe(true)
  })

  /** The next lock is 4:25pm ET, when the DAL receiver and the GB lineman kick off. */
  it('next lock is the next kickoff among starters', async () => {
    const model = await sitStart(TestClock.week7MidSunday)
    const next = model.nextLock
    expect(next).toBeDefined()
    expect(next!.date).toBe(Date.parse('2025-10-19T20:25:00Z'))
    expect(next!.starters).toBe(2)
  })

  it('nothing is locked before kickoffs', async () => {
    const model = await sitStart(TestClock.beforeKickoffs)
    expect(model.lockedStarters).toBe(0)
    expect(model.lockedBench).toEqual([])
    expect(model.lineup.some((s) => s.isLocked)).toBe(false)
  })

  // MARK: - Dashboard

  it.todo('alerts for locked starters are dropped … needs DashboardModel')
  it.todo('dashboard shows the next lineup lock … needs DashboardModel')

  // MARK: - Matchup

  it('matchup rows carry locks', async () => {
    const transport = standardTransport()
      .override('/state/nfl', '{"week":7,"season":"2025","season_type":"regular"}')
      .override('/league/L1/rosters', MatchupFixture.rosters)
      .override('/players/nfl', MatchupFixture.players)
      .override('/matchups/7', MatchupFixture.matchups())
    const { sleeper, staticData } = makeHarness(transport)
    const model = new MatchupModel(new LeagueContextLoader(sleeper, staticData, TestClock.week7MidSunday), sleeper)
    await model.load('L1', 1, 2025)

    const rows = model.mySide?.rows
    expect(rows).toBeDefined()
    expect(rows!.find((r) => r.name === 'Saquon Barkley')?.isLocked).toBe(true)
    expect(rows!.find((r) => r.name === 'Josh Allen')?.isLocked, 'on bye, never locked').toBe(false)
  })

  // MARK: - Formatting and links

  it('countdown formatting', () => {
    expect(formatCountdown(-5)).toBe('now')
    expect(formatCountdown(30)).toBe('<1m')
    expect(formatCountdown(14 * 60)).toBe('14m')
    expect(formatCountdown(2 * 3600 + 14 * 60)).toBe('2h 14m')
    expect(formatCountdown(3 * 3600)).toBe('3h')
    expect(formatCountdown(27 * 3600)).toBe('1d 3h')
  })

  it('Sleeper team link', () => {
    expect(sleeperTeamLink('1234567890')).toBe('https://sleeper.com/leagues/1234567890/team')
  })
})
