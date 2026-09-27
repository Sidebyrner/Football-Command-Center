import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { planningModePurpose } from '@models/market/PlanningJobs'
import { PlanningScreen } from './PlanningScreen'
import { text } from './specText'

describe('Planning screen', () => {
  it('renders the hero, the intro, the mode picker and the byes job', async () => {
    const model = (await demoServices()).planning
    expect(model.context).toBeDefined()
    const html = text(await renderScreen(PlanningScreen, '/planning'))
    expect(html).toContain('Market · Planning')
    const short = model.userShortWeeks()
    if (short.length === 0) {
      expect(html).toContain('Covered')
      expect(html).toContain('You can field a full lineup in every remaining week.')
    } else {
      const next = [...short].sort((a, b) => a.week - b.week)[0]!
      expect(html).toContain(`Week ${next.week}: ${next.shortfall} short`)
      expect(html).toContain(`Short in ${short.length} of ${model.context!.remainingWeeks.length} remaining weeks.`)
    }
    expect(html).toContain('Plan ahead')
    expect(html).toContain('Got it')
    expect(html).toContain('Byes')
    expect(html).toContain(planningModePurpose('byes'))
    expect(html).toContain('League view')
    expect(html).toContain('About this data')
  })

  it('expands a short week with pickups and trade partners', async () => {
    const model = (await demoServices()).planning
    const short = model.userShortWeeks()
    if (short.length === 0) return
    model.selectedWeek = short[0]!.week
    try {
      const html = text(await renderScreen(PlanningScreen, '/planning'))
      expect(html).toContain('Pick up')
      expect(html).toContain('Trade with')
    } finally {
      model.selectedWeek = undefined
    }
  })

  it('renders the trades and waivers jobs', async () => {
    const model = (await demoServices()).planning
    try {
      model.mode = 'trades'
      const trades = text(await renderScreen(PlanningScreen, '/planning'))
      expect(trades).toContain('Start a trade')
      expect(trades).toContain(planningModePurpose('trades'))
      for (const target of model.tradeTargets) expect(trades).toContain(`Build a trade with ${target.rival.manager}`)

      model.mode = 'waivers'
      const waivers = text(await renderScreen(PlanningScreen, '/planning'))
      expect(waivers).toContain('Open the Waiver Board')
      expect(waivers).toContain('Trending adds')
      expect(waivers).toContain(model.userShortWeeks().length === 0 ? 'Best available' : 'Fills your short weeks')
    } finally {
      model.mode = 'byes'
    }
  })
})
