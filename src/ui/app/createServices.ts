/**
 * Builds the app's services — the web's composition root, as
 * `FantasyCommandCenterApp.init` is on the phone: the real Sleeper API and
 * data branch, or the demo league with its fixed clock.
 */
import { Cache, defaultCacheStore } from '@data/cache'
import { loadDemoRoutes, makeDemoServices, DEMO_SETTINGS } from '@data/demo'
import { InMemorySecretStore, LocalStorageSecretStore } from '@data/secretStore'
import { ESPN_SECRET_KEY } from '@data/espnCredentials'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService } from '@data/SleeperService'
import { StaticDataStore } from '@data/StaticDataStore'
import { AppServices } from '@models/app/AppServices'
import { InMemorySettingsStore, KeyValueSettingsStore, makeAppSettings } from '@models/settings/AppSettings'
import { InMemoryWorkspacePersistence, StorageWorkspacePersistence } from '@models/workspaces/WorkspaceStore'

/** Remembered for the tab, so moving around the demo doesn't drop out of it. */
const DEMO_FLAG = 'fcc.demo'

export function isDemoMode(): boolean {
  try {
    if (new URLSearchParams(location.search).has('demo')) sessionStorage.setItem(DEMO_FLAG, '1')
    return sessionStorage.getItem(DEMO_FLAG) === '1'
  } catch {
    return new URLSearchParams(location.search).has('demo')
  }
}

export function enterDemo(): void {
  try { sessionStorage.setItem(DEMO_FLAG, '1') } catch { /* private mode: the ?demo flag still works */ }
}

export function leaveDemo(): void {
  try { sessionStorage.removeItem(DEMO_FLAG) } catch { /* nothing to clear */ }
}

export interface CreatedServices {
  services: AppServices
  demo: boolean
}

export async function createServices(): Promise<CreatedServices> {
  if (isDemoMode()) {
    const demo = makeDemoServices(await loadDemoRoutes())
    const services = new AppServices({
      sleeper: demo.sleeper,
      staticData: demo.staticData,
      settingsStore: new InMemorySettingsStore(makeAppSettings({ ...DEMO_SETTINGS })),
      workspacePersistence: new InMemoryWorkspacePersistence(),
      secrets: new InMemorySecretStore(),
      espnSecrets: new InMemorySecretStore(),
      now: demo.now,
    })
    return { services, demo: true }
  }
  const cache = new Cache(defaultCacheStore())
  const services = new AppServices({
    sleeper: new SleeperService(new SleeperClient(), cache),
    staticData: new StaticDataStore({ cache }),
    settingsStore: new KeyValueSettingsStore(),
    workspacePersistence: new StorageWorkspacePersistence(),
    secrets: new LocalStorageSecretStore(),
    espnSecrets: new LocalStorageSecretStore(ESPN_SECRET_KEY),
    cache,
  })
  return { services, demo: false }
}
