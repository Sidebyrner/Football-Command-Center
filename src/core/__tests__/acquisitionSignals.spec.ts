import { describe, expect, it } from 'vitest'
import { COVERED_BY_WEEKLY_DATA, type Position } from '@core/Position'
import { OPPORTUNITY_TARGET_SHARE, acquisitionBoard, acquisitionSignals, valueOverStartLine } from '@core/AcquisitionSignals'
import { seasonPaceBaselines, type Baselines, type PositionBaseline } from '@core/Baselines'
import { runSeasonScan, type SeasonProfile } from '@core/SeasonProfile'
import { LEAGUE_DEFAULT } from '@core/ScoringProfile'
import { parseSlots } from '@core/RosterSlots'
import { LEAGUE_ROSTER_POSITIONS, LEAGUE_TEAM_COUNT, weekly2025 } from '../../../tests/coreFixtures'

/** Port of AcquisitionSignalTests. */
let cache: { players: SeasonProfile[]; lines: Baselines } | undefined
function scanned() {
  if (!cache) {
    const players = runSeasonScan(weekly2025(), LEAGUE_DEFAULT)
    cache = { players, lines: seasonPaceBaselines(players, parseSlots(LEAGUE_ROSTER_POSITIONS), LEAGUE_TEAM_COUNT) }
  }
  return cache
}

function profile({ position = 'WR', games = 10, pointsPerGame, form, recentTargetShare }: {
  position?: Position; games?: number; pointsPerGame: number; form?: number; recentTargetShare?: number
}): SeasonProfile {
  return {
    gsisID: 'test', name: 'Test Player', position, team: 'PHI', games, pointsPerGame,
    formPointsPerGame: form, targetShare: recentTargetShare, recentTargetShare, weeks: [],
  }
}

const line: PositionBaseline = { position: 'WR', starters: 16, startLine: 12.0, replacementLine: 10.0, pool: 200 }
const kinds = (p: SeasonProfile, b: Baselines) => acquisitionSignals(p, b).map((h) => h.signal)

describe('AcquisitionSignals', () => {
  it('keeps startable and above-replacement mutually exclusive', () => {
    const { players, lines } = scanned()
    let startable = 0
    let aboveReplacement = 0
    for (const player of players) {
      const keys = new Set(kinds(player, lines))
      expect(keys.has('startable') && keys.has('above-replacement'), `${player.name} fired both`).toBe(false)
      if (keys.has('startable')) startable++
      if (keys.has('above-replacement')) aboveReplacement++
    }
    expect(startable).toBeGreaterThan(0)
    expect(aboveReplacement).toBeGreaterThan(0)
  })

  /** Opportunity is the buy-low: every flag is below the start line with a real target share. */
  it('flags opportunity only below the start line with real usage', () => {
    const { players, lines } = scanned()
    let fired = 0
    for (const player of players) {
      if (!kinds(player, lines).includes('opportunity')) continue
      fired++
      const baseline = lines[player.position]
      expect(baseline).toBeDefined()
      expect(player.pointsPerGame, player.name).toBeLessThan(baseline!.startLine)
      expect(player.recentTargetShare, player.name).toBeDefined()
      expect(player.recentTargetShare!, player.name).toBeGreaterThanOrEqual(OPPORTUNITY_TARGET_SHARE)
    }
    expect(fired, 'the signal must actually fire on real data').toBeGreaterThan(0)
  })

  /** A position with no baseline produces zero signals rather than a bogus one (§3.2). */
  it('produces no signals for a position with no baseline', () => {
    const linebacker = profile({ position: 'LB', pointsPerGame: 40 })
    expect(acquisitionSignals(linebacker, {})).toEqual([])
    expect(acquisitionSignals(linebacker, { WR: line })).toEqual([])
    expect(valueOverStartLine(linebacker, { WR: line })).toBeUndefined()
  })

  it('applies the signal thresholds', () => {
    const b: Baselines = { WR: line }
    expect(kinds(profile({ pointsPerGame: 12.0 }), b), 'at the line counts as clearing it').toEqual(['startable'])
    expect(kinds(profile({ pointsPerGame: 11.0 }), b)).toEqual(['above-replacement'])
    expect(kinds(profile({ pointsPerGame: 5.0 }), b)).toEqual([])
    expect(kinds(profile({ pointsPerGame: 8.0, recentTargetShare: 0.2 }), b)).toEqual(['opportunity'])
    expect(kinds(profile({ pointsPerGame: 8.0, recentTargetShare: 0.199 }), b)).toEqual([])
    // Usage ahead of production only, so a startable player never gets it.
    expect(kinds(profile({ pointsPerGame: 20.0, recentTargetShare: 0.35 }), b)).toEqual(['startable'])
  })

  it('needs both a margin and a sample for form', () => {
    const b: Baselines = { WR: line }
    expect(kinds(profile({ pointsPerGame: 8.0, form: 11.0 }), b)).toEqual(['form'])
    expect(kinds(profile({ pointsPerGame: 8.0, form: 10.0 }), b), 'exactly 1.25x is not more than 1.25x').toEqual([])
    expect(kinds(profile({ games: 3, pointsPerGame: 8.0, form: 30.0 }), b)).toEqual([])
  })

  /**
   * Rank by value over the position's own start line, never raw points per
   * game — a raw sort just lists quarterbacks (§5.8).
   */
  it('ranks by value over the start line, not raw points', () => {
    const { players, lines } = scanned()
    const board = acquisitionBoard(players, lines)
    expect(board.length).toBeGreaterThan(0)
    const values = board.map((c) => c.valueOverStartLine)
    expect(values).toEqual([...values].sort((a, b) => b - a))

    // On the shipped file a raw sort puts four quarterbacks on top.
    const byRawPoints = [...board].sort((a, b) => b.player.pointsPerGame - a.player.pointsPerGame)
    expect(byRawPoints.slice(0, 4).map((c) => c.player.position)).toEqual(['QB', 'QB', 'QB', 'QB'])

    // Value over the line does not.
    expect(board[0]?.player.position).toBe('RB')
    expect(board[0]?.player.name).toBe('Christian McCaffrey')

    const topPositions = new Set(board.slice(0, 8).map((c) => c.player.position))
    expect(topPositions, 'the board must not collapse to one position').not.toEqual(new Set(['QB']))
  })

  /** Only players that tripped something make the board. */
  it('carries only players with a signal on the board', () => {
    const { players, lines } = scanned()
    const board = acquisitionBoard(players, lines)
    expect(board.every((c) => c.signals.length > 0)).toBe(true)
    expect(board.length).toBeLessThan(players.length)
    expect(board.every((c) => COVERED_BY_WEEKLY_DATA.has(c.player.position))).toBe(true)
  })

  /** The detail strings are shown verbatim, so they must name the numbers that fired the signal. */
  it('names the numbers in the detail', () => {
    const hit = acquisitionSignals(profile({ pointsPerGame: 8.0, recentTargetShare: 0.24 }), { WR: line })[0]
    expect(hit?.signal).toBe('opportunity')
    expect(hit?.label).toBe('Opportunity ahead of production')
    expect(hit?.detail).toBe('24% target share, still under the start line')
  })
})
