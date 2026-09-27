import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { TradesScreen } from './TradesScreen'
import { text } from './specText'

describe('Trades screen', () => {
  it('walks the four steps of the desk', async () => {
    const services = await demoServices()
    const desk = services.trades.desk
    expect(desk).toBeDefined()
    if (!desk) return

    // Step 1: what you need.
    let html = text(await renderScreen(TradesScreen, '/trades'))
    expect(html).toContain('Market · Trade desk')
    expect(html).toContain('What you need')
    expect(html).toContain('Step 1 of 4')
    expect(html).toContain('Find a player on any team')
    expect(html).toContain('Or pick a position')
    expect(html).toContain('Start over')
    if (desk.goals.length > 0) {
      expect(html).toContain('From your roster')
      expect(html).toContain(desk.goals[0]!.title)
    } else {
      expect(html).toContain('No short weeks and no starter below the start line.')
    }

    // Step 2: who has it.
    if (desk.goals.length > 0) desk.chooseGoal(desk.goals[0]!)
    else desk.choosePosition(desk.pickablePositions[0]!)
    expect(desk.step).toBe('partner')
    html = text(await renderScreen(TradesScreen, '/trades'))
    expect(html).toContain('Who has it')
    expect(html).toContain('Step 2 of 4')
    expect(html).toContain(desk.goal!.title)
    if (desk.partners.length === 0) {
      expect(html).toContain('No rival has a spare player who fits.')
      return
    }
    expect(html).toContain('Sorted by: both of you have something the other needs')
    expect(html).toContain(desk.partners[0]!.rival.manager)

    // Step 3: build the deal.
    desk.choosePartner(desk.partners[0]!)
    expect(desk.step).toBe('deal')
    html = text(await renderScreen(TradesScreen, '/trades'))
    expect(html).toContain('Build the deal')
    expect(html).toContain('Step 3 of 4')
    expect(html).toContain('Compare on')
    expect(html).toContain('You get')
    expect(html).toContain('You send')
    expect(html).toContain('What it does')
    expect(html).toContain('lineup')
    expect(html).toContain(desk.window.kind === 'closed' ? 'Trades are closed' : 'Write the pitch')

    // Changing the basis re-renders the deal on it.
    const other = desk.availableBases.find((b) => b !== desk.basis)
    if (other) {
      desk.basis = other
      html = text(await renderScreen(TradesScreen, '/trades'))
      expect(html).toContain(`Best lineup this week on ${desk.label(other).toLowerCase()}`)
    }

    // Step 4: the pitch.
    if (!desk.canApproach) {
      expect(html).toContain('Pick at least one player on each side.')
      return
    }
    desk.advanceToApproach()
    html = text(await renderScreen(TradesScreen, '/trades'))
    expect(html).toContain('Approach')
    expect(html).toContain('Step 4 of 4')
    expect(html).toContain('Your pitch')
    expect(html).toContain(`Hey ${desk.partner!.rival.manager} — trade idea.`)
    expect(html).toContain('The facts it uses')
    expect(html).toContain('Open in Sleeper')
    expect(html).toContain('Copy')
    // No relay in the demo, so no AI polish.
    expect(html).not.toContain('Polish with my AI')

    // Back keeps the deal.
    desk.back()
    expect(desk.step).toBe('deal')
    expect(desk.sending.size).toBeGreaterThan(0)
  })
})
