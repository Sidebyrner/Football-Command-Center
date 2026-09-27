/**
 * The Research, Power Rankings and Odds tools render on the design system:
 * a ScreenHero at the top, token-styled cards, and none of the old dark-only
 * classes or the retired Header. Server-rendered, so effects (and fetches)
 * don't run — this checks the initial render.
 */
import React, { type ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The old tools read localStorage directly (caches, quota); give node one
// before their modules load.
vi.hoisted(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const data = new Map<string, string>()
    globalThis.localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, String(v)) },
      removeItem: (k: string) => { data.delete(k) },
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() { return data.size },
    } as Storage
  }
})
// Zustand's server snapshot is always the store's initial state, so a test
// couldn't choose the league or key. Read the live state instead (the render
// is one-shot, so it needn't subscribe).
vi.mock('../../store/useAppStore', async (importOriginal) => {
  const { default: store } = await importOriginal<typeof import('../../store/useAppStore')>()
  const hook = (selector: (s: unknown) => unknown = (s) => s) => selector(store.getState())
  return { default: Object.assign(hook, store) }
})

import Odds from '../../pages/Odds'
import PowerRankings from '../../pages/PowerRankings'
import Research from '../../pages/Research'
import useAppStore from '../../store/useAppStore'

// Vitest has no React plugin, so the legacy .jsx files compile to the classic
// `React.createElement` runtime; give them the global the Vite build injects.
;(globalThis as { React?: typeof React }).React = React

const OLD_LOOK = [/text-black/, /emerald-|rose-|amber-\d/, /bg-gradient/, /bg-slate/, /text-white/, /text-gray/, /bg-gray/, /h-screen/, /bg-\[#/, /--color-/, /#0f172a|#1e293b|#020617/i]

function render(Tool: ComponentType): string {
  return renderToString(
    <MemoryRouter initialEntries={['/tools']}>
      <div className="fcc"><Tool /></div>
    </MemoryRouter>,
  )
}

function expectNewLook(html: string) {
  expect(html).toContain('class="hero"')
  for (const pattern of OLD_LOOK) expect(html).not.toMatch(pattern)
  // The old Header drew an h1 with the page title; the shell's title bar replaces it.
  expect(html).not.toContain('<h1')
}

describe('Research, Power Rankings and Odds tools', () => {
  beforeEach(() => {
    useAppStore.setState({ leagueId: '1', sleeperUserId: 'u1', leagueName: 'Test League', season: '2026', currentWeek: 3, oddsApiKey: '' })
  })

  it('Research: hero, filter bar with labelled controls, empty state', () => {
    const html = render(Research)
    expectNewLook(html)
    expect(html).toContain('Tools · Research')
    expect(html).toContain('aria-label="Search research items"')
    expect(html).toContain('aria-label="Filter by position"')
    expect(html).toContain('Defense vs position')
    expect(html).toContain('Load sample items')
    expect(html).toContain('About this data')
  })

  it('Power Rankings: hero and a loading state', () => {
    const html = render(PowerRankings)
    expectNewLook(html)
    expect(html).toContain('Tools · Power Rankings')
    expect(html).toContain('Test League')
  })

  it('Odds without a key: asks for one inline, not in the old Settings', () => {
    const html = render(Odds)
    expectNewLook(html)
    expect(html).toContain('Tools · Odds')
    expect(html).toContain('Odds API key')
    expect(html).toContain('type="password"')
    expect(html).toContain('Save key')
    expect(html).not.toContain('/classic/settings')
  })

  it('Odds with a key: shows it saved with Change and Remove, and a refresh action', () => {
    useAppStore.setState({ oddsApiKey: 'abcd1234' })
    const html = render(Odds)
    expectNewLook(html)
    expect(html).toMatch(/Odds API key saved in this browser \(ends …(<!-- -->)?1234(<!-- -->)?\)/)
    expect(html).toContain('>Change<')
    expect(html).toContain('Remove')
    expect(html).toContain('Refresh')
  })
})
