/**
 * The Draft and Draft Plan tools on the design system: rendered to HTML
 * (effects don't run on the server, so this is the first, loading render)
 * and checked for the new structure and the absence of the old dark-only look.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import React, { type ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import DraftDashboard from '../../pages/DraftDashboard'
import MockDraft from '../../pages/MockDraft'
import PlayerTable from '../../components/draft/PlayerTable'
import PlayerDrawer from '../../components/draft/PlayerDrawer'
import TeamGradeRow from '../../components/draft/TeamGradeRow'
import TargetCard from '../../components/mockdraft/TargetCard'

// Vitest has no React plugin, so the legacy .jsx files compile to the classic
// `React.createElement` runtime; give them the global the Vite build injects.
;(globalThis as { React?: typeof React }).React = React

const render = (Page: ComponentType) =>
  renderToString(
    <MemoryRouter>
      <div className="fcc">
        <Page />
      </div>
    </MemoryRouter>,
  )

// Old dark-only styling that must not come back.
const OLD_LOOK = /bg-slate|text-white|text-gray|bg-gray|text-black|bg-\[#|emerald-|rose-|bg-gradient|h-screen|--color-/

describe('Draft tool', () => {
  const html = render(DraftDashboard)

  it('opens with the hero, toolbar and a loading board', () => {
    expect(html).toContain('class="hero"')
    expect(html).toContain('Tools · Draft')
    expect(html).toContain('Refresh')
    expect(html).toContain('Practice with a Sleeper mock draft')
    expect(html).toContain('dd-table')
    expect(html).toContain('dd-skel')
  })

  it('has labelled filters and sortable headers as buttons', () => {
    expect(html).toContain('placeholder="Search players…"')
    expect(html).toContain('aria-label="Team"')
    expect(html).toContain('aria-label="Injury status"')
    expect(html).toMatch(/class="dd-th dd-sort[^"]*"/)
    expect(html).toContain('aria-pressed="false"')
  })

  it('drops the old header and dark classes', () => {
    expect(html).not.toContain('<header class="h-14')
    expect(html).not.toMatch(OLD_LOOK)
  })
})

describe('Draft Plan tool', () => {
  const html = render(MockDraft)

  it('opens with the hero and toolbar', () => {
    expect(html).toContain('class="hero"')
    expect(html).toContain('Tools · Draft plan')
    expect(html).toContain('Sort by ADP')
    expect(html).toContain('Clear')
  })

  it('shows loading placeholders, not old text', () => {
    expect(html).toContain('loading-stack')
    expect(html).not.toMatch(OLD_LOOK)
  })
})

describe('Draft pieces with data', () => {
  const players = [
    { id: '1', name: 'Test Runner', position: 'RB', team: 'KC', adp: 12, bye: 10, injuryStatus: 'Questionable', trending: 'add' },
    { id: '2', name: 'Test Catcher', position: 'WR', team: 'BUF', adp: 20, bye: 7, injuryStatus: null, trending: 'drop' },
  ]

  it('renders the board rows with tokens, chips and real buttons', () => {
    const html = renderToString(
      <PlayerTable
        players={players}
        loading={false}
        sort={{ col: 'adp', dir: 'asc' }}
        onSort={() => {}}
        watchlist={new Set(['1'])}
        onToggleWatch={() => {}}
        onSelectPlayer={() => {}}
        researchIndex={{ '1': 2 }}
        scores={{ '1': { available: true, score: 88, coverage: 1 } }}
        valueDeltas={{ '1': 3 }}
        footer="Player data from Sleeper"
      />,
    )
    expect(html).toContain('position-chip')
    expect(html).toContain('Test Runner — open details')
    expect(html).toContain('Remove Test Runner from watchlist')
    expect(html).toContain('dd-trend add')
    expect(html).toContain('dd-trend drop')
    expect(html).toContain('aria-sort="ascending"')
    expect(html).toContain('2 players')
    expect(html).not.toMatch(OLD_LOOK)
  })

  it('renders the player drawer as a labelled dialog sheet', () => {
    const html = renderToString(
      <PlayerDrawer player={players[0]} watchlist={new Set()} onToggleWatch={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain('class="dd-drawer-scrim"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Close drawer"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('var(--caution)')
    expect(html).not.toMatch(OLD_LOOK)
  })

  it('renders a grade row and a target card on tokens', () => {
    const grade = renderToString(
      <TeamGradeRow team={{ grade: 'B', name: 'Walnuts', isMe: true, valueScore: 70, constructionScore: 80, neededPositions: [], lineupScore: 120, startersFilled: 5, totalStarterSlots: 9 }} />,
    )
    expect(grade.replace(/<!-- -->/g, '')).toContain('Walnuts (you)')
    expect(grade).toContain('var(--accent)')
    expect(grade).not.toMatch(OLD_LOOK)

    const card = renderToString(
      <ul>
        <TargetCard
          target={{ id: 't', playerId: '1', playerName: 'Test Runner', playerTeam: 'KC', playerPosition: 'RB', adp: 12, bye: 10, note: '', fallbacks: [{ playerId: '2', playerName: 'Backup Back', adp: 40 }] }}
          index={0}
          isFirst
          isLast
          players={players}
          draftedIds={new Set(['1'])}
          pickByPlayer={{ '1': { by: 'Rival' } }}
          onMove={() => {}}
          onRemove={() => {}}
          onNote={() => {}}
          onAddFallback={() => {}}
          onRemoveFallback={() => {}}
        />
      </ul>,
    )
    expect(card).toContain('Gone — Rival')
    expect(card).toContain('Pivot here')
    expect(card).toContain('Remove fallback Backup Back')
    expect(card).not.toMatch(OLD_LOOK)
  })
})

describe('Draft tool sources', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const files = [
    'pages/DraftDashboard.jsx',
    'pages/MockDraft.jsx',
    ...readdirSync(`${root}components/draft`).map((f) => `components/draft/${f}`),
    ...readdirSync(`${root}components/mockdraft`).map((f) => `components/mockdraft/${f}`),
  ]

  it('carry no hard-coded dark colours or old header', () => {
    for (const file of files) {
      const text = readFileSync(`${root}${file}`, 'utf8')
      expect(text, file).not.toMatch(/bg-slate|text-white|text-gray|bg-gray|#0[0-9a-fA-F]|components\/layout\/Header/)
      expect(text, file).not.toMatch(/--color-/)
    }
  })
})
