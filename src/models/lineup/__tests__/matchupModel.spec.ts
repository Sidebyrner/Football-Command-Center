import { describe, expect, it } from 'vitest'
import { computeDvPFromWeekly, dvpCell } from '@core/DefenseVsPosition'
import { weekLines } from '@core/Schedule'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { averageTeamTotal, defenseSummary, emptySlots, MatchupModel, rowHasProductionData, rowIsEmptySlot, startersOnBye, type MatchupRow } from '../MatchupModel'
import { makeHarness, standardTransport, TestClock, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'
import { MatchupFixture } from './lineupFixtures'

/**
 * Port of MatchupModelTests: Matchup, against week 1 of the real 2025 schedule
 * and weekly file. Josh Allen (BUF, at home to BAL), Saquon Barkley (PHI,
 * hosting DAL at a 28.0 implied total) and Ja'Marr Chase (CIN, at CLE).
 */
function transport(week = 1, userMatchupID = '1'): StubTransport {
  return standardTransport()
    .override('/state/nfl', `{"week":${week},"season":"2025","season_type":"regular"}`)
    .override('/league/L1/rosters', MatchupFixture.rosters)
    .override('/players/nfl', MatchupFixture.players)
    .override(`/matchups/${week}`, MatchupFixture.matchups(userMatchupID))
}

async function loaded(week = 1, userMatchupID = '1'): Promise<MatchupModel> {
  const { sleeper, staticData } = makeHarness(transport(week, userMatchupID))
  const model = new MatchupModel(new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs), sleeper)
  await model.load('L1', 1, 2025)
  if (model.errorMessage !== undefined) throw new Error(`load failed: ${model.errorMessage}`)
  return model
}

function row(model: MatchupModel, name: string): MatchupRow {
  const found = model.mySide?.rows.find((r) => r.name === name)
  expect(found, `no row for ${name}`).toBeDefined()
  return found!
}

const close = (actual: number | undefined, expected: number, accuracy: number) => {
  expect(actual).toBeDefined()
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(accuracy)
}

describe('MatchupModel', () => {
  // MARK: - Shape

  it('both sides are paired', async () => {
    const model = await loaded()

    expect(model.mySide?.manager).toBe('Byrne Notice')
    expect(model.opponentSide?.rosterID).toBe(2)
    expect(model.opponentSide?.manager).toBe('rival')
    expect(model.noOpponentReason).toBeUndefined()
    expect(model.week).toBe(1)
  })

  it('rows follow the slot template', async () => {
    const model = await loaded()
    const rows = model.mySide!.rows
    expect(rows).toBeDefined()

    expect(rows.length).toBe(11)
    expect(rows[0]!.slot).toBe('QB')
    expect(rows[6]!.slot).toBe('FLEX')
    expect(rowIsEmptySlot(rows[6]!)).toBe(true)
    expect(emptySlots(model.mySide!)).toBe(1)
  })

  // MARK: - Per player

  it('opponent and venue come from the schedule', async () => {
    const model = await loaded()

    const allen = row(model, 'Josh Allen')
    expect(allen.opponent).toBe('BAL')
    expect(allen.isHome).toBe(true)

    const chase = row(model, "Ja'Marr Chase")
    expect(chase.opponent).toBe('CLE')
    expect(chase.isHome).toBe(false)
  })

  /** PHI hosted DAL favored by 8.5 with a 47.5 total: 28.0 implied. */
  it("implied total is the player's team", async () => {
    const model = await loaded()
    close(row(model, 'Saquon Barkley').impliedTotal, 28.0, 0.001)
  })

  it('season line is joined from the weekly file', async () => {
    const model = await loaded()
    const season = row(model, 'Josh Allen').season
    expect(season).toBeDefined()

    expect(season!.games).toBeGreaterThan(10)
    expect(season!.pointsPerGame).toBeGreaterThan(10)
    expect(season!.formPointsPerGame).toBeDefined()
    expect(season!.floor).toBeDefined()
    expect(season!.ceiling).toBeDefined()
    expect(season!.floor!).toBeLessThanOrEqual(season!.ceiling!)
  })

  it('defense context is the opponent against the position', async () => {
    const model = await loaded()
    const allen = row(model, 'Josh Allen')
    const context = model.context!
    expect(context).toBeDefined()

    const expected = dvpCell(computeDvPFromWeekly(context.weekly, context.scoring.profile), 'BAL', 'QB')
    expect(allen.defense).toEqual(expected)
    expect(defenseSummary(allen)).toBeDefined()
    expect(defenseSummary(allen)?.includes('BAL') ?? false).toBe(true)
  })

  it('live points are nil, not zero, before kickoff', async () => {
    const model = await loaded()
    expect(row(model, 'Josh Allen').livePoints).toBe(30.5)
    expect(row(model, 'Saquon Barkley').livePoints).toBeUndefined()
    expect(model.mySide?.livePoints).toBe(30.5)
  })

  it('a team defense row states it has no production', async () => {
    const model = await loaded()
    const defense = model.mySide?.rows.find((r) => r.playerID === 'PHI')
    expect(defense).toBeDefined()

    expect(rowHasProductionData(defense!)).toBe(false)
    expect(defense!.season).toBeUndefined()
    expect(defense!.defense).toBeUndefined()
    expect(defense!.opponent).toBe('DAL')
    close(defense!.impliedTotal, 28.0, 0.001)
  })

  it('an unjoinable player is distinct from an uncovered position', async () => {
    const model = await loaded()
    const back = row(model, 'Seattle Back')
    expect(rowHasProductionData(back)).toBe(true)
    expect(back.season).toBeUndefined()
  })

  // MARK: - Lineup environment

  /** Barkley and the PHI defense are one NFL team, counted once. */
  it('lineup environment counts each NFL team once', async () => {
    const model = await loaded()
    const environment = model.mySide!.environment
    const context = model.context!

    const teams = ['BUF', 'PHI', 'SEA', 'CIN', 'DAL', 'KC', 'BAL', 'CHI', 'GB']
    expect(environment.teamCount).toBe(teams.length)

    const lines = weekLines(context.schedule, 1)
    const expected = teams.map((t) => lines[t]?.impliedTotal).filter((x): x is number => x !== undefined).reduce((a, b) => a + b, 0)
    close(environment.total, expected, 0.001)
    expect(environment.missingTeams).toEqual([])
  })

  // MARK: - Byes and no opponent

  it('a starter on bye has no opponent', async () => {
    const model = await loaded(7)
    const allen = row(model, 'Josh Allen')

    expect(allen.onBye).toBe(true)
    expect(allen.opponent).toBeUndefined()
    expect(allen.impliedTotal).toBeUndefined()
    expect(model.mySide ? startersOnBye(model.mySide) : 0).toBeGreaterThan(0)
    expect(model.mySide?.environment.missingTeams.includes('BUF') ?? false).toBe(true)
  })

  it('no opponent is explained rather than blank', async () => {
    const model = await loaded(1, 'null')

    expect(model.mySide).toBeDefined()
    expect(model.opponentSide).toBeUndefined()
    expect(model.noOpponentReason).toBeDefined()
  })

  // MARK: - Modes

  it('opens head-to-head with both lineups paired', async () => {
    const model = await loaded()
    expect(model.mode).toBe('headToHead')
    expect(model.visibleSide, 'no single team in head-to-head').toBeUndefined()

    expect(model.pairedSlots.length).toBe(11)
    expect(model.pairedSlots[0]!.slot).toBe('QB')
    expect(model.pairedSlots[0]!.mine?.name).toBe('Josh Allen')
    expect(model.pairedSlots[0]!.theirs?.name).toBe('Rival QB')
  })

  it('individual modes show one team', async () => {
    const model = await loaded()
    model.mode = 'mine'
    expect(model.visibleSide?.rosterID).toBe(1)
    model.mode = 'opponent'
    expect(model.visibleSide?.rosterID).toBe(2)
  })

  it('all three modes when there is an opponent', async () => {
    const model = await loaded()
    expect(model.availableModes).toEqual(['headToHead', 'mine', 'opponent'])
  })

  it('no opponent page without an opponent', async () => {
    const model = await loaded(1, 'null')
    expect(model.availableModes).toEqual(['headToHead', 'mine'])
  })

  // MARK: - Pairing

  it('a live score switches the basis to live points', async () => {
    const model = await loaded()
    expect(model.comparisonBasis).toBe('livePoints')
  })

  it('a player yet to play makes his slot undecided', async () => {
    const model = await loaded()
    const qb = model.pairedSlots[0]!
    expect(qb.myValue).toBe(30.5)
    expect(qb.theirValue).toBeUndefined()
    expect(qb.leader).toBe('undecided')
  })

  it('an empty slot loses to a fielded player', async () => {
    const model = await loaded()
    const flex = model.pairedSlots[6]!
    expect(flex.mine ? rowIsEmptySlot(flex.mine) : false).toBe(true)
    expect(flex.leader).toBe('theirs')
  })

  // MARK: - Lineup environment

  it('average team total is over teams with a line', async () => {
    const model = await loaded()
    const environment = model.mySide!.environment
    const total = environment.total
    const average = averageTeamTotal(environment)
    expect(total).toBeDefined()
    expect(average).toBeDefined()

    close(average, total! / (environment.teamCount - environment.missingTeams.length), 0.001)
    expect(average!).toBeGreaterThan(10)
    expect(average!, 'a team total, not a sum of nine').toBeLessThan(40)
  })

  it('a failed load names what failed', async () => {
    const transport = new StubTransport()
      .json('/state/nfl', TestLeague.nflState)
      .fail('/league/L1')
    const { sleeper, staticData } = makeHarness(transport)
    const model = new MatchupModel(new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs), sleeper)

    await model.load('L1', 1, 2025)

    expect(model.errorMessage).toBeDefined()
    expect(model.mySide).toBeUndefined()
  })
})
