import { describe, expect, it } from 'vitest'
import type { Position } from '@core/Position'
import {
  computeDvP, computeDvPFromWeekly, defenseCount, dvpCell, dvpCovers, facing, type DefenseFacing, type DefenseVsPositionTable,
} from '@core/DefenseVsPosition'
import { WeeklyFile } from '@core/WeeklyStats'
import { scoreWeek } from '@core/ScoringEngine'
import { LEAGUE_DEFAULT, PPR_REFERENCE } from '@core/ScoringProfile'
import { lineupEnvironment, weekLines } from '@core/Schedule'
import { schedule, weekly2025 } from '../../../tests/coreFixtures'
import { readFixture } from '../../../tests/swiftFixtures'

const within = (actual: number | undefined, expected: number, accuracy: number) => {
  expect(actual).toBeDefined()
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(accuracy)
}

/**
 * Port of DefenseVsPositionTests: defense-vs-position against the real 2025
 * weekly file, scored under the league's own profile rather than nflverse's PPR.
 */
describe('DefenseVsPosition (weekly file)', () => {
  let cached: DefenseVsPositionTable | undefined
  const table = () => (cached ??= computeDvPFromWeekly(weekly2025(), LEAGUE_DEFAULT))

  it('has every NFL defense', () => {
    expect(defenseCount(table())).toBe(32)
  })

  /** Rank 1 is the softest defense — the most points allowed. */
  it('ranks the defense allowing the most at 1', () => {
    const t = table()
    for (const position of ['QB', 'RB', 'WR', 'TE'] as Position[]) {
      const ranked = t.ranked[position]
      expect(ranked).toBeDefined()
      const rates = ranked!.map((d) => t.byDefense[d]?.[position]?.perGame).filter((r): r is number => r !== undefined)
      expect(rates, `${position} must be softest first`).toEqual([...rates].sort((a, b) => b - a))
      expect(t.byDefense[ranked![0]!]?.[position]?.rank).toBe(1)
    }
  })

  /**
   * The denominator is games played, not player-weeks. Several receivers face a
   * defense each week, so player-weeks must exceed games.
   */
  it('divides by games, not player-weeks', () => {
    const cell = table().byDefense['PHI']?.['WR']
    expect(cell).toBeDefined()
    expect(cell!.perGame).toBeDefined()
    expect(cell!.playerWeeks).toBeGreaterThan(cell!.games)
    within(cell!.perGame! * cell!.games, cell!.totalPoints, 0.0001)
  })

  /** Byes are handled without a schedule: a full 17-game season, not 18 weeks. */
  it('excludes byes from the games count', () => {
    const games = Object.values(table().byDefense).map((c) => c['WR']?.games).filter((g): g is number => g !== undefined)
    // no defense plays more than 17 regular-season games
    expect(games.every((g) => g <= 17)).toBe(true)
  })

  it('makes the league average the mean of ranked defenses', () => {
    const t = table()
    const ranked = t.ranked['RB']
    expect(ranked).toBeDefined()
    const rates = ranked!.map((d) => t.byDefense[d]?.['RB']?.perGame).filter((r): r is number => r !== undefined)
    const mean = rates.reduce((s, r) => s + r, 0) / ranked!.length
    within(t.leagueAverage['RB'], mean, 0.0001)
    const deltas = ranked!.map((d) => t.byDefense[d]?.['RB']?.vsLeagueAverage).filter((r): r is number => r !== undefined)
    // deviations from a mean sum to zero
    within(deltas.reduce((s, r) => s + r, 0), 0, 0.0001)
  })

  /** Under the sample-size floor a defense is left unranked — and not given an average either. */
  it('leaves defenses under the floor unranked, not average', () => {
    const t = computeDvPFromWeekly(weekly2025(), LEAGUE_DEFAULT, { minimumGames: 99 })
    const cells = Object.values(t.byDefense).flatMap((c) => Object.values(c))
    expect(cells.every((c) => c.rank === undefined)).toBe(true)
    expect(cells.every((c) => c.vsLeagueAverage === undefined)).toBe(true)
    expect(t.leagueAverage).toEqual({})
    // The raw rate is still there — it is the ranking that is withheld.
    expect(t.byDefense['PHI']?.['WR']?.perGame).toBeDefined()
  })

  it('restricts the window to a week range', () => {
    const t = computeDvPFromWeekly(weekly2025(), LEAGUE_DEFAULT, { weekRange: [1, 4], minimumGames: 1 })
    expect(t.weeks).toEqual([1, 2, 3, 4])
    expect(Object.values(t.byDefense).every((c) => (c['WR']?.games ?? 0) <= 4)).toBe(true)
  })

  /** The weekly file has no DEF or IDP production — those cells are absent, never zero (§3.2). */
  it('has no cells for positions without production data', () => {
    expect(Object.values(table().byDefense).every((c) => c['DEF'] === undefined && c['LB'] === undefined)).toBe(true)
  })

  /** Sleeper spells the Rams `LAR`; the weekly file spells them `LA` (§5.6). */
  it('normalises the team code on lookup', () => {
    const t = table()
    expect(dvpCell(t, 'LAR', 'WR')).toBeDefined()
    expect(dvpCell(t, 'LAR', 'WR')).toEqual(dvpCell(t, 'LA', 'WR'))
  })

  /** League points, not nflverse PPR: a PPR profile makes receivers look richer against the same defense. */
  it('scores under the given profile', () => {
    const file = weekly2025()
    const standardWR = computeDvPFromWeekly(file, LEAGUE_DEFAULT).byDefense['PHI']?.['WR']?.perGame
    const pprWR = computeDvPFromWeekly(file, PPR_REFERENCE).byDefense['PHI']?.['WR']?.perGame
    expect(standardWR).toBeDefined()
    expect(pprWR).toBeDefined()
    expect(Math.abs(standardWR! - pprWR!)).toBeGreaterThan(0.01)
  })
})

/** Port of GameLinesTests (lives in DefenseVsPositionTests.swift). */
describe('GameLines', () => {
  const norm = (n: number | undefined) => (n === undefined ? undefined : n + 0)

  /** PHI hosted DAL in week 1 of 2025, PHI favored by 8.5, total 47.5. */
  it('computes home-favorite implied totals', () => {
    const lines = weekLines(schedule(2025), 1)
    const phi = lines['PHI']
    const dal = lines['DAL']
    expect(phi).toBeDefined()
    expect(dal).toBeDefined()
    within(phi!.impliedTotal, 28.0, 0.001)
    within(dal!.impliedTotal, 19.5, 0.001)
    expect(phi!.opponent).toBe('DAL')
    expect(phi!.isHome).toBe(true)
  })

  /** The file's positive-means-home-favored convention is flipped to the Odds API's negative-means-favored. */
  it('uses the Odds sign convention for spreads', () => {
    const lines = weekLines(schedule(2025), 1)
    expect(lines['PHI']?.spread).toBe(-8.5)
    expect(lines['DAL']?.spread).toBe(8.5)
  })

  /** LAC hosted KC with a spreadLine of −3: the *away* team was favored. */
  it('computes away-favorite implied totals', () => {
    const lines = weekLines(schedule(2025), 1)
    within(lines['KC']?.impliedTotal, 25.25, 0.001)
    within(lines['LAC']?.impliedTotal, 22.25, 0.001)
    expect(lines['KC']?.spread).toBe(-3)
  })

  it('makes both sides sum to the total', () => {
    const lines = weekLines(schedule(2025), 1)
    for (const line of Object.values(lines)) {
      const implied = line.impliedTotal
      const other = lines[line.opponent]?.impliedTotal
      const total = line.total
      if (implied === undefined || other === undefined || total === undefined) continue
      within(implied + other, total, 0.001)
    }
    // 16 games in week 1, both sides of each
    expect(Object.keys(lines)).toHaveLength(32)
  })

  /** Week 8 of 2025 had ARI, DET, JAX, LA, LV and SEA on bye. */
  it('gives teams on bye no line', () => {
    const lines = weekLines(schedule(2025), 8)
    for (const team of ['ARI', 'DET', 'JAX', 'LA', 'LV', 'SEA']) expect(lines[team], `${team} was on bye`).toBeUndefined()
    expect(Object.keys(lines)).toHaveLength(26)
  })

  /** Two starters from one NFL team count once; a team with no line is named, not counted as zero. */
  it('counts each team once in a lineup environment and names missing teams', () => {
    const lines = weekLines(schedule(2025), 8)
    const env = lineupEnvironment(['PHI', 'PHI', 'SEA', undefined], lines)
    expect(env.teamCount).toBe(2)
    expect(env.missing).toEqual(['SEA'])
    expect(env.total).toBe(lines['PHI']?.impliedTotal)
  })

  it('normalises Sleeper team codes in a lineup environment', () => {
    const lines = weekLines(schedule(2025), 8)
    // LAR is LA, and LA was on bye in week 8
    expect(lineupEnvironment(['LAR'], lines).missing).toEqual(['LA'])
  })

  /** Every 2026 week 1 line sits on that week's real matchup, both sides of it. */
  it('puts 2026 week 1 lines on the scheduled matchups', () => {
    const lines = weekLines(schedule(2026), 1)
    const matchups: [string, string][] = [
      ['NE', 'SEA'], ['SF', 'LA'], ['CHI', 'CAR'], ['TB', 'CIN'], ['NO', 'DET'],
      ['BUF', 'HOU'], ['BAL', 'IND'], ['CLE', 'JAX'], ['ATL', 'PIT'], ['NYJ', 'TEN'],
      ['ARI', 'LAC'], ['MIA', 'LV'], ['GB', 'MIN'], ['WAS', 'PHI'], ['DAL', 'NYG'],
      ['DEN', 'KC'],
    ]
    expect(Object.keys(lines)).toHaveLength(32)
    for (const [away, home] of matchups) {
      const a = lines[away]
      const h = lines[home]
      expect(a, away).toBeDefined()
      expect(h, home).toBeDefined()
      expect(a!.opponent).toBe(home)
      expect(h!.opponent).toBe(away)
      expect(h!.isHome).toBe(true)
      expect(a!.total, `${away}@${home} share one total`).toBe(h!.total)
      expect(norm(a!.spread === undefined ? undefined : -a!.spread), `${away}@${home} spreads mirror`).toBe(norm(h!.spread))
    }
    // The closing line: PIT −6.5, total 40.5.
    expect(lines['PIT']?.spread).toBe(-6.5)
    expect(lines['PIT']?.total).toBe(40.5)
    within(lines['PIT']?.impliedTotal, 23.5, 0.001)
  })

  it('reports no lines at all as undefined, not zero', () => {
    expect(lineupEnvironment(['SEA'], {}).total).toBeUndefined()
  })
})

/**
 * Port of DefenseFacingTests: the generic path — already-scored player-weeks —
 * which Sleeper's stat lines feed, and which must agree with the file path.
 */
describe('DefenseVsPosition (facing lines)', () => {
  it('divides per-game by games, not player-weeks', () => {
    const lines = [
      facing(1, 'WR', 'KC', 10),
      facing(1, 'WR', 'KC', 6),
      facing(2, 'WR', 'KC', 8),
      facing(1, 'WR', 'LAR', 4),
      facing(2, 'WR', 'LAR', 4),
    ]
    const table = computeDvP(lines, new Set<Position>(['WR']), 2)
    const kc = dvpCell(table, 'KC', 'WR')
    expect(kc).toBeDefined()
    expect(kc!.games).toBe(2)
    expect(kc!.playerWeeks).toBe(3)
    expect(kc!.perGame).toBe(12)
    expect(kc!.rank, 'softest').toBe(1)
    // Sleeper spelling resolves to the same cell.
    expect(dvpCell(table, 'LAR', 'WR')?.rank).toBe(2)
    expect(dvpCell(table, 'LA', 'WR')?.rank).toBe(2)
    expect(table.leagueAverage['WR']).toBe(8)
    expect(dvpCovers(table, 'WR')).toBe(true)
    expect(dvpCovers(table, 'LB')).toBe(false)
  })

  it('leaves a defense under the sample floor unranked, not average', () => {
    const table = computeDvP([facing(1, 'LB', 'NE', 9)], new Set<Position>(['LB']), 4)
    const cell = dvpCell(table, 'NE', 'LB')
    expect(cell).toBeDefined()
    expect(cell!.perGame).toBe(9)
    expect(cell!.rank).toBeUndefined()
    expect(cell!.vsLeagueAverage).toBeUndefined()
  })

  it('still counts a week with no points as a game', () => {
    const table = computeDvP([facing(1, 'RB', 'SF', 20), facing(2, 'RB', 'SF', NaN)], new Set<Position>(['RB']), 1)
    expect(dvpCell(table, 'SF', 'RB')?.games).toBe(2)
    expect(dvpCell(table, 'SF', 'RB')?.perGame).toBe(10)
  })

  /** The file path and the facing path are one computation. */
  it('agrees between the file path and the facing path', () => {
    const weekly = new WeeklyFile(readFixture('FCCore', 'weekly-2025.json'))
    const te = new Set<Position>(['TE'])
    const viaFile = computeDvPFromWeekly(weekly, LEAGUE_DEFAULT, { positions: te })
    const lines: DefenseFacing[] = []
    for (const player of weekly.allPlayers()) {
      if (player.position !== 'TE') continue
      for (const row of player.rows) {
        if (!row.opponent) continue
        const points = scoreWeek(row, LEAGUE_DEFAULT, 'TE').points
        lines.push(facing(row.week, 'TE', row.opponent, points ?? NaN))
      }
    }
    const viaFacing = computeDvP(lines, te)
    expect(viaFile.ranked['TE']).toEqual(viaFacing.ranked['TE'])
    expect(viaFile.leagueAverage['TE']).toBe(viaFacing.leagueAverage['TE'])
  })
})
