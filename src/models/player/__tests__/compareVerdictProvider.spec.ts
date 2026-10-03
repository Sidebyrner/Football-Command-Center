import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'
import { ESPNClient } from '@data/ESPNClient'
import { ESPNLeagueService } from '@data/ESPNLeagueService'
import type { LeagueContext } from '@models/league/LeagueContext'
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import { computeVerdict, type VerdictInput, type VerdictLeague } from '@models/player/CompareVerdict'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import { fixtureText } from '../../../../tests/swiftFixtures'

/**
 * Port of CompareVerdictProviderTests.swift: a roster-vs-waiver comparison
 * makes the same call whichever provider the league comes from.
 */
describe('CompareVerdict across providers', () => {
  const league: VerdictLeague = { waivers: { kind: 'faab', budget: 100 }, faabRemaining: 80, teamCount: 0, currentWeek: 3, playoffStartWeek: 15 }

  async function sleeperContext(): Promise<LeagueContext> {
    const { sleeper, staticData } = makeHarness(standardTransport())
    return new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs).load({ leagueID: 'L1', userRosterID: 1, season: 2025 })
  }

  async function espnContext(): Promise<LeagueContext> {
    const transport = standardTransport().json('/leagues/987654', fixtureText('FCData', 'espn-league.json'))
    const { sleeper, staticData } = makeHarness(transport)
    const espn = new ESPNLeagueService({
      client: new ESPNClient({ credentials: undefined, transport, retries: 0 }),
      cache: new Cache(new MemoryStore()),
      season: async () => 2026,
      playerIndex: async () => undefined,
      crosswalk: async () => (await staticData.playerCrosswalk()).value,
    })
    const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs, 60_000, espn, () => 'espn')
    return loader.load({ leagueID: '987654', userRosterID: 1, season: 2026 })
  }

  function expectKeepsAndSwaps(context: LeagueContext) {
    const mineID = context.teams.find((t) => t.isUser)?.roster.find((e) => !e.id.startsWith('espn:'))?.id
    expect(mineID).toBeDefined()
    expect(context.availabilityOf(mineID!)).toEqual({ kind: 'mine' })
    const freeAgentID = 'not-on-any-roster'
    expect(context.availabilityOf(freeAgentID)).toEqual({ kind: 'freeAgent' })
    const input = (id: string, ros: number): VerdictInput => ({
      id, name: id, availability: context.availabilityOf(id), restOfSeason: ros, projectedThisWeek: ros, expectedPointsLast4: ros,
    })
    const keep = computeVerdict([input(mineID!, 14), input(freeAgentID, 9)], league)
    expect(keep.priority.kind).toBe('keep')
    expect(keep.pickID).toBe(mineID)
    const swap = computeVerdict([input(mineID!, 6), input(freeAgentID, 12)], league)
    expect(swap.priority.kind).toBe('spend')
    expect(swap.headline).toBe(`Add ${freeAgentID}, drop ${mineID}`)
  }

  it('Sleeper league', async () => { expectKeepsAndSwaps(await sleeperContext()) })
  it('ESPN league', async () => { expectKeepsAndSwaps(await espnContext()) })
})
