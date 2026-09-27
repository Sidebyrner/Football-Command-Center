import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { BoardLayout } from '@models/team/BoardTile'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { StaticAppProvider } from '@ui/app/AppContext'
import { BoardEditSheet } from './BoardEditSheet'
import { BOARD_LAYOUT_KEY, BoardScreen } from './BoardScreen'
import { LiveBadge } from './LiveIndicators'

/** A stand-in `localStorage` holding one saved layout. */
function stubLayout(value: string | undefined) {
  const items = new Map<string, string>(value === undefined ? [] : [[BOARD_LAYOUT_KEY, value]])
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => { items.set(k, v) },
    removeItem: (k: string) => { items.delete(k) },
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Board screen', () => {
  it('renders every standard tile in the demo league', async () => {
    stubLayout(undefined)
    const html = await renderScreen(BoardScreen, '/board')
    expect(html).toContain('Board · Week 7')
    expect(html).toContain('games live')
    expect(html).toContain('Your week at a glance — tap any tile for the full screen.')
    for (const title of ['Matchup', 'Your games', 'Lineup', 'Injuries', 'Best streams', 'Top pickup', 'Standings', 'Weekly scoring', 'Byes', 'News']) {
      expect(html).toContain(title)
    }
    // The live score and managers from the demo matchup.
    expect(html).toContain('86.7')
    expect(html).toContain('Byrne Notice')
    expect(html).toContain('Gridiron Gurus')
    expect(html).toContain('You: 4 to play · Them: 4')
    // Games, streams, standings and the relay note.
    expect(html).toContain('Sleeper scores (undocumented)')
    expect(html).toContain('Gibbs')
    expect(html).toContain('1st')
    expect(html).toContain('News about your players comes through your relay — add one in Settings.')
    expect(html).toContain('LIVE')
  })

  it('follows the saved layout: order and hidden tiles', async () => {
    stubLayout('standings,-liveMatchup,-games,-readiness,-injuries,-topPickup,-streams,-scoringTrend,-news,-byeWeeks')
    const html = await renderScreen(BoardScreen, '/board')
    expect(html).toContain('Standings')
    expect(html).not.toContain('Best streams')
    expect(html).not.toContain('Sleeper scores (undocumented)')
  })

  it('says so when every tile is hidden', async () => {
    const all = BoardLayout.standard
    for (const t of all.order) all.hidden.add(t)
    stubLayout(all.encoded)
    const html = await renderScreen(BoardScreen, '/board')
    expect(html).toContain('No tiles')
    expect(html).toContain('Every tile is hidden.')
    expect(html).toContain('Choose tiles')
  })

  it('draws the edit sheet with every tile, its blurb and the reset button', async () => {
    const services = await demoServices()
    const html = renderToString(
      <StaticAppProvider services={services}>
        <BoardEditSheet layout={BoardLayout.standard} onSave={() => {}} onClose={() => {}} />
      </StaticAppProvider>,
    )
    expect(html).toContain('Board tiles')
    expect(html).toContain('Drag to reorder. Hidden tiles stay here to switch back on.')
    expect(html).toContain('Your score against theirs, live during games')
    expect(html).toContain('Reset to default')
    expect(html).toContain('Move Matchup up')
    expect((html.match(/role="switch"/g) ?? []).length).toBe(10)
  })

  it('labels the live badge for assistive tech', () => {
    expect(renderToString(<LiveBadge />)).toContain('aria-label="Games in progress"')
  })
})
