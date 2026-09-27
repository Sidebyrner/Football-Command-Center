/** Test helpers for the Team and Market panel specs: render a panel against the loaded demo league. */
import type { ComponentType } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { AppServices } from '@models/app/AppServices'
import { defaultPanelSettings, type LinkGroup, type PanelSettings } from '@models/workspaces/Workspace'
import { StaticAppProvider } from '@ui/app/AppContext'
import { DEFAULT_PANEL_ENV, PanelEnvProvider, type PanelProps } from './PanelEnv'

/** The rendered HTML as text: tags dropped, entities decoded. */
export const textOf = (html: string) => html
  .replace(/<!-- -->/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')

export function renderPanel(services: AppServices, Panel: ComponentType<PanelProps>, options: {
  rows?: number; settings?: Partial<PanelSettings>; linkGroup?: LinkGroup
} = {}): string {
  const settings = { ...defaultPanelSettings(), ...options.settings }
  const env = options.linkGroup === undefined ? DEFAULT_PANEL_ENV : {
    ...DEFAULT_PANEL_ENV,
    inWorkspacePanel: true,
    linkGroup: options.linkGroup,
    linkPublish: { group: options.linkGroup, handler: () => {} },
  }
  return textOf(renderToString(
    <MemoryRouter>
      <StaticAppProvider services={services}>
        <PanelEnvProvider value={env}>
          <Panel settings={settings} rows={options.rows ?? 5} />
        </PanelEnvProvider>
      </StaticAppProvider>
    </MemoryRouter>,
  ))
}
