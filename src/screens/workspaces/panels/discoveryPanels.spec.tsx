import type { ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AppServices } from '@models/app/AppServices'
import { discoveryColumn } from '@models/market/DiscoveryModel'
import { PlayerSchedule } from '@models/market/PlayerSchedule'
import { NO_PANEL_COMPARE, NO_PANEL_SETTINGS_UPDATE } from '@models/workspaces/PanelEnvironment'
import { defaultPanelSettings, type LinkGroup, type PanelSettings } from '@models/workspaces/Workspace'
import { StaticAppProvider } from '@ui/app/AppContext'
import { demoServices } from '../../../../tests/renderScreen'
import {
  DiscoveryListPanel, GameLogPanel, PlayerNewsPanel, PlayerProfilePanel, PlayerSearchPanel, SchedulePanel,
} from './DiscoveryPanels'
import { discoveryFootnote, formatDiscoveryValue, ordinal, waiverBadge } from './discoveryFormat'
import { PanelEnvProvider, type PanelProps } from './PanelEnv'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function render(services: AppServices, Panel: (p: PanelProps) => ReactElement, opts: { group?: LinkGroup; settings?: PanelSettings; rows?: number } = {}): string {
  const group = opts.group
  return renderToString(
    <MemoryRouter initialEntries={['/workspaces']}>
      <StaticAppProvider services={services}>
        <PanelEnvProvider value={{
          inWorkspacePanel: true,
          linkGroup: group,
          linkPublish: { group, handler: (change) => { if (group !== undefined) services.linkBus.publish(change, group) } },
          compare: NO_PANEL_COMPARE,
          settingsUpdate: NO_PANEL_SETTINGS_UPDATE,
          inline: false,
        }}>
          <div className="fcc"><Panel settings={opts.settings ?? defaultPanelSettings()} rows={opts.rows ?? 10} /></div>
        </PanelEnvProvider>
      </StaticAppProvider>
    </MemoryRouter>,
  ).replaceAll('<!-- -->', '')
}

/** A rostered skill player, published to link group 1, with his card loaded. */
async function linked() {
  const services = await demoServices()
  const context = services.dashboard.context
  if (!context) throw new Error('demo league did not load')
  const team = context.userTeam
  if (!team) throw new Error('no user team')
  const id = team.starterIDs.find((p) => !['K', 'DEF'].includes(context.position(p) ?? '')) ?? team.starterIDs[0]!
  services.linkBus.publish({ kind: 'player', playerID: id }, 1)
  const card = services.playerCard(id, context)
  await card.load()
  return { services, context, id, card }
}

describe('Discovery list panel', () => {
  it('lists free agents with search, bench toggle, menus and a footnote', async () => {
    const services = await demoServices()
    const model = services.discovery
    expect(model.context).toBeDefined()
    const html = render(services, DiscoveryListPanel, { group: 1, rows: 5 })
    expect(html).toContain('placeholder="Search players or teams"')
    expect(html).toContain('Rival benches')
    expect(html).toContain('All positions')
    expect(html).toContain('aria-label="Sort"')
    const rows = model.rows(undefined, undefined)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows.slice(0, 5)) expect(html).toContain(esc(row.name))
    if (rows.length > 5) expect(html).not.toContain(`>${esc(rows[5]!.name)}<`)
    expect(html).toContain(`${Math.min(5, rows.length)} of ${rows.length} shown`)
    expect(html).toContain('ranked by')
  })

  it('uses the panel’s own position and sort, hiding those menus', async () => {
    const services = await demoServices()
    const html = render(services, DiscoveryListPanel, { settings: { positionFilter: 'RB', extra: { sort: 'name' } } })
    expect(html).not.toContain('aria-label="Position"')
    expect(html).not.toContain('aria-label="Sort"')
    expect(html).toContain('ranked by name')
    const rows = services.discovery.rows('RB', { kind: 'name' })
    expect(rows.every((r) => r.position === 'RB')).toBe(true)
    if (rows[0]) expect(html).toContain(esc(rows[0].name))
  })

  it('says nobody matches a search that finds no one', async () => {
    const services = await demoServices()
    const model = services.discovery
    model.query = 'zzqqxxnobody'
    try {
      const html = render(services, DiscoveryListPanel)
      expect(html).toContain('Nobody matches “zzqqxxnobody”.')
    } finally {
      model.query = ''
    }
  })
})

describe('Linked detail panels', () => {
  it('ask for a link colour when unlinked, and for a click when nothing is linked', async () => {
    const services = await demoServices()
    expect(render(services, PlayerProfilePanel)).toContain('Pick a link colour on this panel')
    expect(render(services, GameLogPanel, { group: 4 })).toContain('Click a player in any')
  })

  it('Profile shows the header, status rows and the grade', async () => {
    const { services, card } = await linked()
    const html = render(services, PlayerProfilePanel, { group: 1 })
    expect(html).toContain(esc(card.name))
    expect(html).toContain('Grade')
    expect(card.status).toBeDefined()
    if (card.status) {
      expect(html).toContain('Status')
      expect(html).toContain('Depth')
      if (card.status.byeWeek !== undefined) expect(html).toContain(`Week ${card.status.byeWeek}`)
    }
    if (card.grade?.score === undefined) expect(html).toContain('not enough data yet')
    else expect(html).toContain(`>${card.grade.score}<`)
  })

  it('News shows the player and the empty state', async () => {
    const { services, card } = await linked()
    const html = render(services, PlayerNewsPanel, { group: 1 })
    expect(html).toContain(esc(card.name))
    if (card.news.length === 0) {
      expect(html).toContain(card.newsUnavailable ? 'News couldn’t be loaded.' : esc(`No recent news on ${card.name}.`))
    }
  })

  it('Game log shows the last game and a table', async () => {
    const { services, card } = await linked()
    const saved = card.log
    try {
      const html0 = render(services, GameLogPanel, { group: 1 })
      if (saved.length === 0) expect(html0).toContain('No games logged this season.')
      card.log = [
        { week: 3, played: false },
        { week: 2, opponent: 'MIN', played: true, points: 18.4, snapShare: 0.71, targets: 5, expectedPoints: 14.2, projected: 15.1 },
        { week: 1, opponent: 'DAL', played: true, points: 9.6, rushAttempts: 14, projected: 13.0 },
      ]
      const html = render(services, GameLogPanel, { group: 1, rows: 2 })
      expect(html).toContain('Last game')
      expect(html).toContain('Week 2 vs MIN')
      expect(html).toContain('18.4')
      expect(html).toContain('+3.3 vs proj')
      expect(html).toContain('DNP')
      expect(html).toContain('71%')
      expect(html).toContain('xFP')
      expect(html).not.toContain('DAL') // rows = 2
      expect(html).toContain('projections Rotowire via Sleeper')
    } finally {
      card.log = saved
    }
  })

  it('Schedule shows strength of schedule, the weeks and the footnote', async () => {
    const { services, context, id } = await linked()
    const schedule = PlayerSchedule.build(id, context, services.discovery.defense)
    const html = render(services, SchedulePanel, { group: 1 })
    expect(schedule.weeks.length).toBeGreaterThan(0)
    expect(html).toContain('Def rank')
    expect(html).toContain(schedule.strengthOfSchedule === undefined ? 'Not enough defense data yet' : 'rest-of-season SoS')
    expect(html).toContain('Def rank: 1 is the softest vs')
    const firstGame = schedule.weeks.find((w) => !w.isBye && w.opponent !== undefined)
    if (firstGame) expect(html).toContain(`${firstGame.isHome === false ? '@' : ''}${firstGame.opponent}`)
    if (schedule.weeks.some((w) => w.isBye)) expect(html).toContain('BYE')
  })
})

describe('Player search panel', () => {
  it('prompts for a name and warns without a link colour', async () => {
    const services = await demoServices()
    const html = render(services, PlayerSearchPanel)
    expect(html).toContain('Type a name. Click to focus, ＋ to compare.')
    expect(html).toContain('Pick a link colour so clicks reach other panels.')
  })

  it('pins the compared players at the top', async () => {
    const { services, context, id } = await linked()
    services.linkBus.publish({ kind: 'addCompare', playerID: id }, 2)
    try {
      const html = render(services, PlayerSearchPanel, { group: 2 })
      expect(html).toContain('COMPARING')
      expect(html).toContain(esc(`Remove ${context.playerName(id)} from compare`))
      expect(html).toContain('Type to add more.')
      expect(html).not.toContain('Pick a link colour')
    } finally {
      services.linkBus.publish({ kind: 'clearCompare' }, 2)
    }
  })
})

describe('Discovery formatting', () => {
  it('formats cells, badges, ordinals and the footnote as Swift does', () => {
    expect(formatDiscoveryValue(undefined, 'projected')).toBe('—')
    expect(formatDiscoveryValue(0.456, 'snapShare')).toBe('46%')
    expect(formatDiscoveryValue(12.9, 'trending')).toBe('12')
    expect(formatDiscoveryValue(2.34, 'projectedOverLine')).toBe('+2.3')
    expect(formatDiscoveryValue(11.25, 'projected')).toBe('11.2')
    expect(waiverBadge('Questionable')).toBe('Q')
    expect(waiverBadge('Out')).toBe('Out')
    expect(waiverBadge('')).toBeUndefined()
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(13)).toBe('13th')
    expect(discoveryFootnote(1, [], discoveryColumn('projected'), true)).toBe('1 of 0 shown · ranked by projected this week · ⌘-click to compare.')
  })
})
