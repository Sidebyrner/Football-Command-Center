/**
 * Renders a screen to HTML against the demo league, fully loaded — a smoke
 * test that every screen draws real data without throwing. No browser needed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Cache, MemoryStore } from '@data/cache'
import { DEMO_NOW, DEMO_SETTINGS, DemoTransport } from '@data/demo'
import { InMemorySecretStore } from '@data/secretStore'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService } from '@data/SleeperService'
import { StaticDataStore, type BundledSource } from '@data/StaticDataStore'
import { AppServices } from '@models/app/AppServices'
import { InMemorySettingsStore, makeAppSettings } from '@models/settings/AppSettings'
import { InMemoryWorkspacePersistence } from '@models/workspaces/WorkspaceStore'
import { StaticAppProvider } from '@ui/app/AppContext'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))

let loaded: Promise<AppServices> | undefined

/** The demo league's services with every screen loaded; shared across a test file. */
export function demoServices(): Promise<AppServices> {
  loaded ??= (async () => {
    const routes = JSON.parse(readFileSync(`${publicDir}demo/routes.json`, 'utf8')) as Record<string, string>
    const siteData: BundledSource = async (r) => {
      try { return JSON.parse(readFileSync(`${publicDir}data/${r.remotePath}`, 'utf8')) } catch { return undefined }
    }
    const transport = new DemoTransport(routes, 0)
    const cache = new Cache(new MemoryStore())
    const services = new AppServices({
      sleeper: new SleeperService(new SleeperClient({ transport, retries: 0 }), cache),
      staticData: new StaticDataStore({ cache, transport, baseURL: null, bundled: siteData }),
      settingsStore: new InMemorySettingsStore(makeAppSettings({ ...DEMO_SETTINGS })),
      workspacePersistence: new InMemoryWorkspacePersistence(),
      secrets: new InMemorySecretStore(),
      now: () => DEMO_NOW,
    })
    await services.loadIfConfigured()
    return services
  })()
  return loaded
}

/** Renders a screen component inside the app's providers; returns the HTML. */
export async function renderScreen(Screen: ComponentType, path = '/board'): Promise<string> {
  const services = await demoServices()
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <StaticAppProvider services={services}>
        <div className="fcc"><Screen /></div>
      </StaticAppProvider>
    </MemoryRouter>,
  )
}
