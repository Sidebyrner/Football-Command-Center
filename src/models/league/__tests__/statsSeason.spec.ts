import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'
import { StaticDataStore } from '@data/StaticDataStore'
import { ByeCalendar } from '@core/ByeWeeks'
import { decodeSchedule } from '@core/Schedule'
import { LeagueContextLoader } from '../LeagueContextLoader'
import type { LeagueContext } from '../LeagueContext'
import { appFixtureBundle, makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { readFixture } from '../../../../tests/swiftFixtures'

const transport2026 = () => standardTransport().override('/state/nfl', '{"week":2,"season":"2026","season_type":"regular"}')

const loader = (transport: StubTransport) => {
  const { sleeper, staticData } = makeHarness(transport)
  return new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
}

/**
 * Port of StatsSeasonTests. Regression: a league in the *current* season must
 * load even though its weekly production file doesn't exist yet.
 */
describe('StatsSeason', () => {
  it('a current-season league loads without its own weekly file', async () => {
    const context = await loader(transport2026()).load({ leagueID: 'L1', userRosterID: 1 })

    expect(context.scheduleSeason).toBe(2026)
    expect(context.statsSeason, 'newest season the manifest lists').toBe(2025)
    expect(context.seasonProfiles.length).toBeGreaterThan(0)
  })

  /** Byes and opponents come from this season's schedule; production from last season's. */
  it("byes come from the current season's schedule", async () => {
    const context = await loader(transport2026()).load({ leagueID: 'L1', userRosterID: 1 })
    const schedule2026 = decodeSchedule(readFixture('FCApp', 'schedule-2026.json'))
    expect(context.byeCalendar).toEqual(new ByeCalendar(schedule2026))
  })

  /** Last year's points per game must never read as this year's (§6). */
  it('the season mismatch is stated', async () => {
    const context = await loader(transport2026()).load({ leagueID: 'L1', userRosterID: 1 })
    const note = context.statsSeasonNote
    expect(note).toBeDefined()
    expect(note!).toContain('2025')
    expect(note!).toContain('2026')
  })

  it('no note when the seasons match', async () => {
    const context = await loader(standardTransport()).load({ leagueID: 'L1', userRosterID: 1, season: 2025 })
    expect(context.statsSeason).toBe(2025)
    expect(context.statsSeasonNote).toBeUndefined()
  })
})

const manifest = (weeks2026: number) => `{"_meta":{"generated":"2026-10-01T00:00:00Z"},"seasons":[
  {"season":2026,"file":"/data/weekly/2026.json","weeks":${weeks2026},"latestWeek":${weeks2026},"complete":false},
  {"season":2025,"file":"/data/weekly/2025.json","weeks":18,"latestWeek":18,"complete":true}]}`

/** A tiny but valid 2026 weekly file: one quarterback, a few weeks. */
function weekly2026(weeks: number): string {
  const rows = Array.from({ length: Math.max(1, weeks) }, (_, i) => `[${i + 1},"BUF","BAL",250,2]`).join(',')
  return `{"fields":["week","team","opp","pass_yd","pass_td"],
   "meta":{"00-0034857":{"n":"Josh Allen","p":"QB"}},
   "players":{"00-0034857":[${rows}]}}`
}

/** The static store pointed at a stubbed data host that publishes a 2026 weekly file. */
function remoteLoader(transport: StubTransport): LeagueContextLoader {
  const { sleeper } = makeHarness(transport)
  const staticData = new StaticDataStore({
    cache: new Cache(new MemoryStore()),
    transport,
    baseURL: 'https://data.example.test/',
    bundled: appFixtureBundle,
  })
  return new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
}

async function contextWith(weeks2026: number): Promise<LeagueContext> {
  const transport = standardTransport()
    .override('/state/nfl', '{"week":4,"season":"2026","season_type":"regular"}')
    .json('weekly/index.json', manifest(weeks2026))
    .json('weekly/2026.json', weekly2026(weeks2026))
  return remoteLoader(transport).load({ leagueID: 'L1', userRosterID: 1 })
}

/** Port of StatsSeasonThresholdTests: the three-week rule. */
describe('StatsSeason threshold', () => {
  it('two weeks is not enough to switch', async () => {
    const context = await contextWith(2)
    expect(context.scheduleSeason).toBe(2026)
    expect(context.statsSeason).toBe(2025)
    expect(context.currentSeasonWeeks).toBe(2)

    const note = context.statsSeasonNote
    expect(note).toBeDefined()
    expect(note!, note).toContain('until 2026 has 3 weeks')
    expect(note!, note).toContain('it has 2')
  })

  it('three weeks switches to the current season', async () => {
    const context = await contextWith(3)
    expect(context.statsSeason).toBe(2026)
    expect(context.statsSeasonNote).toBeUndefined()
    expect(context.seasonProfiles[0]?.name).toBe('Josh Allen')
  })

  /** The current season's file isn't bundled, so it can only have come from the data host. */
  it('the current season is downloaded from the data host', async () => {
    const transport = standardTransport()
      .override('/state/nfl', '{"week":6,"season":"2026","season_type":"regular"}')
      .json('weekly/index.json', manifest(5))
      .json('weekly/2026.json', weekly2026(5))
    const context = await remoteLoader(transport).load({ leagueID: 'L1', userRosterID: 1 })

    expect(context.statsSeason).toBe(2026)
    const paths = transport.requestedPaths()
    expect(paths).toContain('/weekly/2026.json')
    expect(paths).toContain('/weekly/index.json')
  })
})
