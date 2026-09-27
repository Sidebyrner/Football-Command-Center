/**
 * A workspace: a named grid of panels — a port of FCApp `Workspace.swift`.
 * The JSON shape is exactly what Swift's `Codable` writes, so a library file
 * round-trips between the Mac/iPad app and the web.
 */

/**
 * A panel's place on the workspace grid, in cells: 12 columns across, rows of
 * `WorkspaceGeometry.rowHeight` down.
 */
export interface GridRect {
  x: number
  y: number
  w: number
  h: number
}

export interface GridSize {
  w: number
  h: number
}

export const gridMaxX = (r: GridRect) => r.x + r.w
export const gridMaxY = (r: GridRect) => r.y + r.h
export const gridSize = (r: GridRect): GridSize => ({ w: r.w, h: r.h })

export function intersects(a: GridRect, b: GridRect): boolean {
  return a.x < gridMaxX(b) && b.x < gridMaxX(a) && a.y < gridMaxY(b) && b.y < gridMaxY(a)
}

export const sameRect = (a: GridRect, b: GridRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/**
 * A colour group, like the linking blocks on a trading desk: every panel in the
 * same group follows one selected player. Swift's raw values: 1…4.
 */
export type LinkGroup = 1 | 2 | 3 | 4

export const LINK_GROUPS: readonly LinkGroup[] = [1, 2, 3, 4]

export function linkGroupName(group: LinkGroup): string {
  switch (group) {
    case 1: return 'Blue'
    case 2: return 'Orange'
    case 3: return 'Green'
    case 4: return 'Purple'
  }
}

export function linkGroupFromRaw(raw: unknown): LinkGroup | undefined {
  return raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : undefined
}

/**
 * Every kind of panel a workspace can hold. Each is a compact view of an
 * existing screen, drawn from the same model. In Swift's `allCases` order.
 */
export const PANEL_KINDS = [
  'lineupReadiness',
  'sitStart',
  'matchupScore',
  'injuries',
  'waiverTargets',
  'tradePartners',
  'byeWeeks',
  'idpStream',
  'wrStream',
  'rbStream',
  'qbStream',
  'dstStream',
  'kStream',
  'news',
  'standings',
  'playerCard',
  // Discovery: a list of every free agent, and panels that follow a click.
  'discovery',
  'playerProfile',
  'playerNews',
  'gameLog',
  'trendChart',
  'schedule',
  'compare',
  // Build-your-own comparison boards.
  'metric',
  'playerSearch',
] as const

export type PanelKind = (typeof PANEL_KINDS)[number]

export const isPanelKind = (raw: unknown): raw is PanelKind =>
  typeof raw === 'string' && (PANEL_KINDS as readonly string[]).includes(raw)

/**
 * A panel's own options. One struct of optionals rather than one per kind, so
 * decoding stays forgiving and a panel simply ignores what it doesn't use.
 */
export interface PanelSettings {
  /** How many rows a list panel shows. */
  topN?: number
  /** A position filter, e.g. "RB", applied inside the panel only. */
  positionFilter?: string
  extra: Record<string, string>
}

export const defaultPanelSettings = (): PanelSettings => ({ extra: {} })

export interface PanelPlacement {
  /** An uppercase UUID string, as Swift's `UUID().uuidString`. */
  id: string
  kind: PanelKind
  frame: GridRect
  linkGroup?: LinkGroup
  settings: PanelSettings
}

export function makePanelPlacement(init: {
  id?: string
  kind: PanelKind
  frame: GridRect
  linkGroup?: LinkGroup
  settings?: PanelSettings
}): PanelPlacement {
  const p: PanelPlacement = {
    id: init.id ?? newUUID(),
    kind: init.kind,
    frame: { ...init.frame },
    settings: init.settings ?? defaultPanelSettings(),
  }
  if (init.linkGroup !== undefined) p.linkGroup = init.linkGroup
  return p
}

export interface Workspace {
  id: string
  name: string
  /** An SF Symbol for the sidebar row. */
  icon: string
  panels: PanelPlacement[]
  /** The preset this was made from, for "Reset to preset". */
  presetID?: string
}

export const DEFAULT_WORKSPACE_ICON = 'square.grid.2x2'

export function makeWorkspace(init: {
  id?: string
  name: string
  icon?: string
  panels?: PanelPlacement[]
  presetID?: string
}): Workspace {
  const w: Workspace = {
    id: init.id ?? newUUID(),
    name: init.name,
    icon: init.icon ?? DEFAULT_WORKSPACE_ICON,
    panels: init.panels ?? [],
  }
  if (init.presetID !== undefined) w.presetID = init.presetID
  return w
}

/** Every workspace the user has, in sidebar order. */
export interface WorkspaceLibrary {
  version: number
  workspaces: Workspace[]
}

export const WORKSPACE_LIBRARY_CURRENT_VERSION = 1

// MARK: - UUIDs

/** A fresh id in Swift's `UUID().uuidString` form: uppercase, hyphenated. */
export function newUUID(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().toUpperCase()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Swift's `UUID(uuidString:)`: a valid string, normalised to uppercase; else `undefined`. */
export function parseUUID(raw: unknown): string | undefined {
  return typeof raw === 'string' && UUID_PATTERN.test(raw) ? raw.toUpperCase() : undefined
}

// MARK: - Decoding (Swift's forgiving `init(from:)`s)

type JSONObject = Record<string, unknown>

const isObject = (v: unknown): v is JSONObject => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Swift's `JSONDecoder` reads an `Int` from any whole number, `3.0` included. */
const asInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export class WorkspaceDecodeError extends Error {}

function decodeGridRect(raw: unknown): GridRect {
  if (!isObject(raw)) throw new WorkspaceDecodeError('frame is not an object')
  const x = asInt(raw.x), y = asInt(raw.y), w = asInt(raw.w), h = asInt(raw.h)
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    throw new WorkspaceDecodeError('frame needs whole x, y, w and h')
  }
  return { x, y, w, h }
}

export function decodePanelSettings(raw: unknown): PanelSettings {
  if (!isObject(raw)) throw new WorkspaceDecodeError('settings is not an object')
  const out: PanelSettings = { extra: {} }
  const topN = asInt(raw.topN)
  if (topN !== undefined) out.topN = topN
  const positionFilter = asString(raw.positionFilter)
  if (positionFilter !== undefined) out.positionFilter = positionFilter
  if (isObject(raw.extra) && Object.values(raw.extra).every((v) => typeof v === 'string')) {
    out.extra = { ...(raw.extra as Record<string, string>) }
  }
  return out
}

/**
 * A panel from a newer version of the app (an unknown kind) fails here and is
 * dropped by `decodeWorkspace`; everything else defaults.
 */
export function decodePanelPlacement(raw: unknown): PanelPlacement {
  if (!isObject(raw)) throw new WorkspaceDecodeError('panel is not an object')
  if (!isPanelKind(raw.kind)) throw new WorkspaceDecodeError(`unknown panel kind ${String(raw.kind)}`)
  const frame = decodeGridRect(raw.frame)
  let settings: PanelSettings
  try {
    settings = raw.settings === undefined || raw.settings === null ? defaultPanelSettings() : decodePanelSettings(raw.settings)
  } catch {
    settings = defaultPanelSettings()
  }
  return makePanelPlacement({
    id: parseUUID(raw.id) ?? newUUID(),
    kind: raw.kind,
    frame,
    linkGroup: linkGroupFromRaw(asInt(raw.linkGroup)),
    settings,
  })
}

/** Decodes each element it can and drops the ones it can't (Swift's `Failable`). */
function failable<T>(items: unknown, decode: (raw: unknown) => T): T[] {
  if (!Array.isArray(items)) return []
  const out: T[] = []
  for (const item of items) {
    try {
      out.push(decode(item))
    } catch {
      // One bad entry never costs the whole array.
    }
  }
  return out
}

export function decodeWorkspace(raw: unknown): Workspace {
  if (!isObject(raw)) throw new WorkspaceDecodeError('workspace is not an object')
  return makeWorkspace({
    id: parseUUID(raw.id) ?? newUUID(),
    name: asString(raw.name) ?? 'Workspace',
    icon: asString(raw.icon) ?? DEFAULT_WORKSPACE_ICON,
    panels: failable(raw.panels, decodePanelPlacement),
    presetID: asString(raw.presetID),
  })
}

/** Throws when the library itself is unreadable: not an object, or no `workspaces` array. */
export function decodeWorkspaceLibrary(raw: unknown): WorkspaceLibrary {
  if (!isObject(raw)) throw new WorkspaceDecodeError('library is not an object')
  if (!Array.isArray(raw.workspaces)) throw new WorkspaceDecodeError('library has no workspaces array')
  return {
    version: asInt(raw.version) ?? WORKSPACE_LIBRARY_CURRENT_VERSION,
    workspaces: failable(raw.workspaces, decodeWorkspace),
  }
}

/** Parses JSON text and decodes it; throws on either failure, like `JSONDecoder().decode`. */
export function parseWorkspaceLibrary(text: string): WorkspaceLibrary {
  return decodeWorkspaceLibrary(JSON.parse(text))
}

// MARK: - Encoding (the shape Swift writes)

export function encodePanelPlacement(p: PanelPlacement): JSONObject {
  const settings: JSONObject = { extra: { ...p.settings.extra } }
  if (p.settings.positionFilter !== undefined) settings.positionFilter = p.settings.positionFilter
  if (p.settings.topN !== undefined) settings.topN = p.settings.topN
  const out: JSONObject = { frame: { h: p.frame.h, w: p.frame.w, x: p.frame.x, y: p.frame.y }, id: p.id, kind: p.kind }
  if (p.linkGroup !== undefined) out.linkGroup = p.linkGroup
  out.settings = settings
  return out
}

export function encodeWorkspace(w: Workspace): JSONObject {
  const out: JSONObject = { icon: w.icon, id: w.id, name: w.name, panels: w.panels.map(encodePanelPlacement) }
  if (w.presetID !== undefined) out.presetID = w.presetID
  return out
}

export function encodeWorkspaceLibrary(library: WorkspaceLibrary): JSONObject {
  return { version: library.version, workspaces: library.workspaces.map(encodeWorkspace) }
}

/** JSON text with sorted keys, as Swift's `.sortedKeys` writes it (without the pretty-printing). */
export function stringifyWorkspaceLibrary(library: WorkspaceLibrary): string {
  return JSON.stringify(sortKeys(encodeWorkspaceLibrary(library)))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isObject(value)) {
    const out: JSONObject = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
    return out
  }
  return value
}

// MARK: - Copies

export const clonePanel = (p: PanelPlacement): PanelPlacement => ({
  ...p,
  frame: { ...p.frame },
  settings: { ...p.settings, extra: { ...p.settings.extra } },
})

export const cloneWorkspace = (w: Workspace): Workspace => ({ ...w, panels: w.panels.map(clonePanel) })
