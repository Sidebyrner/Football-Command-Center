import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { MatchupScreen } from './MatchupScreen'
import { text } from './specText'

describe('Matchup screen', () => {
  it('renders both sides head-to-head', async () => {
    const html = text(await renderScreen(MatchupScreen, '/lineup/matchup'))
    expect(html).toContain('Lineup · Matchup · Week 7')
    expect(html).toContain('Byrne Notice')
    expect(html).toContain('Gridiron Gurus')
    expect(html).toContain('86.7')
    expect(html).toContain('left to play')
    expect(html).toContain('Games in progress')
    expect(html).toContain('Head-to-head')
    expect(html).toContain('Opponent')
    expect(html).toContain('Comparing live points')
    expect(html).toMatch(/Ahead in \d+ of 11/)
    expect(html).toContain('Christian McCaffrey')
    expect(html).toContain('Kyren Williams')
    expect(html).toContain('Implied totals come from recorded closing lines, not live odds.')
  })

  it('renders one side in full', async () => {
    const s = await demoServices()
    s.matchup.mode = 'mine'
    try {
      const html = text(await renderScreen(MatchupScreen, '/lineup/matchup'))
      expect(html).toContain('Jahmyr Gibbs')
      expect(html).toMatch(/\/gm/)
      expect(html).toContain('on bye — scores 0')
    } finally {
      s.matchup.mode = 'headToHead'
    }
  })
})
