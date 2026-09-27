/**
 * Moving your setup between browsers and devices: one JSON file holding every
 * saved setting — league, accent, Board layout, workspaces, stream overrides
 * and snapshots. The relay token is never included.
 */
const PREFIXES = ['fcc.', 'FantasyCommandCenter/']
const EXCLUDED = new Set(['fcc.relay-token', 'fcc.theme-probe'])
export const EXPORT_FORMAT = 'football-command-center-export'

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: 1
  exportedAt: string
  items: Record<string, string>
}

const included = (key: string) => PREFIXES.some((p) => key.startsWith(p)) && !EXCLUDED.has(key)

export function buildExport(storage: Storage = localStorage, now = new Date()): ExportFile {
  const items: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key === null || !included(key)) continue
    const value = storage.getItem(key)
    if (value !== null) items[key] = value
  }
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), items }
}

/** Writes an export back; returns how many items were restored. Throws on a file that isn't one. */
export function applyImport(text: string, storage: Storage = localStorage): number {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('That file isn’t a Football Command Center export.') }
  const file = parsed as Partial<ExportFile>
  if (file?.format !== EXPORT_FORMAT || typeof file.items !== 'object' || file.items === null) {
    throw new Error('That file isn’t a Football Command Center export.')
  }
  let count = 0
  for (const [key, value] of Object.entries(file.items)) {
    if (!included(key) || typeof value !== 'string') continue
    storage.setItem(key, value)
    count++
  }
  return count
}

export function downloadExport(file: ExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `football-command-center-${file.exportedAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
