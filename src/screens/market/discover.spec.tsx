import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { discoverySortLabel } from '@models/market/DiscoveryModel'
import { useApp } from '@ui/app/AppContext'
import { CompareDialog, DiscoverScreen } from './DiscoverScreen'
import { shortName } from './shared'
import { text } from './specText'

describe('Discover screen', () => {
  it('renders the best free agent, the scope picker and the list', async () => {
    const services = await demoServices()
    const model = services.discovery
    expect(model.context).toBeDefined()
    expect(model.visible.length).toBeGreaterThan(0)
    const html = text(await renderScreen(DiscoverScreen, '/discovery'))
    expect(html).toContain('Market · Discover')
    expect(html).toContain(shortName(model.visible[0]!.name))
    expect(html).toContain(`best by ${discoverySortLabel(model.sort).toLowerCase()}`)
    expect(html).toContain('free agents')
    expect(html).toContain('Free agents')
    expect(html).toContain('Everyone')
    expect(html).toContain('Free agent or team')
    expect(html).toContain('Rival benches')
    expect(html).toContain(model.visible[0]!.name)
    expect(html).toContain(`${Math.min(100, model.visible.length)} of ${model.visible.length} · sorted by`)
    // One row per shown free agent, up to 100.
    expect(html.match(/data-testid="discover.row"/g)?.length).toBe(Math.min(100, model.visible.length))
  })

  it('says so when a search matches nobody', async () => {
    const model = (await demoServices()).discovery
    model.query = 'zzzqqqxxx'
    try {
      const html = text(await renderScreen(DiscoverScreen, '/discovery'))
      expect(html).toContain('Nobody matches “zzzqqqxxx”.')
      expect(html).toContain('No free agents')
    } finally {
      model.query = ''
    }
  })

  it('draws the compare dialog for the compare list', async () => {
    const services = await demoServices()
    const [a, b] = services.discovery.visible
    services.linkBus.publish({ kind: 'addCompare', playerID: a!.id }, 1)
    services.linkBus.publish({ kind: 'addCompare', playerID: b!.id }, 1)
    function Harness() {
      const { services } = useApp()
      return <CompareDialog model={services.discovery} linkBus={services.linkBus} onClose={() => {}} />
    }
    try {
      const html = text(await renderScreen(Harness, '/discovery'))
      expect(html).toContain('Compare')
      expect(html).toContain(a!.name)
      expect(html).toContain(b!.name)
      expect(html).toContain('Range this season')
      expect(html).toContain('Clear')
    } finally {
      services.linkBus.publish({ kind: 'clearCompare' }, 1)
    }
    const empty = text(await renderScreen(Harness, '/discovery'))
    expect(empty).toContain('Compare up to four players')
  })
})
