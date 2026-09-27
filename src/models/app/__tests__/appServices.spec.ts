import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AppServices } from '@models/app/AppServices'
import { InMemorySettingsStore, makeAppSettings } from '@models/settings/AppSettings'
import { InMemoryWorkspacePersistence } from '@models/workspaces/WorkspaceStore'
import { InMemorySecretStore } from '@data/secretStore'
import { Cache, MemoryStore } from '@data/cache'
import { DEMO_NOW, DEMO_SETTINGS, DemoTransport } from '@data/demo'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService } from '@data/SleeperService'
import { StaticDataStore, type BundledSource } from '@data/StaticDataStore'
import { WorkspaceFixture as F } from '../../../../tests/workspaceFixture'

/** Port of AppServicesTests (in WorkspaceFixture.swift). */
describe('AppServices', () => {
  it('loads every screen from one shared context', async () => {
    const s = await F.services()
    expect(s.sitStart.errorMessage).toBeUndefined()
    expect(s.dashboard.context).toBeDefined()
    expect(s.sitStart.context).toBeDefined()
    expect(s.injuries.context).toBeDefined()
    expect(s.trades.desk).toBeDefined()
    expect(s.dashboard.context?.league.leagueID).toBe(s.waivers.context?.league.leagueID)
  })

  it('reuses player cards until the league reloads', async () => {
    const s = await F.services()
    const context = s.dashboard.context!
    const first = s.playerCard(F.cook, context)
    expect(s.playerCard(F.cook, context)).toBe(first)
    expect(s.playerCard(F.gibbs, context)).not.toBe(first)
    await s.loadIfConfigured(true)
    expect(s.playerCard(F.cook, context)).not.toBe(first)
  })
})

/** Web-only: the demo league every visitor can open loads on every screen. */
describe('demo league through AppServices', () => {
  it('loads every screen model without an error', async () => {
    const publicDir = fileURLToPath(new URL('../../../../public/', import.meta.url))
    const routes = JSON.parse(readFileSync(`${publicDir}demo/routes.json`, 'utf8')) as Record<string, string>
    const siteData: BundledSource = async (r) => {
      try { return JSON.parse(readFileSync(`${publicDir}data/${r.remotePath}`, 'utf8')) } catch { return undefined }
    }
    const transport = new DemoTransport(routes, 0)
    const cache = new Cache(new MemoryStore())
    const s = new AppServices({
      sleeper: new SleeperService(new SleeperClient({ transport, retries: 0 }), cache),
      staticData: new StaticDataStore({ cache, transport, baseURL: null, bundled: siteData }),
      settingsStore: new InMemorySettingsStore(makeAppSettings({ ...DEMO_SETTINGS })),
      workspacePersistence: new InMemoryWorkspacePersistence(),
      secrets: new InMemorySecretStore(),
      now: () => DEMO_NOW,
    })
    await s.loadIfConfigured()
    const models = { dashboard: s.dashboard, matchup: s.matchup, sitStart: s.sitStart, planning: s.planning, injuries: s.injuries, waivers: s.waivers, trades: s.trades, discovery: s.discovery, gameDay: s.gameDay, qb: s.qbStream, rb: s.rbStream, wr: s.wrStream, k: s.kStream, dst: s.dstStream, idp: s.idpStream }
    const errors = Object.entries(models)
      .map(([name, m]) => [name, (m as unknown as { errorMessage?: string }).errorMessage] as const)
      .filter(([, e]) => e !== undefined)
    expect(errors).toEqual([])
    expect(s.dashboard.context?.currentWeek).toBe(7)
    expect(s.sitStart.context).toBeDefined()
    expect(s.matchup.context).toBeDefined()
  })
})
