import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { slotCanDecide } from '@models/lineup/DecideModel'
import { SitStartScreen } from './SitStartScreen'
import { text } from './specText'

describe('Sit/Start screen', () => {
  it('renders the demo lineup', async () => {
    const html = text(await renderScreen(SitStartScreen, '/lineup/sit-start'))
    expect(html).toContain('Lineup · Sit/Start')
    expect(html).toContain('1 swap')
    expect(html).toContain('Optimize by')
    expect(html).toContain('Season pts/gm')
    expect(html).toContain('Changes')
    expect(html).toContain('Jared Goff')
    expect(html).toContain('Josh Allen')
    expect(html).toContain('Make these changes in Sleeper')
    expect(html).toContain('https://sleeper.com/leagues/')
    expect(html).toContain('pick a different lineup')
    expect(html).toContain('Proposed lineup')
    expect(html).toContain("starters have kicked off and can't be moved.")
    expect(html).toContain('Locked — game started')
    expect(html).toContain('Q players are started on their full value.')
    expect(html).toContain('Left out')
    expect(html).toContain('On bye this week')
    expect(html).toContain('No stats for DEF and IDP')
    expect(html).toContain('About this data')
    // The hub header sits on top, Sit/Start selected.
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Injuries')
  })

  it('puts a Decide button on every slot that can still change', async () => {
    const services = await demoServices()
    const decidable = services.decide.slots().filter(slotCanDecide)
    const html = text(await renderScreen(SitStartScreen, '/lineup/sit-start'))
    expect(html.match(/data-testid="sitstart\.decide\./g)?.length ?? 0).toBe(decidable.length)
    for (const slot of decidable) expect(html).toContain(`data-testid="sitstart.decide.${slot.index}"`)
    // Locked slots get a spacer, not a button.
    expect(decidable.length).toBeLessThan(services.decide.slots().length)
  })
})
