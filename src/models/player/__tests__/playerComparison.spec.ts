import { describe, expect, it } from 'vitest'
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'
import { DiscoveryModel } from '@models/market/DiscoveryModel'
import { PlayerCardModel } from '@models/player/PlayerCardModel'
import { formatComparisonMetric, PlayerComparison, type ComparisonPlayer } from '@models/player/PlayerComparison'
import { makeHarness, TestClock } from '../../../../tests/appHarness'
import { WorkspaceFixture as F } from '../../../../tests/workspaceFixture'

/** Port of PlayerComparisonTests (DiscoveryTests.swift). */
describe('PlayerComparison', () => {
  it('the best value per row respects direction', async () => {
    // Swift's `services.playerCard` and `services.discovery`, over one shared loader.
    const { sleeper, staticData } = makeHarness(F.transport())
    const loader = new LeagueContextLoader(sleeper, staticData, TestClock.beforeKickoffs)
    const discovery = new DiscoveryModel(loader, sleeper)
    await discovery.load({ leagueID: 'L1', userRosterID: 1 })
    const context = discovery.context!
    expect(context).toBeDefined()
    const ids = [F.cook, F.gibbs, F.henderson]
    const cards = ids.map((id) => new PlayerCardModel(id, context, sleeper))
    const comparison = PlayerComparison.build(cards, (id) => discovery.row(id), discovery.defense, 6)
    expect(comparison.players.map((p) => p.id)).toEqual(ids)
    expect(comparison.players.map((p) => p.seriesIndex)).toEqual([0, 1, 2])
    const ppg = comparison.values('pointsPerGame')
    const best = comparison.bestIndex('pointsPerGame')
    if (best !== undefined) {
      expect(ppg[best]).toBe(Math.max(...ppg.filter((x): x is number => x !== undefined)))
    }
    for (const player of comparison.players) {
      if (player.floor !== undefined) expect(player.floor).toBeLessThanOrEqual(player.ceiling!)
    }
  })

  it('no tint with fewer than two values or all equal', () => {
    const player = (id: string, seriesIndex: number, rank: number): ComparisonPlayer => ({
      id, name: id.toUpperCase(), position: 'RB', seriesIndex, log: [],
      values: { opponentRank: rank, pointsPerGame: 10 },
    })
    const comparison = new PlayerComparison([player('a', 0, 3), player('b', 1, 12)], 6, [])
    expect(comparison.bestIndex('opponentRank'), 'rank 3 is the softer matchup').toBe(0)
    expect(comparison.bestIndex('pointsPerGame'), 'a tie tints nobody').toBeUndefined()
    expect(comparison.bestIndex('snapShare')).toBeUndefined()
  })

  it('formats each metric as Swift does', () => {
    expect(formatComparisonMetric('snapShare', 0.745)).toBe('75%')
    expect(formatComparisonMetric('gradeScore', 72.5)).toBe('73')
    expect(formatComparisonMetric('opponentRank', 4)).toBe('#4')
    expect(formatComparisonMetric('pointsPerGame', 12.26)).toBe('12.3')
  })
})
