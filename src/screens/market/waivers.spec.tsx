import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { WAIVER_SORT_SOURCE } from '@models/market/WaiverBoardModel'
import { useApp } from '@ui/app/AppContext'
import { AddDropDialog, WaiversScreen } from './WaiversScreen'
import { shortName } from './shared'
import { text } from './specText'

describe('Waivers screen', () => {
  it('renders the top claim, the controls, the board and the notes', async () => {
    const model = (await demoServices()).waivers
    expect(model.context).toBeDefined()
    expect(model.rows.length).toBeGreaterThan(0)
    const html = text(await renderScreen(WaiversScreen, '/waivers'))
    expect(html).toContain('Market · Waivers')
    expect(html).toContain(shortName(model.rows[0]!.name))
    expect(html).toContain('Rank by')
    expect(html).toContain('Plays this week')
    expect(html).toContain(WAIVER_SORT_SOURCE[model.sort])
    expect(html).toContain('Free agents')
    expect(html).toContain(model.rows[0]!.name)
    expect(html).toContain('About this data')
    expect(html).toContain('read live from your league settings')
    if (model.dropCandidates.length > 0) expect(html).toContain('Your bench, weakest first')
    if (model.rows.length > 60) expect(html).toContain(`Showing 60 of ${model.rows.length}.`)
  })

  it('shows the empty board message when filters match nobody', async () => {
    const model = (await demoServices()).waivers
    model.query = 'zzzqqqxxx'
    try {
      const html = text(await renderScreen(WaiversScreen, '/waivers'))
      expect(html).toContain('Nobody matches. Loosen the filters')
      expect(html).toContain('Nobody yet')
    } finally {
      model.query = ''
    }
  })

  it('draws the add/drop dialog with each drop’s lineup effect', async () => {
    const model = (await demoServices()).waivers
    const add = model.rows[0]!
    function Harness() {
      const { services } = useApp()
      return <AddDropDialog model={services.waivers} add={add} onClose={() => {}} />
    }
    const html = text(await renderScreen(Harness, '/waivers'))
    expect(html).toContain(`Claim ${add.name}`)
    expect(html).toContain('What each drop does to your best lineup this week, on the projection.')
    expect(html).toContain('Make the claim in Sleeper')
    if (model.dropCandidates.length === 0) {
      expect(html).toContain('No bench player to drop')
    } else {
      expect(html).toContain(`Drop ${model.dropCandidates[0]!.row.name}`)
    }
  })
})
