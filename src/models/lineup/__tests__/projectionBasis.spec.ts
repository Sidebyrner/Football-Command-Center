import { describe, expect, it } from 'vitest'
import { isValued } from '@core/CommandCenterProjection'
import { dvpCovers } from '@core/DefenseVsPosition'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { DefenseLookup } from '../../player/DefenseLookup'
import { MatchupModel } from '../MatchupModel'
import { SitStartModel } from '../SitStartModel'
import { makeHarness, standardTransport, TestClock } from '../../../../tests/appHarness'
import type { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText, readFixture } from '../../../../tests/swiftFixtures'

/**
 * Port of ProjectionBasisTests: the three forward-looking bases on Sit/Start
 * and the matchup row's new columns, against recorded 2026 Sleeper payloads.
 * Jahmyr Gibbs and Jaxon Smith-Njigba start with the Jaguars defense; a
 * linebacker with a recorded line is on the bench.
 */
const gibbs = '9221'
const smithNjigba = '9488'
const jaguars = 'JAX'

interface Line {
  player_id: string
  team?: string | null
  stats: Record<string, number | null>
  player?: { first_name?: string | null; last_name?: string | null; position?: string | null } | null
}

/** A linebacker from the week-2 fixture with an `idp_tkl` line. */
function linebacker(): { id: string; name: string; team: string } {
  const lines = readFixture<Line[]>('FCApp', 'stats-2026-w2.json')
  const lb = lines.find((l) => l.player?.position === 'LB' && (l.stats.idp_tkl ?? 0) > 0 && l.team != null)
  expect(lb).toBeDefined()
  return {
    id: lb!.player_id,
    name: [lb!.player?.first_name, lb!.player?.last_name].filter((x): x is string => x != null).join(' '),
    team: lb!.team!,
  }
}

function transport(): StubTransport {
  const lb = linebacker()
  return standardTransport()
    .override('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
    .replace('/league/L1', `{"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["RB","WR","DEF","IDP_FLEX","BN","BN"],
             "scoring_settings":{"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6,"idp_tkl":1,"idp_sack":5,
                                 "pts_allow_0":12,"pts_allow_1_6":9,"pts_allow_7_13":6,"pts_allow_14_20":3,"sack":1,"int":3}}`)
    .replace('/league/L1/rosters', `[{"roster_id":1,"owner_id":"u1",
              "players":["${gibbs}","${smithNjigba}","${jaguars}","${lb.id}","wr_bench"],
              "starters":["${gibbs}","${smithNjigba}","${jaguars}","0"]},
             {"roster_id":2,"owner_id":"u2","players":["rb2","wr2"],"starters":["rb2","wr2","0","0"]}]`)
    .replace('/players/nfl', `{"${gibbs}":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "${smithNjigba}":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "${jaguars}":{"position":"DEF","team":"JAX","active":true},
             "${lb.id}":{"full_name":"${lb.name}","position":"LB","team":"${lb.team}","active":true},
             "wr_bench":{"full_name":"Bench Receiver","position":"WR","team":"NE","active":true},
             "rb2":{"full_name":"Rival Back","position":"RB","team":"KC","active":true},
             "wr2":{"full_name":"Rival Receiver","position":"WR","team":"NYJ","active":true}}`)
    .override('/matchups/3', `[{"roster_id":1,"matchup_id":1,"starters":["${gibbs}","${smithNjigba}","${jaguars}","0"]},
             {"roster_id":2,"matchup_id":1,"starters":["rb2","wr2","0","0"]}]`)
    .json('/projections/nfl/2026/3', fixtureText('FCApp', 'projections-2026-w3.json'))
    .json('/stats/nfl/2026/1', fixtureText('FCApp', 'stats-2026-w2.json'))
    .json('/stats/nfl/2026/2', fixtureText('FCApp', 'stats-2026-w2.json'))
}

function harness(t: StubTransport) {
  const { sleeper, staticData } = makeHarness(t)
  return { sleeper, loader: new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs) }
}

describe('Projection bases', () => {
  it('projected basis values every position including defense', async () => {
    const { loader } = harness(transport())
    const model = new SitStartModel(loader)
    await model.load('L1', 1)
    expect(model.errorMessage).toBeUndefined()

    model.basis = 'projected'
    expect(model.projectionSourceLabel).toBe('Rotowire via Sleeper')
    const lineup = model.lineup
    const defense = lineup.find((s) => s.slot === 'DEF')
    expect(defense).toBeDefined()
    expect(defense!.value, 'the DEF slot is valued on the projected basis').toBeDefined()
    expect(defense!.keptBecauseUnvalued).toBe(false)
    const back = lineup.find((s) => s.slot === 'RB')
    expect(back?.value).toBeDefined()
    expect(back!.value!).toBeGreaterThan(10)
    // The bench receiver has no projection: left out by name, never zero.
    expect(model.unranked.noProjection).toContain('Bench Receiver')
    expect(model.unranked.noProductionData).toEqual([])
  })

  it('this-season basis values defense and IDP from Sleeper lines', async () => {
    const lb = linebacker()
    const { loader } = harness(transport())
    const model = new SitStartModel(loader)
    await model.load('L1', 1)

    model.basis = 'thisSeason'
    const idp = model.lineup.find((s) => s.slot === 'IDP_FLEX')
    expect(idp).toBeDefined()
    expect(idp!.playerID, 'the empty IDP slot is filled from the bench because the linebacker now has a value').toBe(lb.id)
    expect(idp!.value).toBeDefined()
    const defense = model.lineup.find((s) => s.slot === 'DEF')
    expect(defense?.value).toBeDefined()
    expect(model.unranked.noSleeperLine).toContain('Bench Receiver')
  })

  it('Command Center basis is its own number with factors', async () => {
    const { loader } = harness(transport())
    const model = new SitStartModel(loader)
    await model.load('L1', 1)

    model.basis = 'commandCenter'
    const projection = model.commandCenterProjection(gibbs)
    expect(projection).toBeDefined()
    expect(isValued(projection!)).toBe(true)
    expect(projection!.factors.map((f) => f.name).slice(0, 3)).toEqual(['Pace', 'Usage', 'Matchup'])
    // This season (one recorded game) regressed toward last season's line.
    expect(projection!.factors[0]!.detail.includes('last season')).toBe(true)
    const back = model.lineup.find((s) => s.slot === 'RB')
    expect(back).toBeDefined()
    expect(back!.value).toBe(projection!.weekly)
    // Never the same number as Rotowire's: a separate claim.
    expect(back!.value).not.toBe(model.context?.projectedPoints(gibbs))
  })

  it('matchup rows carry projection and this-season line', async () => {
    const { sleeper, loader } = harness(transport())
    const model = new MatchupModel(loader, sleeper)
    await model.load('L1', 1)
    expect(model.errorMessage).toBeUndefined()

    const mine = model.mySide
    expect(mine).toBeDefined()
    const defense = mine!.rows.find((r) => r.slot === 'DEF')
    expect(defense).toBeDefined()
    expect(defense!.projected).toBeDefined()
    expect(defense!.thisSeason, 'DEF has a this-season line from Sleeper').toBeDefined()
    expect(defense!.season, 'and still no nflverse line — different claims').toBeUndefined()
    const back = mine!.rows.find((r) => r.slot === 'RB')
    expect(back).toBeDefined()
    expect(back!.projected).toBeDefined()
    expect(back!.defenseSource).toEqual({ kind: 'nflverse', season: 2025 })
  })

  /** The Sleeper-based defense table covers IDP once lines exist, even before any defense has four games. */
  it('defense lookup covers IDP from Sleeper lines', async () => {
    const { loader } = harness(transport())
    const context = await loader.load({ leagueID: 'L1', userRosterID: 1 })
    const lookup = DefenseLookup.build(context)
    expect(lookup.source('WR')).toEqual({ kind: 'nflverse', season: 2025 })
    expect(lookup.source('LB')).toEqual({ kind: 'sleeper', season: 2026 })
    expect(lookup.source('DEF')).toBeUndefined()
    expect(dvpCovers(lookup.sleeper, 'LB')).toBe(true)
    expect(lookup.sleeper.ranked.LB?.[0], 'one recorded week cannot rank anyone').toBeUndefined()
  })
})
