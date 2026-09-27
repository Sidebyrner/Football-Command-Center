import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'
import { DEMO_NOW, DEMO_SETTINGS, DemoTransport, isDemoRequested } from '@data/demo'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService } from '@data/SleeperService'
import { StaticDataStore, type BundledSource } from '@data/StaticDataStore'
import { LeagueContextLoader } from '@models/league/LeagueContextLoader'

const publicDir = fileURLToPath(new URL('../../../public/', import.meta.url))
const routes = JSON.parse(readFileSync(`${publicDir}demo/routes.json`, 'utf8')) as Record<string, string>
/** The site's own data folder, read from disk as the browser would fetch it. */
const siteData: BundledSource = async (r) => {
  try { return JSON.parse(readFileSync(`${publicDir}data/${r.remotePath}`, 'utf8')) } catch { return undefined }
}

describe('demo league', () => {
  it('serves the exported routes by path and 404s the rest', async () => {
    const t = new DemoTransport(routes, 0)
    expect((await t.send({ url: 'https://api.sleeper.app/v1/league/L1' })).status).toBe(200)
    expect((await t.send({ url: 'https://api.sleeper.app/projections/nfl/2025/7?x=1' })).status).toBe(404)
  })

  it('loads a full league context on the demo clock', async () => {
    const transport = new DemoTransport(routes, 0)
    const cache = new Cache(new MemoryStore())
    const sleeper = new SleeperService(new SleeperClient({ transport, retries: 0 }), cache)
    const staticData = new StaticDataStore({ cache, transport, baseURL: null, bundled: siteData })
    const context = await new LeagueContextLoader(sleeper, staticData, () => DEMO_NOW).load({ leagueID: DEMO_SETTINGS.leagueID, userRosterID: DEMO_SETTINGS.rosterID })
    expect(context.currentWeek).toBe(7)
    expect(context.teams.length).toBeGreaterThan(1)
    expect(context.userTeam?.roster.length).toBeGreaterThan(10)
    expect(context.seasonProfiles.length).toBeGreaterThan(300)
    // Some week-7 slots are locked at 2:30pm ET Sunday, some aren't.
    const ids = context.userTeam!.starterIDs
    expect(ids.some((id) => context.isLocked(id))).toBe(true)
    expect(ids.some((id) => !context.isLocked(id))).toBe(true)
  })

  it('is requested with ?demo', () => {
    expect(isDemoRequested('?demo')).toBe(true)
    expect(isDemoRequested('?demo=1')).toBe(true)
    expect(isDemoRequested('')).toBe(false)
  })
})
