import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { Router } from '@models/navigation/Router'
import { screenPlace, workspacePlace } from '@models/navigation/NavigationHistory'
import { makePanelPlacement, type PanelKind, type PanelPlacement } from '@models/workspaces/Workspace'
import * as G from '@models/workspaces/WorkspaceGeometry'
import { StaticAppProvider } from '@ui/app/AppContext'
import { placeForPath, useNavigationStore } from '@ui/shell/navigationStore'
import { demoServices } from '../../../tests/renderScreen'
import {
  canvasWidth, dragChanged, dragEnded, dropRect, liveSize, nudged, removed, rowsHeight, shownRows,
} from './gridDrag'
import { PanelLibrarySheet } from './PanelLibrarySheet'
import { panelHostTitle } from './PanelHost'
import { WorkspaceScreen, WorkspaceToolbar, addTrayItem } from './WorkspaceScreen'
import { WorkspaceSidebarSection } from './WorkspaceSidebar'
import { useWorkspaceUI } from './workspaceUIStore'

const panel = (x: number, y: number, w: number, h: number, kind: PanelKind = 'news'): PanelPlacement =>
  makePanelPlacement({ kind, frame: { x, y, w, h } })

const frameOf = (panels: PanelPlacement[] | undefined, p: PanelPlacement) => panels?.find((q) => q.id === p.id)?.frame

// A 1100pt container: a 1068pt canvas, 78pt cells, so one column is 90pt and one row 108pt.
const cellW = G.cellWidth(canvasWidth(1100))

describe('grid drag maths', () => {
  it('lays out at the container width less the padding, never narrower than 320', () => {
    expect(canvasWidth(1100)).toBe(1068)
    expect(canvasWidth(100)).toBe(320)
    expect(cellW).toBe(78)
  })

  it('a move snaps to whole cells and pushes what is in the way straight down', () => {
    const a = panel(0, 0, 4, 2)
    const b = panel(4, 0, 4, 2)
    // Just over half a column right: one cell.
    const drag = dragChanged(undefined, [a, b], a, 'move', { width: 50, height: 0 }, cellW)
    expect(drag.candidate).toEqual({ x: 1, y: 0, w: 4, h: 2 })
    expect(frameOf(drag.preview, b)).toEqual({ x: 4, y: 2, w: 4, h: 2 })
    // Four columns right lands on b's spot; b goes below.
    const over = dragChanged(drag, [a, b], a, 'move', { width: 360, height: 0 }, cellW)
    expect(over.candidate).toEqual({ x: 4, y: 0, w: 4, h: 2 })
    expect(frameOf(over.preview, b)).toEqual({ x: 4, y: 2, w: 4, h: 2 })
  })

  it('reuses the preview while the pointer stays in one cell', () => {
    const a = panel(0, 0, 4, 2)
    const first = dragChanged(undefined, [a], a, 'move', { width: 100, height: 0 }, cellW)
    const second = dragChanged(first, [a], a, 'move', { width: 110, height: 5 }, cellW)
    expect(second.preview).toBe(first.preview)
    expect(second.translation).toEqual({ width: 110, height: 5 })
  })

  it('ending a drag settles everything up; ending where it started changes nothing', () => {
    const a = panel(0, 0, 4, 2)
    const b = panel(0, 2, 4, 2)
    // a dragged three rows down, below b: b floats to the top.
    const drag = dragChanged(undefined, [a, b], a, 'move', { width: 0, height: 330 }, cellW)
    const settled = dragEnded(drag)!
    expect(frameOf(settled, b)).toEqual({ x: 0, y: 0, w: 4, h: 2 })
    expect(frameOf(settled, a)).toEqual({ x: 0, y: 2, w: 4, h: 2 })
    expect(dragEnded(dragChanged(undefined, [a, b], a, 'move', { width: 20, height: 20 }, cellW))).toBeUndefined()
  })

  it('a resize never goes below the panel minimum, drawn or snapped', () => {
    const p = panel(0, 0, 4, 4, 'sitStart') // minimum 4×3
    const drag = dragChanged(undefined, [p], p, 'resize', { width: -400, height: -400 }, cellW)
    expect(drag.candidate).toEqual({ x: 0, y: 0, w: 4, h: 3 })
    const size = liveSize(G.frame(p.frame, cellW), drag, p, cellW)
    expect(size).toEqual({ width: G.frame({ x: 0, y: 0, w: 4, h: 3 }, cellW).width, height: G.frame({ x: 0, y: 0, w: 4, h: 3 }, cellW).height })
    // Other panels keep their frame size.
    const other = panel(4, 0, 2, 2)
    expect(liveSize(G.frame(other.frame, cellW), drag, other, cellW)).toEqual({ width: 168, height: 204 })
  })

  it('nudges one cell, pushing and settling, and refuses to leave the grid', () => {
    const a = panel(0, 0, 4, 2)
    const b = panel(4, 0, 4, 2)
    const right = nudged([a, b], a, 1, 0, 0, 0)!
    expect(frameOf(right, a)).toEqual({ x: 1, y: 0, w: 4, h: 2 })
    expect(frameOf(right, b)).toEqual({ x: 4, y: 2, w: 4, h: 2 })
    expect(nudged([a, b], a, -1, 0, 0, 0)).toBeUndefined()
    // Narrower than the minimum (3×2 for News) is no step at all.
    expect(nudged([panel(0, 0, 3, 2)], panel(0, 0, 3, 2), 0, 0, -1, 0)).toBeUndefined()
    const wider = nudged([a], a, 0, 0, 1, 1)!
    expect(wider[0]!.frame).toEqual({ x: 0, y: 0, w: 5, h: 3 })
  })

  it('a tray drop puts the top-left corner at the cell under the pointer, kept on the grid', () => {
    expect(dropRect({ x: 200, y: 120 }, { w: 4, h: 5 }, cellW)).toEqual({ x: 2, y: 1, w: 4, h: 5 })
    expect(dropRect({ x: 1060, y: 0 }, { w: 4, h: 5 }, cellW)).toEqual({ x: 8, y: 0, w: 4, h: 5 })
    expect(dropRect({ x: -30, y: -30 }, { w: 14, h: 1 }, cellW)).toEqual({ x: 0, y: 0, w: 12, h: 1 })
  })

  it('draws two spare rows while editing, and room for the drag', () => {
    const panels = [panel(0, 0, 4, 8)]
    expect(shownRows(panels, false)).toBe(8)
    expect(shownRows(panels, true)).toBe(10)
    const drag = dragChanged(undefined, panels, panels[0]!, 'move', { width: 0, height: 1300 }, cellW)
    // Twelve rows down: the panel's bottom at 20, plus the two spare rows.
    expect(drag.candidate.y).toBe(12)
    expect(shownRows(drag.preview, true, drag)).toBe(22)
    expect(shownRows([], false, drag)).toBe(21)
    expect(rowsHeight(2)).toBe(G.ROW_HEIGHT * 2 + G.GUTTER)
  })

  it('removing a panel floats the rest up', () => {
    const a = panel(0, 0, 4, 2)
    const b = panel(0, 2, 4, 2)
    expect(removed([a, b], a.id)).toEqual([{ ...b, frame: { x: 0, y: 0, w: 4, h: 2 } }])
  })

  it('clicking a tray item drops it in the first free slot, linked Blue when it links', () => {
    const ws = { id: 'w', name: 'W', icon: 'star', panels: [panel(0, 0, 6, 3)] }
    const { panels, added } = addTrayItem(ws, { kind: 'panel', panel: 'playerCard' })
    const p = panels.find((q) => q.id === added)!
    expect(p.frame).toEqual({ x: 6, y: 0, w: 4, h: 5 })
    expect(p.linkGroup).toBe(1)
    const metric = addTrayItem(ws, { kind: 'metric', metric: 'targets' })
    const m = metric.panels.find((q) => q.id === metric.added)!
    expect(m.settings.extra).toEqual({ metric: 'targets', scope: 'player' })
    expect(panelHostTitle(m)).toBe('Targets')
  })
})

describe('workspace URLs', () => {
  it('reads a workspace or a screen from the path', () => {
    expect(placeForPath('/workspaces/0f8fad5b-d9cb-469f-a165-70867728950e')).toEqual(workspacePlace('0F8FAD5B-D9CB-469F-A165-70867728950E'))
    expect(placeForPath('/lineup/matchup')).toEqual(screenPlace('matchup'))
    expect(placeForPath('/nowhere')).toBeUndefined()
  })
})

const seedNavigation = (router: Router) => useNavigationStore.setState({ router })
const seedUI = (patch: { panelTrayExpanded?: boolean }) => useWorkspaceUI.setState(patch)

describe('workspace views', () => {
  afterEach(() => {
    useNavigationStore.setState({ router: Router.at(screenPlace('board')), started: false })
    useWorkspaceUI.setState({ selectedPanelID: undefined, showPanelLibrary: false, panelTrayExpanded: true, trayDrag: undefined })
  })

  async function render(node: ReactNode, path = '/board') {
    const services = await demoServices()
    return renderToString(
      <MemoryRouter initialEntries={[path]}>
        <StaticAppProvider services={services}>
          <div className="fcc">{node}</div>
        </StaticAppProvider>
      </MemoryRouter>,
    )
  }

  async function preset(id: string) {
    const services = await demoServices()
    const workspace = services.workspaces.workspaces.find((w) => w.presetID === id)
    if (!workspace) throw new Error(`no ${id} workspace`)
    return workspace
  }

  it('draws a preset workspace locked: every panel with its title, options and full-screen link', async () => {
    const gameDay = await preset('game-day')
    seedNavigation(Router.at(workspacePlace(gameDay.id)))
    const html = await render(<WorkspaceScreen id={gameDay.id} />, `/workspaces/${gameDay.id}`)
    for (const title of ['Matchup', 'Lineup readiness', 'Sit/Start', 'Injuries', 'News', 'Player Card', 'Standings']) {
      expect(html).toContain(`>${title}</span>`)
    }
    expect(html).toContain('data-panel="matchupScore"')
    expect(html).toContain('Open Sit/Start')
    expect(html).toContain('Injuries options')
    expect(html).toContain('Link colour Blue')
    // Locked: no tray, no handles, no backdrop.
    expect(html).not.toContain('Click to add, or drag onto the grid.')
    expect(html).not.toContain('Drag to resize')
    expect(html).not.toContain('ws-backdrop')
  })

  it('unlocked, shows the backdrop grid, handles and the tray of panels and metrics', async () => {
    const lab = await preset('comparison-lab')
    seedNavigation(Router.at(workspacePlace(lab.id)).withWorkspaceEditing(true))
    const html = await render(<WorkspaceScreen id={lab.id} />, `/workspaces/${lab.id}`)
    expect(html).toContain('ws-backdrop')
    expect(html).toContain('Drag to resize')
    expect(html).toContain('Remove Compare')
    expect(html).toContain('Arrange Metric')
    // Metric panels are titled by their metric.
    expect(html).toContain('>Fantasy points</span>')
    expect(html).toContain('>Expected points (xFP)</span>')
    // The tray.
    expect(html).toContain('Click to add, or drag onto the grid.')
    for (const section of ['This week', 'Market', 'Season', 'Discovery', 'Metrics', 'Players', 'One metric']) {
      expect(html).toContain(`>${section}</div>`)
    }
    expect(html).toContain('Add Waiver targets')
    expect(html).toContain('data-token="metric:airYards"')
    expect(html).toContain('draggable="true"')
  })

  it('the tray collapses to an icon strip', async () => {
    const lab = await preset('comparison-lab')
    seedNavigation(Router.at(workspacePlace(lab.id)).withWorkspaceEditing(true))
    seedUI({ panelTrayExpanded: false })
    const html = await render(<WorkspaceScreen id={lab.id} />)
    expect(html).toContain('Show the panel tray')
    expect(html).not.toContain('Click to add, or drag onto the grid.')
    expect(html).toContain('Add Standings')
  })

  it('an empty workspace offers a panel or a preset; a deleted one says so', async () => {
    const services = await demoServices()
    const empty = services.workspaces.addEmpty()
    let html = await render(<WorkspaceScreen id={empty.id} />)
    expect(html).toContain('An empty workspace')
    expect(html).toContain('Add a panel')
    expect(html).toContain('Start from a preset')
    services.workspaces.delete(empty.id)
    html = await render(<WorkspaceScreen id={empty.id} />)
    expect(html).toContain('Workspace removed')
    expect(html).toContain('Pick another from the sidebar, or make a new one.')
  })

  it('the toolbar: Edit layout when locked; Add panel and Done when unlocked', async () => {
    const trade = await preset('trade-desk')
    let html = await render(<WorkspaceToolbar id={trade.id} />)
    expect(html).toContain('Edit layout')
    expect(html).toContain('Unlock to move, resize and add panels (⌘E)')
    expect(html).not.toContain('Add panel')
    seedNavigation(Router.at(workspacePlace(trade.id)).withWorkspaceEditing(true))
    html = await render(<WorkspaceToolbar id={trade.id} />)
    expect(html).toContain('Done')
    expect(html).toContain('Lock the layout (⌘E)')
    expect(html).toContain('Add panel')
    expect(html).toContain('aria-label="Workspace"')
  })

  it('the panel library lists every group and marks what is already there', async () => {
    const html = await render(
      <PanelLibrarySheet existing={new Set<PanelKind>(['news'])} onAdd={() => {}} onAddMany={() => {}} onClose={() => {}} />,
    )
    expect(html).toContain('Add a panel')
    expect(html).toContain('On this workspace')
    expect(html).toContain('Tick Lineup readiness')
    expect(html).toContain('Add Player search')
    expect(html).toContain('disabled=""')
  })

  it('the sidebar lists every workspace, with the open one current', async () => {
    const services = await demoServices()
    const current = services.workspaces.workspaces[1]!
    const html = await render(<WorkspaceSidebarSection currentID={current.id} />)
    expect(html).toContain('Workspaces')
    expect(html).toContain('New workspace')
    for (const name of ['Game day', 'Waiver Tuesday', 'Trade desk', 'Discovery', 'Comparison lab']) {
      expect(html).toContain(`>${name}</span>`)
    }
    expect(html).toContain(`data-workspace-row="${current.id}"`)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
})
