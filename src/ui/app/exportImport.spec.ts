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

  it('carries the original tools’ saves but never the Odds API key', () => {
    const a = new MemoryStorage()
    a.setItem('fcc-watchlist-v2', '{"state":{"ids":["1"]},"version":0}')
    a.setItem('fcc-research-store', '{"state":{"items":[]},"version":0}')
    a.setItem('fcc-mock-draft', '{"state":{},"version":1}')
    a.setItem('fcc-scoring-profile', '{"state":{"activeProfile":{"id":"x"}},"version":1}')
    a.setItem('fcc-app-store', '{"state":{"leagueId":"L1","oddsApiKey":"secret-a"},"version":0}')
    a.setItem('fcc-draft-players-v3', '{"big":"cache"}')
    const file = buildExport(a)
    expect(Object.keys(file.items).sort()).toEqual(['fcc-app-store', 'fcc-mock-draft', 'fcc-research-store', 'fcc-scoring-profile', 'fcc-watchlist-v2'])
    expect(file.items['fcc-app-store']).not.toContain('secret-a')
    expect(JSON.parse(file.items['fcc-app-store']!).state.leagueId).toBe('L1')

    // The destination keeps its own key; a key smuggled into a file is dropped.
    const b = new MemoryStorage()
    b.setItem('fcc-app-store', '{"state":{"leagueId":"OLD","oddsApiKey":"secret-b"},"version":0}')
    const smuggled = { ...file, items: { ...file.items, 'fcc-app-store': '{"state":{"leagueId":"L1","oddsApiKey":"evil"},"version":0}' } }
    expect(applyImport(JSON.stringify(smuggled), b)).toBe(5)
    expect(JSON.parse(b.getItem('fcc-app-store')!).state).toEqual({ leagueId: 'L1', oddsApiKey: 'secret-b' })
    const c = new MemoryStorage()
    applyImport(JSON.stringify(smuggled), c)
    expect(JSON.parse(c.getItem('fcc-app-store')!).state).toEqual({ leagueId: 'L1' })
  })
})
