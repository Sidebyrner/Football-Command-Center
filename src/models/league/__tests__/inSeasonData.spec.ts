import { describe, expect, it } from 'vitest'
import { LeagueContextLoader } from '../LeagueContextLoader'
import { faabRemaining, playoffWeeks } from '../LeagueContext'
import { hasProjections, statWeeks } from '../InSeasonData'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText } from '../../../../tests/swiftFixtures'

const loader = (transport: StubTransport) => {
  const { sleeper, staticData } = makeHarness(transport)
  return new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
}

/**
 * A 2026 league in week 3 with real recorded Sleeper payloads: week-3
 * projections and week-2 stats. Week 1 and the live week are left unscripted
 * on purpose.
 */
function transport2026Week3(): StubTransport {
  return standardTransport()
    .override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
    .replace('/league/L1', `{"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":8,
       "roster_positions":["QB","RB","RB","WR","WR","TE","SUPER_FLEX","K","DEF","IDP_FLEX","IDP_FLEX","BN","BN","IR"],
       "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6,
                           "idp_sack":5,"idp_tkl":0,"pts_allow_0":12,"fum_lost":-5},
       "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2,"trade_deadline":11,
                   "playoff_week_start":15,"playoff_teams":6,"reserve_slots":2}}`)
    .replace('/league/L1/rosters', `[{"roster_id":1,"owner_id":"u1","players":["9221","9488","qb1"],"starters":["qb1","9221","0"],
        "settings":{"wins":0,"losses":2,"waiver_budget_used":35,"waiver_position":2}},
       {"roster_id":2,"owner_id":"u2","players":["qb2"],"starters":["qb2"]}]`)
    .replace('/players/nfl', `{"9221":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
       "9488":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
       "qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
       "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
       "JAX":{"position":"DEF","team":"JAX","active":true}}`)
    .json('/projections/nfl/2026/3', fixtureText('FCApp', 'projections-2026-w3.json'))
    .json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
}

/** Port of InSeasonDataTests: in-season sources join when reachable; absence is a labelled fact. */
describe('InSeasonData', () => {
  it('projections and Sleeper stats join the context', async () => {
    const context = await loader(transport2026Week3()).load({ leagueID: 'L1', userRosterID: 1 })

    expect(hasProjections(context.inSeason)).toBe(true)
    expect(context.inSeason.projectionSourceLabel).toBe('Rotowire via Sleeper')
    const gibbs = context.projectedPoints('9221')
    expect(gibbs).toBeDefined()
    expect(gibbs!).toBeGreaterThan(10)

    // week 1 and the live week 3 were unscripted
    expect(statWeeks(context.inSeason)).toEqual([2])
    const jsn = context.sleeperPointsPerGame('9488')
    expect(jsn).toBeDefined()
    // 155 receiving yards at 0.1 plus three touchdowns at 6 under the fixture's rules.
    expect(jsn!).toBeCloseTo(33.5, 2)

    // Never zero, never invented: a player with no line has no number.
    expect(context.projectedPoints('qb1')).toBeUndefined()
    expect(context.sleeperPointsPerGame('qb1')).toBeUndefined()
  })

  it('DEF and IDP coverage comes from Sleeper stats', async () => {
    const context = await loader(transport2026Week3()).load({ leagueID: 'L1', userRosterID: 1 })

    expect(context.coverage('RB')).toBe('nflverseWeekly')
    expect(context.coverage('DEF')).toBe('sleeperStats')
    expect(context.coverage('LB')).toBe('sleeperStats')
    expect(context.sleeperPointsPerGame('JAX')).toBeDefined()
  })

  it('league facts are read live', async () => {
    const context = await loader(transport2026Week3()).load({ leagueID: 'L1', userRosterID: 1 })
    const facts = context.leagueFacts

    expect(facts.waivers).toEqual({ kind: 'faab', budget: 100 })
    expect(faabRemaining(facts)).toBe(65)
    expect(facts.waiverPosition).toBe(2)
    expect(facts.tradeDeadlineWeek).toBe(11)
    expect(playoffWeeks(facts)).toEqual([15, 16, 17])
    expect(facts.irSlots).toBe(2)
    expect(facts.teamCount).toBe(8)
    // the SUPER_FLEX slot parses as a QB-eligible flex
    expect(context.template.starters.some((s) => s.eligible.has('QB') && s.dedicated === undefined)).toBe(true)
  })

  /** Fail-soft: with none of the insight routes or files reachable, the league still loads. */
  it('absent sources are named and nothing fails', async () => {
    const context = await loader(standardTransport()).load({ leagueID: 'L1', userRosterID: 1 })

    expect(hasProjections(context.inSeason)).toBe(false)
    expect(context.inSeason.weekStats.size).toBe(0)
    expect(context.inSeason.unavailable).toContain('Rotowire projections via Sleeper')
    expect(context.inSeason.unavailable).toContain('depth charts')
    expect(context.inSeason.unavailable.some((s) => s.startsWith('Sleeper stats for week'))).toBe(true)
    expect(context.coverage('DEF')).toBe('none')
    expect(context.leagueFacts.waivers).toEqual({ kind: 'unknown' })
  })
})
