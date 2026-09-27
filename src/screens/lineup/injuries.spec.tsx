import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { StaticAppProvider } from '@ui/app/AppContext'
import { InjuriesScreen, ReplacementFinder } from './InjuriesScreen'
import { text } from './specText'

describe('Injuries screen', () => {
  it('renders the roster, fill-ins and sources', async () => {
    const html = text(await renderScreen(InjuriesScreen, '/lineup/injuries'))
    expect(html).toContain('Lineup · Injuries')
    expect(html).toContain('1 questionable')
    expect(html).toContain('on your roster tagged')
    expect(html).toContain('Act now')
    expect(html).toContain('No starter is ruled out.')
    expect(html).toContain('Keep an eye on')
    expect(html).toContain('Puka Nacua')
    expect(html).toContain('Locked — kicked off')
    expect(html).toContain('Fill-ins')
    expect(html).toContain('Depth charts are not available, so successors cannot be named.')
    expect(html).toContain('No official injury report for week 7 yet — Sleeper tags only.')
  })

  it('opens the Replacement Finder for a tagged player', async () => {
    const s = await demoServices()
    const context = s.injuries.context!
    const injured = s.injuries.roster[0]!
    const html = text(renderToString(
      <StaticAppProvider services={s}>
        <div className="fcc"><ReplacementFinder model={s.injuries} context={context} injured={injured} onClose={() => {}} /></div>
      </StaticAppProvider>,
    ))
    expect(html).toContain('Replacement Finder')
    expect(html).toContain(`Fill for ${injured.name}`)
    expect(html).toContain('Projected this week')
    expect(html).toContain('Make the move in Sleeper')
  })
})
