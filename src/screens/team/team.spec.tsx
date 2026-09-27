import { afterEach, describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { MyTeamScreen } from './MyTeamScreen'

afterEach(async () => { (await demoServices()).dashboard.zoom = 'thisWeek' })

describe('My Team screen', () => {
  it('renders This Week in the demo league', async () => {
    const html = await renderScreen(MyTeamScreen, '/dashboard')
    // Hero
    expect(html).toContain('Byrne Notice')
    expect(html).toContain('4-2')
    expect(html).toContain('Lines wk 7')
    expect(html).toContain('Not connected')
    // Zoom picker, Board link, readiness, alerts, this week, waiver targets
    expect(html).toContain('This Week')
    expect(html).toContain('Season')
    expect(html).toContain('86.7–54.2 · 1 to fix')
    expect(html).toContain('Lineup readiness')
    expect(html).toContain('Before kickoff')
    expect(html).toContain('Josh Allen')
    expect(html).toContain('on bye this week — starting them scores 0')
    expect(html).toContain('Leading Gridiron Gurus by 32.5')
    expect(html).toContain('4 vs 4 left to play')
    expect(html).toContain('Waiver targets')
    expect(html).toContain('Trending adds nobody in your league has. Popularity only.')
    expect(html).toContain('Plan waivers for the weeks ahead')
    expect(html).toContain('About this data')
  })

  it('renders the Season zoom', async () => {
    const services = await demoServices()
    services.dashboard.zoom = 'season'
    const html = await renderScreen(MyTeamScreen, '/dashboard')
    expect(html).toContain('Standings')
    expect(html).toContain('Byrne Notice (you)')
    expect(html).toContain('Your season')
    expect(html).toContain('Start a trade')
    expect(html).toContain('Weekly scoring')
    expect(html).toContain('Draft value realized')
    expect(html).not.toContain('Waiver targets')
    expect(services.dashboard.results.length).toBeGreaterThan(0)
  })
})
