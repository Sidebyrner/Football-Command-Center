import { describe, expect, it } from 'vitest'
import { COVERED_BY_WEEKLY_DATA, type Position } from '@core/Position'
import { MINIMUM_GAMES_FOR_LINE, baselineLines, observedFlexDemand, seasonPaceBaselines } from '@core/Baselines'
import { runSeasonScan, type SeasonProfile } from '@core/SeasonProfile'
import { LEAGUE_DEFAULT } from '@core/ScoringProfile'
import { parseSlots } from '@core/RosterSlots'
import { ByeCalendar } from '@core/ByeWeeks'
import { buildTeamNeeds } from '@core/TeamNeeds'
import { LEAGUE_ROSTER_POSITIONS, LEAGUE_TEAM_COUNT, schedule, weekly2025 } from '../../../tests/coreFixtures'

const within = (actual: number | undefined, expected: number, accuracy: number) => {
  expect(actual).toBeDefined()
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(accuracy)
}

const leagueTemplate = parseSlots(LEAGUE_ROSTER_POSITIONS)
let scanned: SeasonProfile[] | undefined
const scan = () => (scanned ??= runSeasonScan(weekly2025(), LEAGUE_DEFAULT))
const baselines = () => seasonPaceBaselines(scan(), leagueTemplate, LEAGUE_TEAM_COUNT)

/** Port of BaselineTests. */
describe('Baselines (season pace)', () => {
  /**
   * The whole point of the season-pace line: exactly N players clear it at a
   * position the league starts N of (§5.7).
   */
  it('lets exactly the started count clear the start line', () => {
    const players = scan()
    const lines = baselines()
    expect(Object.keys(lines).length).toBeGreaterThan(0)
    for (const [position, baseline] of Object.entries(lines)) {
      const clearing = players.filter((p) => p.position === position && p.games >= MINIMUM_GAMES_FOR_LINE && p.pointsPerGame >= baseline!.startLine)
      expect(clearing.length, `${position}: ${clearing.length} clear a line ${baseline!.starters} should`).toBe(baseline!.starters)
    }
  })

  /** The measured numbers on the shipped 2025 file. The brief names 23.9 for QB. */
  it('measures the lines on the shipped file', () => {
    const lines = baselines()
    const qb = lines['QB']
    expect(qb).toBeDefined()
    expect(qb!.starters).toBe(8)
    expect(qb!.pool).toBe(70)
    within(qb!.startLine, 23.9, 0.001)
    within(qb!.replacementLine, 23.34, 0.001)

    expect(lines['RB']?.starters).toBe(16)
    within(lines['RB']?.startLine, 16.08, 0.001)
    expect(lines['WR']?.starters).toBe(16)
    within(lines['WR']?.startLine, 12.84, 0.001)
    expect(lines['TE']?.starters).toBe(8)
    within(lines['TE']?.startLine, 9.99, 0.001)
    expect(lines['K']?.starters).toBe(8)
    within(lines['K']?.startLine, 9.65, 0.001)
  })

  it('sits the start line above replacement', () => {
    for (const [position, baseline] of Object.entries(baselines())) {
      expect(baseline!.replacementLine, `${position} should have a deep enough pool`).toBeDefined()
      expect(baseline!.startLine, position).toBeGreaterThan(baseline!.replacementLine!)
    }
  })

  /** No baseline is invented for a position with no weekly production data (§3.2). */
  it('invents no baseline for positions without data', () => {
    const lines = baselines()
    expect(lines['DEF']).toBeUndefined()
    expect(lines['LB']).toBeUndefined()
    expect(lines['DL']).toBeUndefined()
    expect(lines['DB']).toBeUndefined()
    expect(new Set(Object.keys(lines))).toEqual(new Set(COVERED_BY_WEEKLY_DATA))
  })

  /** Flex slots are excluded from the starter counts on purpose (§5.7). */
  it('does not inflate starter counts with flex slots', () => {
    const lines = baselines()
    expect(lines['RB']?.starters, 'two dedicated RB slots x 8 teams, not three').toBe(16)
    expect(lines['WR']?.starters).toBe(16)
    expect(lines['TE']?.starters).toBe(8)
  })

  /** Below three games a per-game average is an artefact of one hot afternoon. */
  it('excludes tiny samples with the minimum-games guard', () => {
    const players = scan()
    const strict = seasonPaceBaselines(players, leagueTemplate, LEAGUE_TEAM_COUNT, 3)
    const loose = seasonPaceBaselines(players, leagueTemplate, LEAGUE_TEAM_COUNT, 1)
    expect(strict['QB']).toBeDefined()
    expect(loose['QB']).toBeDefined()
    expect(strict['QB']!.pool).toBeGreaterThan(0)
    expect(loose['QB']!.pool, 'a one-game minimum must admit more players').toBeGreaterThan(strict['QB']!.pool)
  })

  /** A shallow pool cannot name an Nth-best player; the line is still defined, with no replacement below it. */
  it('falls back to the worst qualifying player in a shallow pool', () => {
    const players: SeasonProfile[] = [1, 2, 3].map((index) => ({
      gsisID: `p${index}`, name: `P${index}`, position: 'RB', team: 'PHI', games: 10,
      pointsPerGame: 20 - index, weeks: [],
    }))
    const rb = seasonPaceBaselines(players, parseSlots(['RB', 'RB']), 8)['RB']
    expect(rb?.starters).toBe(16)
    expect(rb?.pool).toBe(3)
    expect(rb?.startLine).toBe(17)
    expect(rb?.replacementLine).toBeUndefined()
  })

  it('has no baselines with no teams', () => {
    expect(seasonPaceBaselines(scan(), leagueTemplate, 0)).toEqual({})
  })

  /** The scan covers only what the file covers, and says so by omission. */
  it('scans only the five positions the file carries', () => {
    const players = scan()
    expect(new Set(players.map((p) => p.position))).toEqual(new Set(COVERED_BY_WEEKLY_DATA))
    expect(players).toHaveLength(652)
  })
})

/** Port of FlexDemandTests (TradeFoundationsTests.swift): superflex-aware start lines and flex upgrade needs. */
describe('FlexDemand', () => {
  const template = parseSlots(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'K', 'DEF', 'IDP_FLEX', 'IDP_FLEX', 'BN', 'BN'])
  const lineup = (superflex: Position | undefined, idp: (Position | undefined)[] = ['LB', 'DB']): (Position | undefined)[] =>
    ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', superflex, 'K', 'DEF', ...idp]

  it('derives superflex demand from who managers start', () => {
    const lineups = [...Array.from({ length: 7 }, () => lineup('QB')), lineup('RB')]
    const demand = observedFlexDemand(template, lineups)
    expect(Math.abs((demand['QB'] ?? 0) - 7 / 8)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs((demand['RB'] ?? 0) - 1 / 8)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs((demand['LB'] ?? 0) - 1)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs((demand['DB'] ?? 0) - 1)).toBeLessThanOrEqual(1e-9)
  })

  it('still counts an empty flex slot as demand', () => {
    const demand = observedFlexDemand(template, [lineup('QB'), lineup(undefined)])
    // Three filled flex slots out of six stand for all six.
    expect(Math.abs((demand['QB'] ?? 0) + (demand['LB'] ?? 0) + (demand['DB'] ?? 0) - 3)).toBeLessThanOrEqual(1e-9)
  })

  it('moves the quarterback line down the list in superflex', () => {
    const qbs = Array.from({ length: 20 }, (_, i) => 30 - (i + 1))
    const dedicated = baselineLines({ QB: qbs }, template, 8)
    const flexAware = baselineLines({ QB: qbs }, template, 8, { QB: 1 })
    expect(dedicated['QB']?.starters).toBe(8)
    expect(flexAware['QB']?.starters).toBe(16)
    expect(flexAware['QB']?.startLine).toBe(qbs[15])
    expect(flexAware['QB']?.startLine).toBeDefined()
    expect(dedicated['QB']?.startLine).toBeDefined()
    expect(flexAware['QB']!.startLine).toBeLessThan(dedicated['QB']!.startLine)
  })

  it('makes a weak superflex quarterback a need only when asked', () => {
    const calendar = new ByeCalendar(schedule(2025))
    const roster = [
      { id: 'qb1', position: 'QB' as Position, team: 'BUF' },
      { id: 'qb2', position: 'QB' as Position, team: 'NYJ' },
    ]
    const sfTemplate = parseSlots(['QB', 'SUPER_FLEX', 'BN'])
    const lines = baselineLines({ QB: [25, 22, 20, 18] }, sfTemplate, 2, { QB: 1 })
    const build = (flex: boolean) => buildTeamNeeds({
      roster, starters: ['qb1', 'qb2'], template: sfTemplate,
      values: { qb1: 24, qb2: 12 }, baselines: lines,
      calendar, weeks: [], includeFlexStarters: flex,
    })
    expect(build(false).needs).toEqual([])
    const need = build(true).needs[0]
    expect(need?.viaFlex).toBe(true)
    expect(need?.kind.kind, 'expected a weak superflex starter').toBe('weakStarter')
    if (need?.kind.kind === 'weakStarter') {
      expect(need.kind.playerID).toBe('qb2')
      expect(Math.abs(need.kind.gap - 6)).toBeLessThanOrEqual(1e-9)
    }
  })
})
