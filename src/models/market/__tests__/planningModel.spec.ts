import { describe, expect, it } from 'vitest'
import { isFeasible } from '@core/ByeCrunch'
import { totalStarterSlots } from '@core/RosterSlots'
import { availabilityLabel } from '../../league/LeagueContext'
import { LeagueContextLoader } from '../../league/LeagueContextLoader'
import { PlanningModel } from '../PlanningModel'
import { makeHarness, standardTransport, TestClock, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'

/**
 * Port of PlanningModelTests: the Planning screen, built against the real 2025
 * schedule and weekly files. LAR and SEA really are on bye in week 8 of the
 * shipped schedule, which is what makes the user's shortfall a derived fact.
 */
async function loadedModel(): Promise<PlanningModel> {
  const { sleeper, staticData } = makeHarness(standardTransport())
  const model = new PlanningModel(new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs))
  await model.load('L1', 1, 2025)
  // Swift throws XCTSkip here; a failed load fails the test instead, so it can't pass silently.
  if (model.errorMessage) throw new Error(`load failed: ${model.errorMessage}`)
  return model
}

function unwrap<T>(value: T | undefined | null): T {
  expect(value).toBeDefined()
  expect(value).not.toBeNull()
  return value as T
}

describe('PlanningModel', () => {
  it('loads a league context', async () => {
    const model = await loadedModel()
    const context = unwrap(model.context)

    expect(context.teams.length).toBe(2)
    expect(context.userRosterID).toBe(1)
    expect(totalStarterSlots(context.template)).toBe(11)
    expect(context.template.benchCount).toBe(5)
  })

  /** Scoring comes from the league's own settings, never hardcoded (§1). */
  it('scoring comes from the league', async () => {
    const model = await loadedModel()
    const context = unwrap(model.context)

    expect(context.scoring.profile.source).toBe('sleeper')
    expect(context.scoring.profile.passingTD).toBe(6)
    expect(context.scoring.profile.receptionPoints, 'this league is not PPR').toBe(0)
  })

  /** The manager's own team name wins over their display name. */
  it('teams are named by their managers', async () => {
    const model = await loadedModel()
    const context = unwrap(model.context)

    expect(context.userTeam?.manager).toBe('Byrne Notice')
    expect(context.rivals[0]?.manager).toBe('rival')
  })

  // MARK: - The grid

  it('grid covers every team and remaining week', async () => {
    const model = await loadedModel()
    const context = unwrap(model.context)

    expect(model.grid.length).toBe(context.teams.length * context.remainingWeeks.length)
  })

  /** Week 8 byes in the shipped 2025 file are ARI, DET, JAX, LA, LV, SEA. */
  it('the user is short at running back in week eight', async () => {
    const model = await loadedModel()
    const week8 = unwrap(model.cell(1, 8))

    expect(week8.isShort).toBe(true)
    expect(week8.shortPositions).toContain('RB')
    expect(week8.report.byPosition.RB?.shortfall).toBe(2)
  })

  /** `LAR` on Sleeper is `LA` in the schedule file (§5.6). */
  it('the Rams back is recognised as on bye despite the spelling', async () => {
    const model = await loadedModel()
    const week8 = unwrap(model.cell(1, 8))

    expect(week8.report.onBye.some((e) => e.id === 'rb_la')).toBe(true)
    expect(week8.report.onBye.some((e) => e.id === 'rb_sea')).toBe(true)
  })

  /** A full roster with nobody on bye fields a legal lineup. */
  it('a week with no byes is feasible', async () => {
    const model = await loadedModel()
    const week1 = unwrap(model.cell(1, 1))

    expect(week1.isShort).toBe(false)
    expect(isFeasible(week1.report)).toBe(true)
  })

  it('short weeks are surfaced for the user', async () => {
    const model = await loadedModel()
    const short = model.userShortWeeks()

    expect(short.some((c) => c.week === 8)).toBe(true)
    expect(short.every((c) => c.isShort)).toBe(true)
  })

  /** The trade you want is with someone who is not short the same week (§7.4). */
  it('trade partners are rivals who are not short that week', async () => {
    const model = await loadedModel()
    const partners = model.tradePartners(8)

    expect(partners.map((t) => t.rosterID)).toEqual([2])
    expect(model.cell(2, 8)?.isShort ?? true).toBe(false)
  })

  // MARK: - The board and the link between the halves

  it('the board is ranked by value over the start line', async () => {
    const model = await loadedModel()
    expect(model.board.length === 0).toBe(false)

    const values = model.board.map((r) => r.valueOverStartLine)
    expect(values).toEqual([...values].sort((a, b) => b - a))
  })

  it('every board row carries at least one named signal', async () => {
    const model = await loadedModel()
    expect(model.board.every((r) => r.signals.length > 0)).toBe(true)
  })

  /** Selecting a shortfall filters the board to players who can actually play that week. */
  it('selecting a week excludes players on bye that week', async () => {
    const model = await loadedModel()
    const unfiltered = model.board.length

    model.selectedWeek = 8

    const week8Byes = new Set(['ARI', 'DET', 'JAX', 'LA', 'LV', 'SEA'])
    expect(
      model.board.every((r) => !week8Byes.has(r.team ?? '')),
      'a player on bye in week 8 cannot fill a week 8 hole',
    ).toBe(true)
    expect(model.board.length, 'the filter must actually remove someone').toBeLessThan(unfiltered)
  })

  it('clearing the week restores the full board', async () => {
    const model = await loadedModel()
    const unfiltered = model.board.length

    model.selectedWeek = 8
    model.selectedWeek = undefined

    expect(model.board.length).toBe(unfiltered)
  })

  /** The board is about who to *get*, so the user's own players are out by default — but the toggle is real. */
  it('own players can be included', async () => {
    const model = await loadedModel()
    expect(model.board.every((r) => r.availability.kind !== 'mine')).toBe(true)

    model.excludeOwnPlayers = false
    expect(model.board.length === 0).toBe(false)
  })

  /** Availability names the kind of move, because a claim and a trade are not the same ask. */
  it('availability is stated for every row', async () => {
    const model = await loadedModel()
    expect(model.board.every((r) => availabilityLabel(r.availability).length > 0)).toBe(true)
  })

  // MARK: - Coverage

  /** DEF and IDP are 3 of this league's 11 starting slots and the weekly file has nothing for them (§3.2). */
  it('the coverage gap is stated rather than hidden', async () => {
    const model = await loadedModel()
    const context = unwrap(model.context)

    expect(context.unsupportedPositions).toContain('DEF')
    expect(context.unsupportedPositions).toContain('LB')

    const warning = unwrap(model.coverageWarning)
    expect(warning.includes('DEF')).toBe(true)
    expect(
      warning.toLowerCase().includes('bye'),
      'the warning must say byes still work — they come from the schedule',
    ).toBe(true)
  })

  /** Bye derivation covers all positions because it needs no production data. */
  it('byes still cover positions with no production data', async () => {
    const model = await loadedModel()
    unwrap(model.context)

    // PHI is the user's DEF and is on bye in week 9 in the shipped file.
    const week9 = unwrap(model.cell(1, 9))
    expect(week9.report.onBye.some((e) => e.id === 'PHI')).toBe(true)
  })

  // MARK: - Provenance

  /** The screen is only as fresh as its oldest part; bundled static files make it bundled. */
  it('provenance is the weakest of everything that went into it', async () => {
    const model = await loadedModel()
    const context = unwrap(model.context)

    expect(context.provenance).toEqual({ kind: 'bundled' })
    expect(model.freshnessLabel).toBeDefined()
  })

  /** A failure names what went wrong instead of an empty screen. */
  it('a failed load reports what failed', async () => {
    const transport = new StubTransport()
      .json('/state/nfl', TestLeague.nflState)
      .fail('/league/L1')
    const { sleeper, staticData } = makeHarness(transport)

    const model = new PlanningModel(new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs))
    await model.load('L1', 1, 2025)

    expect(model.errorMessage).toBeDefined()
    expect(model.context).toBeUndefined()
    expect(model.board.length === 0).toBe(true)
  })
})
