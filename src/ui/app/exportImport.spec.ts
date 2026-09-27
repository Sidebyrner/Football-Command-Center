import { describe, expect, it } from 'vitest'
import { applyImport, buildExport } from './exportImport'

class MemoryStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.get(k) ?? null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

describe('export and import', () => {
  it('round-trips saved settings and never carries the relay token', () => {
    const a = new MemoryStorage()
    a.setItem('fcc.settings.v1', '{"leagueID":"L1"}')
    a.setItem('FantasyCommandCenter/Workspaces/library.json', '{"workspaces":[]}')
    a.setItem('fcc.relay-token', 'secret')
    a.setItem('unrelated', 'x')
    const file = buildExport(a, new Date('2026-09-27T12:00:00Z'))
    expect(Object.keys(file.items).sort()).toEqual(['FantasyCommandCenter/Workspaces/library.json', 'fcc.settings.v1'])
    const b = new MemoryStorage()
    expect(applyImport(JSON.stringify(file), b)).toBe(2)
    expect(b.getItem('fcc.settings.v1')).toBe('{"leagueID":"L1"}')
    expect(b.getItem('fcc.relay-token')).toBeNull()
  })

  it('refuses a file that isn’t an export, and ignores smuggled keys', () => {
    expect(() => applyImport('{"hello":1}', new MemoryStorage())).toThrow()
    expect(() => applyImport('not json', new MemoryStorage())).toThrow()
    const b = new MemoryStorage()
    applyImport(JSON.stringify({ format: 'football-command-center-export', version: 1, exportedAt: '', items: { 'fcc.relay-token': 'x', other: 'y', 'fcc.ok': 'z' } }), b)
    expect([b.getItem('fcc.relay-token'), b.getItem('other'), b.getItem('fcc.ok')]).toEqual([null, null, 'z'])
  })
})
