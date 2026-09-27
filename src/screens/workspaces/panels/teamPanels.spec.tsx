import { describe, expect, it } from 'vitest'
import { demoServices } from '../../../../tests/renderScreen'
import { ByeWeeksPanel, InjuriesPanel, LineupReadinessPanel, MatchupScorePanel, NewsPanel, SitStartPanel, StandingsPanel } from './TeamPanels'
import { renderPanel } from './teamPanelsSpecKit'
import { slotLabel } from './teamPanelParts'

describe('Team panels on the demo league', () => {
  it('Lineup readiness: the ring, the next lock and the alerts', async () => {
    const text = renderPanel(await demoServices(), LineupReadinessPanel)
    expect(text).toContain('10 of 11')
    expect(text).toContain('Lineup readiness')
    expect(text).toContain('1 need fixing — empty, bye or out')
    expect(text).toContain('Fix in Sit/Start →')
    expect(text).toMatch(/Next lock in 1h 55m · \S+/)
    expect(text).toContain('Josh Allen on bye this week — starting them scores 0')
  })

  it('Sit/Start: the gain, the changes and the lineup', async () => {
    const text = renderPanel(await demoServices(), SitStartPanel)
    expect(text).toContain('+35.9 pts with 1 change')
    expect(text).toContain('START Jared Goff QB 35.9')
    expect(text).toContain('SIT Josh Allen QB —')
    expect(text).toContain('Lineup QB Jared Goff 35.9')
    expect(text).toContain('Puka Nacua Q locked 20.6')
    expect(text).toContain('On season pts/gm.')
  })

  it('Matchup score: the scoreboard and your starters', async () => {
    const text = renderPanel(await demoServices(), MatchupScorePanel)
    expect(text).toContain('86.7 You Live 54.2 Gridiron Gurus')
    expect(text).toContain('4 left to play · they have 4')
    expect(text).toContain('Your starters QB Josh Allen Bye —')
    expect(text).toContain('Saquon Barkley live PHI MIN')
    expect(text).toContain('Jahmyr Gibbs DET TB 36.8')
  })

  it('Injuries: your tagged players, with a count of the rest', async () => {
    const services = await demoServices()
    const text = renderPanel(services, InjuriesPanel)
    expect(text).toContain('Puka Nacua Q starter Questionable')
    expect(text).not.toContain('more in the Injury Center')
    const trimmed = renderPanel(services, InjuriesPanel, { rows: 0 })
    expect(trimmed).toContain(`${services.injuries.roster.length} more in the Injury Center.`)
  })

  it('Bye weeks: the strip and the short weeks', async () => {
    const text = renderPanel(await demoServices(), ByeWeeksPanel)
    expect(text).toContain('Week 8 short WR')
    expect(text).toContain('Week 9 short DEF')
    // Week 7 three slots short, week 8 two, then full weeks through 18.
    expect(text).toContain('7 3 8 2 9 10 11 12 13 14 15 16 17 18')
  })

  it('News: asks for the relay, then lists your players', async () => {
    const services = await demoServices()
    expect(renderPanel(services, NewsPanel)).toContain('News comes through your relay. Add it in Settings.')
    services.dashboard.setRelay('https://relay.example.test')
    try {
      expect(renderPanel(services, NewsPanel)).toContain('Nothing new on your players.')
      services.dashboard.news = [
        { title: 'Josh Allen limited at practice', url: 'https://example.test/a', publishedAt: '2h ago' },
        { title: 'Puka Nacua returns', url: 'javascript:alert(1)' },
      ]
      const text = renderPanel(services, NewsPanel, { rows: 6 })
      expect(text).toContain('Josh Allen limited at practice 2h ago')
      expect(text).toContain('Puka Nacua returns')
      expect(renderPanel(services, NewsPanel, { rows: 1 })).not.toContain('Puka Nacua returns')
    } finally {
      services.dashboard.setRelay(undefined)
    }
  })

  it('Standings: the table, you marked, cut to the row count', async () => {
    const services = await demoServices()
    const text = renderPanel(services, StandingsPanel, { rows: 12 })
    expect(text).toContain('1 Byrne Notice (you) 4-2 1,011.5')
    expect(text).toContain('2 Fourth and Long 4-2 957.4')
    expect(text).toContain('3 Gridiron Gurus 2-4 878.4')
    expect(renderPanel(services, StandingsPanel, { rows: 2 })).not.toContain('Gridiron Gurus')
  })

  it('abbreviates the flex slots', () => {
    expect(['SUPER_FLEX', 'REC_FLEX', 'WRRB_FLEX', 'IDP_FLEX', 'FLEX'].map(slotLabel)).toEqual(['SF', 'RWT', 'W/R', 'IDP', 'FLEX'])
  })
})
