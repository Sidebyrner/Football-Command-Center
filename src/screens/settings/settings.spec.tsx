import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { StaticAppProvider } from '@ui/app/AppContext'
import { NeedsSetup } from '@ui/components/State'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { PrivacyPage } from '../privacy/PrivacyPage'
import { confirmSwitchLeague, SettingsScreen } from './SettingsScreen'

/** Renders with the demo league's services but as a real (non-demo) visitor would see it. */
async function renderOwnLeague(node: JSX.Element, path = '/settings'): Promise<string> {
  const services = await demoServices()
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <StaticAppProvider services={services} demo={false}>
        <div className="fcc">{node}</div>
      </StaticAppProvider>
    </MemoryRouter>,
  )
}

describe('Settings screen', () => {
  it('renders in the demo league', async () => {
    const html = await renderScreen(SettingsScreen, '/settings')
    expect(html).toContain('You’re in the demo league')
    expect(html).toContain('Leave the demo')
    expect(html).toContain('Join the beta')
    expect(html).toContain('Send feedback')
  })

  /** Both forms say where their data goes, and feedback says what rides along. */
  it('links Privacy beside both forms and from the footer', async () => {
    const html = await renderScreen(SettingsScreen, '/settings')
    expect(html.match(/href="\/privacy"/g)?.length).toBe(3)
    expect(html).toContain('Your browser type and screen size are sent with it')
  })

  /** The relay is for the few who run one: behind a closed disclosure, not a top-level section. */
  it('keeps the relay inside a closed Advanced disclosure', async () => {
    const html = await renderOwnLeague(<SettingsScreen />)
    const details = html.match(/<details class="settings-advanced"[^>]*>/)?.[0]
    expect(details).toBeDefined()
    expect(details).not.toContain('open')
    expect(html.indexOf('Relay (optional)')).toBeGreaterThan(html.indexOf('settings-advanced'))
  })

  it('switching league asks first', () => {
    const asked: string[] = []
    expect(confirmSwitchLeague((m) => { asked.push(m); return false })).toBe(false)
    expect(asked[0]).toMatch(/^Switch league\?/)
    expect(confirmSwitchLeague(() => true)).toBe(true)
  })
})

describe('First run', () => {
  /** A new visitor sees what the app does and all three ways in, not a bare "go to Settings". */
  it('the empty state welcomes and offers Sleeper, ESPN and the demo', async () => {
    const html = await renderOwnLeague(<NeedsSetup />, '/board')
    expect(html).toContain('Welcome to Football Command Center')
    expect(html).toContain('who to start')
    for (const label of ['Connect Sleeper', 'Connect ESPN', 'Try the demo']) expect(html).toContain(label)
  })

  it('the privacy page names every place data goes', () => {
    const html = renderToString(<MemoryRouter><PrivacyPage /></MemoryRouter>)
    for (const fact of ['Netlify Forms', 'localStorage', 'IndexedDB', 'Google Fonts', 'nflverse', 'Sleeper', 'espn_s2', 'user agent', 'window size', 'stores nothing']) {
      expect(html, fact).toContain(fact)
    }
  })
})
