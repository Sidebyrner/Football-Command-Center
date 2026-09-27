import { describe, expect, it } from 'vitest'
import { Router } from '../../navigation/Router'
import { screenPlace, workspacePlace } from '../../navigation/NavigationHistory'
import { PLAYER_METRICS } from '../../player/PlayerMetrics'
import { LinkBus } from '../LinkBus'
import { InMemoryKeyValueStorage } from '../KeyValueStorage'
import { panelMinSize, panelDefaultSize, panelTitle } from '../PanelKind'
import {
  TRAY_SECTIONS, trayItemFromToken, trayItemPanelKind, trayItemPlacement, trayMetric, trayPanel, trayToken,
} from '../TrayItem'
import {
  PANEL_KINDS, makePanelPlacement, newUUID, parseWorkspaceLibrary, stringifyWorkspaceLibrary,
  type GridRect, type PanelKind, type PanelPlacement,
} from '../Workspace'
import * as G from '../WorkspaceGeometry'
import { ALL_PRESETS, discovery as discoveryPreset, gameDay } from '../WorkspacePresets'
import { InMemoryWorkspacePersistence, StorageWorkspacePersistence, WorkspaceStore } from '../WorkspaceStore'

// Ported from WorkspaceTests.swift (apple/Packages/FCApp/Tests/FCAppTests) —
// the same cases, the same answers. `FileWorkspacePersistence(directory:)`
// becomes `StorageWorkspacePersistence` over one shared in-memory storage.

const panel = (x: number, y: number, w: number, h: number, kind: PanelKind = 'news'): PanelPlacement =>
  makePanelPlacement({ kind, frame: { x, y, w, h } })

const rect = (x: number, y: number, w: number, h: number): GridRect => ({ x, y, w, h })

const frameOf = (panels: PanelPlacement[], p: PanelPlacement) => panels.find((q) => q.id === p.id)?.frame

describe('WorkspaceGeometry', () => {
  it('frames include gutters between cells only', () => {
    const cell = G.cellWidth(12 * 80 + 11 * 12)
    expect(cell).toBeCloseTo(80, 3)
    const frame = G.frame(rect(1, 1, 2, 2), cell)
    expect(frame.x).toBeCloseTo(92, 3)
    expect(frame.width, 'two cells and the one gutter between them').toBeCloseTo(172, 3)
    expect(frame.y).toBeCloseTo(108, 3)
    expect(frame.height).toBeCloseTo(204, 3)
  })

  it('move snaps to the nearest cell and stays on the grid', () => {
    const r = rect(2, 1, 4, 2)
    // Pitch is 92pt across, 108pt down; 50pt rounds to one cell, 40pt to none.
    expect(G.snappedMove(r, { width: 50, height: 40 }, 80)).toEqual(rect(3, 1, 4, 2))
    expect(G.snappedMove(r, { width: 5_000, height: -5_000 }, 80), 'clamped to the right edge and the top')
      .toEqual(rect(8, 0, 4, 2))
    expect(G.snappedMove(r, { width: -5_000, height: 0 }, 80).x).toBe(0)
  })

  it('resize never goes below the minimum or past the edge', () => {
    const r = rect(8, 0, 3, 3)
    const min = { w: 3, h: 2 }
    expect(G.snappedResize(r, { width: -500, height: -500 }, 80, min)).toEqual(rect(8, 0, 3, 2))
    expect(G.snappedResize(r, { width: 900, height: 108 }, 80, min)).toEqual(rect(8, 0, 4, 4))
  })

  it('free spots respect other panels but not the panel being moved', () => {
    const a = panel(0, 0, 6, 2)
    const b = panel(6, 0, 6, 2)
    expect(G.isFree(rect(5, 0, 2, 1), [a, b])).toBe(false)
    expect(G.isFree(rect(1, 0, 5, 2), [a, b], a.id)).toBe(true)
    expect(G.isFree(rect(11, 3, 2, 1), []), 'off the right edge').toBe(false)
    expect(G.firstFreeSlot({ w: 4, h: 2 }, [a, b])).toEqual(rect(0, 2, 4, 2))
    expect(G.firstFreeSlot({ w: 4, h: 2 }, [a])).toEqual(rect(6, 0, 4, 2))
  })

  it('tidy up slides panels up without overlap and is stable', () => {
    const a = panel(0, 3, 6, 2)
    const b = panel(6, 5, 6, 2)
    const c = panel(0, 7, 12, 2)
    const tidy = G.compacted([a, b, c])
    expect(tidy.map((p) => p.frame.y)).toEqual([0, 0, 2])
    expect(tidy.map((p) => p.id), "caller's order kept").toEqual([a.id, b.id, c.id])
    expect(G.validate(tidy)).toEqual([])
    expect(G.compacted(tidy), 'idempotent').toEqual(tidy)
  })

  // MARK: Push and float

  it('widening into a neighbour pushes it down and shrinking floats it back', () => {
    const a = panel(0, 0, 6, 2)
    const b = panel(6, 0, 6, 2)
    const wide = G.layout([a, b], a.id, rect(0, 0, 8, 2))
    expect(frameOf(wide, a), 'the resized panel is exactly where it was put').toEqual(rect(0, 0, 8, 2))
    expect(frameOf(wide, b), 'the neighbour slides straight down, keeping its column').toEqual(rect(6, 2, 6, 2))
    expect(G.validate(wide)).toEqual([])

    const narrowAgain = G.layout(wide, a.id, rect(0, 0, 6, 2))
    expect(frameOf(narrowAgain, b), 'room again, so it floats back up').toEqual(rect(6, 0, 6, 2))
  })

  it('pushes chain down the column', () => {
    const a = panel(0, 0, 4, 2)
    const b = panel(0, 2, 4, 2)
    const c = panel(0, 4, 4, 2)
    const taller = G.layout([a, b, c], a.id, rect(0, 0, 4, 3))
    expect(frameOf(taller, b)?.y).toBe(3)
    expect(frameOf(taller, c)?.y).toBe(5)
    expect(G.validate(taller)).toEqual([])
  })

  it('moving onto a panel swaps them vertically', () => {
    const a = panel(0, 0, 6, 2)
    const b = panel(0, 2, 6, 2)
    const moved = G.settle(G.layout([a, b], b.id, rect(0, 0, 6, 2)))
    expect(frameOf(moved, b)?.y).toBe(0)
    expect(frameOf(moved, a)?.y).toBe(2)
  })

  it('panels beside the change are left alone', () => {
    const a = panel(0, 0, 4, 2)
    const b = panel(4, 0, 4, 2)
    const c = panel(8, 0, 4, 4)
    const taller = G.layout([a, b, c], a.id, rect(0, 0, 4, 5))
    expect(frameOf(taller, b)).toEqual(b.frame)
    expect(frameOf(taller, c)).toEqual(c.frame)
  })

  it('any drag leaves a valid layout and settling is stable', () => {
    const panels = discoveryPreset.panels()
    for (const target of panels) {
      for (const r of [rect(0, 0, 12, 3), rect(5, 2, 7, 6), rect(8, 20, 4, 4)]) {
        const result = G.settle(G.layout(panels, target.id, r))
        expect(G.validate(result).filter((i) => i.kind !== 'belowMinimum')).toEqual([])
        expect(G.settle(result)).toEqual(result)
        expect(result.length).toBe(panels.length)
      }
    }
  })

  it('inserting and appending', () => {
    const a = panel(0, 0, 12, 2)
    const added = makePanelPlacement({ kind: 'news', frame: rect(0, 0, 1, 1) })
    const inserted = G.inserting(added, rect(3, 0, 4, 2), [a])
    expect(frameOf(inserted, added)).toEqual(rect(3, 0, 4, 2))
    expect(frameOf(inserted, a)?.y, 'the full-width panel moves down for the drop').toBe(2)

    const appended = G.appending(['news', 'standings', 'injuries'], [a], () => 1)
    expect(appended.length).toBe(4)
    expect(G.validate(appended)).toEqual([])
    expect(appended[appended.length - 1]?.linkGroup).toBe(1)
  })

  it('drop points map to cells', () => {
    const cell = 80 // pitch 92 across, 108 down
    expect(G.cellAt({ x: 0, y: 0 }, cell)).toEqual({ x: 0, y: 0 })
    expect(G.cellAt({ x: 91, y: 107 }, cell)).toEqual({ x: 0, y: 0 })
    expect(G.cellAt({ x: 92, y: 108 }, cell)).toEqual({ x: 1, y: 1 })
    expect(G.cellAt({ x: 5_000, y: -40 }, cell), 'clamped to the grid').toEqual({ x: 11, y: 0 })
  })

  it('repair fixes overlaps, sizes and bounds', () => {
    const a = panel(0, 0, 2, 1, 'sitStart') // below sitStart's 4x3 minimum
    const b = panel(1, 0, 4, 2) // overlaps a
    const c = panel(11, 0, 4, 2) // off the edge
    expect(G.validate([a, b, c])).not.toEqual([])
    const fixed = G.repaired([a, b, c])
    expect(G.validate(fixed)).toEqual([])
    expect({ w: fixed[0]!.frame.w, h: fixed[0]!.frame.h }).toEqual(panelMinSize('sitStart'))
  })
})

describe('PanelTray', () => {
  it('the tray offers every panel and every metric', () => {
    const items = TRAY_SECTIONS.flatMap(([, items]) => items)
    expect(new Set(items.map(trayItemPanelKind))).toEqual(new Set(PANEL_KINDS))
    expect(items.flatMap((i) => (i.kind === 'metric' ? [i.metric] : []))).toEqual([...PLAYER_METRICS])
  })

  it('drag tokens round-trip', () => {
    for (const item of TRAY_SECTIONS.flatMap(([, items]) => items)) {
      expect(trayItemFromToken(trayToken(item))).toEqual(item)
    }
    expect(trayItemFromToken('panel:hologram')).toBeUndefined()
    expect(trayItemFromToken('nonsense')).toBeUndefined()
  })

  it('a metric from the tray arrives set to its stat', () => {
    const p = trayItemPlacement(trayMetric('targets'), rect(0, 0, 4, 3))
    expect(p.kind).toBe('metric')
    expect(p.settings.extra.metric).toBe('targets')
    expect(p.linkGroup).toBe(1)
    expect(trayItemPlacement(trayPanel('news'), rect(0, 0, 3, 2)).linkGroup, "news doesn't link").toBeUndefined()
  })
})

describe('WorkspacePresets', () => {
  it('every preset is a valid layout', () => {
    for (const preset of ALL_PRESETS) {
      const panels = preset.panels()
      expect(G.validate(panels), preset.name).toEqual([])
      expect(new Set(panels.map((p) => p.id)).size, preset.name).toBe(panels.length)
    }
  })

  it('every panel kind is in some preset', () => {
    const used = new Set(ALL_PRESETS.flatMap((p) => p.panels().map((q) => q.kind)))
    expect(used).toEqual(new Set(PANEL_KINDS))
  })

  it('every panel fits in its default size and minimum', () => {
    for (const kind of PANEL_KINDS) {
      expect(panelMinSize(kind).w, panelTitle(kind)).toBeLessThanOrEqual(panelDefaultSize(kind).w)
      expect(panelMinSize(kind).h, panelTitle(kind)).toBeLessThanOrEqual(panelDefaultSize(kind).h)
    }
  })
})

describe('WorkspaceStore', () => {
  it('a first launch seeds the presets and saves them', () => {
    const persistence = new StorageWorkspacePersistence(new InMemoryKeyValueStorage())
    const store = new WorkspaceStore(persistence)
    expect(store.workspaces.map((w) => w.name)).toEqual(ALL_PRESETS.map((p) => p.name))
    expect(persistence.load()?.workspaces.length).toBe(ALL_PRESETS.length)
  })

  it('edits survive a relaunch', () => {
    const storage = new InMemoryKeyValueStorage()
    const store = new WorkspaceStore(new StorageWorkspacePersistence(storage))
    const id = store.workspaces[0]!.id
    store.rename(id, 'Sunday')
    store.update(id, (w) => { w.panels.pop() })
    const added = store.addEmpty()
    store.flush()

    const reopened = new WorkspaceStore(new StorageWorkspacePersistence(storage))
    expect(reopened.workspace(id)?.name).toBe('Sunday')
    expect(reopened.workspace(id)?.panels.length).toBe(gameDay.panels().length - 1)
    expect(reopened.workspace(added.id)).toBeDefined()
  })

  it('duplicate, reset and delete', () => {
    const store = new WorkspaceStore(new InMemoryWorkspacePersistence())
    const original = store.workspaces[0]!
    const copy = store.duplicate(original.id)!
    expect(copy.name).toBe('Game day copy')
    const originalIDs = new Set(original.panels.map((p) => p.id))
    expect(copy.panels.some((p) => originalIDs.has(p.id))).toBe(false)
    expect(store.workspaces[1]!.id, 'right after the original').toBe(copy.id)

    store.update(copy.id, (w) => { w.panels = [] })
    store.resetToPreset(copy.id)
    expect(store.workspace(copy.id)?.panels.map((p) => p.kind)).toEqual(gameDay.panels().map((p) => p.kind))

    store.delete(copy.id)
    expect(store.workspace(copy.id)).toBeUndefined()
    expect(store.add(gameDay).name, 'names stay unique').toBe('Game day 2')
  })

  /** A newer app's panel kinds, a bad link colour and missing settings must not cost the rest of the library. */
  it('forgiving decode', () => {
    const json = `
    {"version": 2, "workspaces": [
      {"id": "${newUUID()}", "name": "Mine", "panels": [
        {"kind": "news", "frame": {"x": 0, "y": 0, "w": 3, "h": 2}, "linkGroup": 9},
        {"kind": "hologram", "frame": {"x": 3, "y": 0, "w": 3, "h": 2}},
        {"kind": "standings", "frame": {"x": 0, "y": 0, "w": 4, "h": 4}, "linkGroup": 2}
      ]},
      {"name": 42}
    ]}
    `
    const storage = new InMemoryKeyValueStorage()
    storage.setItem(StorageWorkspacePersistence.key, json)
    const store = new WorkspaceStore(new StorageWorkspacePersistence(storage))
    const workspace = store.workspaces[0]!
    expect(store.workspaces.length).toBe(2)
    expect(workspace.panels.map((p) => p.kind), 'unknown kind dropped').toEqual(['news', 'standings'])
    expect(workspace.panels[0]!.linkGroup).toBeUndefined()
    expect(workspace.panels[1]!.linkGroup).toBe(2)
    expect(G.validate(workspace.panels), 'the overlap was repaired on load').toEqual([])
    expect(store.workspaces[1]!.name).toBe('Workspace')
  })

  it('a corrupt file is set aside, not lost', () => {
    const storage = new InMemoryKeyValueStorage()
    storage.setItem(StorageWorkspacePersistence.key, 'not json')
    const store = new WorkspaceStore(new StorageWorkspacePersistence(storage))
    expect(store.workspaces.length, 'presets reseeded').toBe(ALL_PRESETS.length)
    expect(storage.getItem(StorageWorkspacePersistence.asideKey)).toBe('not json')
  })

  // Not in Swift: the saved JSON is the shape Swift's encoder writes, and it round-trips.
  it('the saved library round-trips in Swift’s shape', () => {
    const storage = new InMemoryKeyValueStorage()
    const store = new WorkspaceStore(new StorageWorkspacePersistence(storage))
    const text = storage.getItem(StorageWorkspacePersistence.key)!
    const raw = JSON.parse(text)
    expect(raw.version).toBe(1)
    expect(raw.workspaces[0].presetID).toBe('game-day')
    expect(raw.workspaces[0].id).toMatch(/^[0-9A-F-]{36}$/)
    expect(raw.workspaces[0].panels[1]).not.toHaveProperty('linkGroup')
    expect(raw.workspaces[0].panels[0].settings).toEqual({ extra: {} })
    expect(parseWorkspaceLibrary(text)).toEqual(store.library)
    expect(stringifyWorkspaceLibrary(parseWorkspaceLibrary(text))).toBe(text)
  })
})

describe('LinkBus', () => {
  it('groups are independent and changes merge', () => {
    const bus = new LinkBus()
    bus.publish({ kind: 'player', playerID: 'p1' }, 1)
    bus.publish({ kind: 'team', rosterID: 3 }, 1)
    bus.publish({ kind: 'player', playerID: 'p2' }, 2)
    expect(bus.selection(1)).toEqual({ playerID: 'p1', rosterID: 3 })
    expect(bus.selection(2)?.playerID).toBe('p2')
    expect(bus.selection(undefined)).toBeUndefined()
    bus.clear(1)
    expect(bus.selection(1)).toBeUndefined()
  })

  it('compare lists are per group and capped at four', () => {
    const bus = new LinkBus()
    for (const id of ['a', 'b', 'c', 'd']) bus.publish({ kind: 'addCompare', playerID: id }, 1)
    let fired = 0
    const unsubscribe = bus.subscribe(() => { fired += 1 })
    bus.publish({ kind: 'addCompare', playerID: 'e' }, 1)
    bus.publish({ kind: 'addCompare', playerID: 'a' }, 1)
    expect(fired, 'over the cap and duplicates are no-ops').toBe(0)
    unsubscribe()
    expect(bus.compareList(1)).toEqual(['a', 'b', 'c', 'd'])
    expect(bus.canAddToCompare(1)).toBe(false)
    expect(bus.canAddToCompare(2)).toBe(true)
    expect(bus.canAddToCompare(undefined)).toBe(false)
    bus.publish({ kind: 'removeCompare', playerID: 'b' }, 1)
    expect(bus.compareList(1)).toEqual(['a', 'c', 'd'])
    expect(bus.isComparing('c', 1)).toBe(true)
    expect(bus.isComparing('c', 2)).toBe(false)
    bus.publish({ kind: 'player', playerID: 'p' }, 1)
    expect(bus.compareList(1).length, 'selecting a player leaves the compare list alone').toBe(3)
    bus.publish({ kind: 'clearCompare' }, 1)
    expect(bus.compareList(1)).toEqual([])
    expect(bus.selection(1)?.playerID).toBe('p')
    bus.publish({ kind: 'addCompare', playerID: 'x' }, 1)
    bus.clear(1)
    expect(bus.compareList(1)).toEqual([])
    expect(bus.selection(1)).toBeUndefined()
  })

  it('republishing the same value does not notify', () => {
    const bus = new LinkBus()
    bus.publish({ kind: 'player', playerID: 'p1' }, 1)
    let fired = 0
    const unsubscribe = bus.subscribe(() => { fired += 1 })
    bus.publish({ kind: 'player', playerID: 'p1' }, 1)
    expect(fired).toBe(0)
    bus.publish({ kind: 'player', playerID: 'p9' }, 1)
    expect(fired).toBe(1)
    unsubscribe()
  })
})

describe('AppRouter', () => {
  it('the phone never shows a workspace', () => {
    let router = Router.at(workspacePlace(newUUID()))
    expect(router.phoneScreen).toBe('dashboard')
    router = router.open('matchup')
    expect(router.selection).toEqual(screenPlace('matchup'))
  })

  // Swift's AppRouter carries `workspaceEditing`, reset when a different
  // workspace opens; the web Router (src/models/navigation) has no editing
  // flag yet, so there is nothing to assert against.
  it.todo('switching workspaces locks the layout (needs workspaceEditing on the web Router)')
})
