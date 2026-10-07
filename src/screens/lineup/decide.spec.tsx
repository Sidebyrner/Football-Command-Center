import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { slotCanDecide, slotHasBenchOption, slotIsCloseCall } from '@models/lineup/DecideModel'
import { useApp } from '@ui/app/AppContext'
import { DecideDialog } from './DecideDialog'
import { DecideScreen, slotDetail } from './DecideScreen'
import { text } from './specText'

describe('Decide screen', () => {
  it('lists every slot as a start call, close calls first', async () => {
    const services = await demoServices()
    const slots = services.decide.orderedSlots()
    expect(slots.length).toBe(services.decide.slots().length)
    const close = slots.filter(slotIsCloseCall)
    // Close calls lead, locked slots trail.
    expect(slots.slice(0, close.length).every(slotIsCloseCall)).toBe(true)
    const firstLocked = slots.findIndex((s) => !slotCanDecide(s))
    if (firstLocked >= 0) expect(slots.slice(firstLocked).every((s) => !slotCanDecide(s))).toBe(true)

    const html = text(await renderScreen(DecideScreen, '/lineup/decide'))
    expect(html).toContain('Lineup · Decide')
    expect(html).toContain(close.length === 0 ? 'No close calls' : `${close.length} close call`)
    expect(html).toContain('Slots')
    expect(html).toContain('Nothing is blended into one score.')
    expect(html.match(/data-testid="decide\.slot\./g)?.length).toBe(slots.length)
    for (const slot of slots) expect(html).toContain(slotDetail(slot))
    // The hub header has a Decide card, selected here.
    expect(html).toContain('Decide')
    expect(html).toContain('aria-current="page"')
  })

  it('opens a slot on the this-week lens with the free-agent hopper', async () => {
    const services = await demoServices()
    const slot = services.decide.orderedSlots().find((s) => slotCanDecide(s) && slotHasBenchOption(s))
    expect(slot).toBeDefined()
    const session = services.decide.session(slot!)
    function Harness() {
      useApp()
      return <DecideDialog session={session} onClose={() => {}} />
    }
    const html = text(await renderScreen(Harness, '/lineup/decide'))
    expect(html).toContain(`Decide ${slot!.token}`)
    expect(html).toContain('This week')
    expect(html).toContain('Rest of season')
    expect(html).toContain('data-testid="decide.verdict"')
    expect(html).toContain('the same numbers Sit/Start uses')
    expect(html).toContain('From the waiver wire')
    expect(html).toContain('Search free agents')
    if (slot!.incumbentID !== undefined) expect(html).toContain('STARTING')
  })
})
