/**
 * The user's workspaces. Every edit goes through here and is saved — a port of
 * FCApp `WorkspaceStore.swift`.
 */
import { Observable } from '../Observable'
import { LocalKeyValueStorage, type KeyValueStorage } from './KeyValueStorage'
import { repaired } from './WorkspaceGeometry'
import { defaultLibrary, makePresetWorkspace, presetById, type WorkspacePreset } from './WorkspacePresets'
import {
  cloneWorkspace, newUUID, makeWorkspace, parseWorkspaceLibrary, stringifyWorkspaceLibrary,
  type Workspace, type WorkspaceLibrary,
} from './Workspace'

/** Where the workspace library is kept. */
export interface WorkspacePersistence {
  /**
   * `undefined` when nothing has been saved yet. Throws when something is
   * saved but can't be read, so the store can set it aside rather than
   * overwrite it.
   */
  load(): WorkspaceLibrary | undefined
  save(library: WorkspaceLibrary): void
  /** Keeps an unreadable library for inspection instead of losing it. */
  setAside(): void
}

/**
 * Swift's file under Application Support (`FantasyCommandCenter/Workspaces/
 * library.json`) — here, the same path as a key in a key-value store. Not
 * `AppSettings`: the library is nested and grows, and a bad decode here must
 * never cost the league selection stored there.
 */
export class StorageWorkspacePersistence implements WorkspacePersistence {
  static readonly key = 'FantasyCommandCenter/Workspaces/library.json'
  static readonly asideKey = 'FantasyCommandCenter/Workspaces/library.corrupt.json'

  constructor(
    private readonly storage: KeyValueStorage = new LocalKeyValueStorage(),
    readonly key: string = StorageWorkspacePersistence.key,
    readonly asideKey: string = StorageWorkspacePersistence.asideKey,
  ) {}

  load(): WorkspaceLibrary | undefined {
    const text = this.storage.getItem(this.key)
    if (text === undefined) return undefined
    return parseWorkspaceLibrary(text)
  }

  save(library: WorkspaceLibrary): void {
    if (!this.storage.setItem(this.key, stringifyWorkspaceLibrary(library))) {
      throw new Error('The workspace library could not be saved.')
    }
  }

  setAside(): void {
    const text = this.storage.getItem(this.key)
    this.storage.removeItem(this.asideKey)
    if (text === undefined) return
    if (this.storage.setItem(this.asideKey, text)) this.storage.removeItem(this.key)
  }
}

/** For the demo league and tests: starts from the presets every launch. */
export class InMemoryWorkspacePersistence implements WorkspacePersistence {
  private stored: WorkspaceLibrary | undefined

  constructor(library?: WorkspaceLibrary) {
    this.stored = library
  }

  load(): WorkspaceLibrary | undefined {
    return this.stored ? copyLibrary(this.stored) : undefined
  }

  save(library: WorkspaceLibrary): void {
    this.stored = copyLibrary(library)
  }

  setAside(): void {}
}

/** Swift's library is a value type; copies keep the store and its persistence apart. */
const copyLibrary = (l: WorkspaceLibrary): WorkspaceLibrary => ({ version: l.version, workspaces: l.workspaces.map(cloneWorkspace) })

/** The debounce on `update`, so a burst of edits (a drag, a resize) writes once. */
export const WORKSPACE_SAVE_DELAY_MS = 250

export class WorkspaceStore extends Observable {
  private _library: WorkspaceLibrary
  private pendingSave: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly persistence: WorkspacePersistence) {
    super()
    let loaded: WorkspaceLibrary | undefined
    try {
      loaded = persistence.load()
    } catch {
      persistence.setAside()
      loaded = undefined
    }
    if (loaded) {
      for (const workspace of loaded.workspaces) workspace.panels = repaired(workspace.panels)
      this._library = loaded
    } else {
      this._library = defaultLibrary()
      try { persistence.save(this._library) } catch { /* try? */ }
    }
  }

  get library(): WorkspaceLibrary { return this._library }

  get workspaces(): Workspace[] { return this._library.workspaces }

  workspace(id: string): Workspace | undefined {
    return this._library.workspaces.find((w) => w.id === id)
  }

  addEmpty(name = 'New workspace'): Workspace {
    const workspace = makeWorkspace({ name: this.uniqueName(name) })
    this.setWorkspaces([...this._library.workspaces, workspace])
    this.saveNow()
    return cloneWorkspace(workspace)
  }

  add(preset: WorkspacePreset): Workspace {
    const workspace = makePresetWorkspace(preset)
    workspace.name = this.uniqueName(preset.name)
    this.setWorkspaces([...this._library.workspaces, workspace])
    this.saveNow()
    return cloneWorkspace(workspace)
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    this.update(id, (w) => { w.name = trimmed })
    this.flush()
  }

  setIcon(id: string, icon: string): void {
    this.update(id, (w) => { w.icon = icon })
    this.flush()
  }

  duplicate(id: string): Workspace | undefined {
    const index = this._library.workspaces.findIndex((w) => w.id === id)
    if (index < 0) return undefined
    const copy = cloneWorkspace(this._library.workspaces[index]!)
    copy.id = newUUID()
    copy.name = this.uniqueName(copy.name + ' copy')
    copy.panels = copy.panels.map((p) => ({ ...p, id: newUUID() }))
    const next = [...this._library.workspaces]
    next.splice(index + 1, 0, copy)
    this.setWorkspaces(next)
    this.saveNow()
    return cloneWorkspace(copy)
  }

  delete(id: string): void {
    this.setWorkspaces(this._library.workspaces.filter((w) => w.id !== id))
    this.saveNow()
  }

  /** Swift's `move(fromOffsets:toOffset:)`: the moved items keep their order and land before `destination`. */
  move(source: Iterable<number>, destination: number): void {
    const all = this._library.workspaces
    const indices = new Set([...source].filter((i) => i >= 0 && i < all.length))
    const moving = all.filter((_, i) => indices.has(i))
    const staying = all.filter((_, i) => !indices.has(i))
    const before = [...indices].filter((i) => i < destination).length
    staying.splice(destination - before, 0, ...moving)
    this.setWorkspaces(staying)
    this.saveNow()
  }

  resetToPreset(id: string): void {
    const presetID = this.workspace(id)?.presetID
    const preset = presetID === undefined ? undefined : presetById(presetID)
    if (!preset) return
    this.update(id, (w) => { w.panels = preset.panels() })
    this.flush()
  }

  /**
   * Any change to one workspace. Saves are debounced, so a burst of edits (a
   * drag, a resize) writes once. `mutate` edits a copy, which then replaces
   * the stored workspace.
   */
  update(id: string, mutate: (workspace: Workspace) => void): void {
    const index = this._library.workspaces.findIndex((w) => w.id === id)
    if (index < 0) return
    const copy = cloneWorkspace(this._library.workspaces[index]!)
    mutate(copy)
    const next = [...this._library.workspaces]
    next[index] = copy
    this.setWorkspaces(next)
    this.scheduleSave()
  }

  /** Writes any pending change now. */
  flush(): void {
    if (this.pendingSave !== undefined) clearTimeout(this.pendingSave)
    this.pendingSave = undefined
    this.saveNow()
  }

  private setWorkspaces(workspaces: Workspace[]): void {
    this._library = { ...this._library, workspaces }
    this.changed()
  }

  private scheduleSave(): void {
    if (this.pendingSave !== undefined) clearTimeout(this.pendingSave)
    this.pendingSave = setTimeout(() => {
      this.pendingSave = undefined
      this.saveNow()
    }, WORKSPACE_SAVE_DELAY_MS)
  }

  private saveNow(): void {
    try { this.persistence.save(this._library) } catch { /* try? */ }
  }

  private uniqueName(base: string): string {
    const names = new Set(this._library.workspaces.map((w) => w.name))
    if (!names.has(base)) return base
    let n = 2
    while (names.has(`${base} ${n}`)) n += 1
    return `${base} ${n}`
  }
}
