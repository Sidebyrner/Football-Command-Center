/**
 * What a panel is handed by its host — the web's version of the SwiftUI
 * environment in `PanelEnvironment.swift`: its link group, publishing to it,
 * the compare list, changing its own settings, and whether it's drawn inline.
 */
import { createContext, useContext, type ReactNode } from 'react'
import type { LinkGroup, PanelSettings } from '@models/workspaces/Workspace'
import {
  NO_LINK_PUBLISH, NO_PANEL_COMPARE, NO_PANEL_SETTINGS_UPDATE,
  type LinkPublishAction, type PanelCompareAction, type PanelSettingsUpdate,
} from '@models/workspaces/PanelEnvironment'

export interface PanelEnv {
  inWorkspacePanel: boolean
  linkGroup?: LinkGroup
  linkPublish: LinkPublishAction
  compare: PanelCompareAction
  settingsUpdate: PanelSettingsUpdate
  /** Drawn inside another view (a compare card), without its own header or padding. */
  inline: boolean
}

export const DEFAULT_PANEL_ENV: PanelEnv = {
  inWorkspacePanel: false,
  linkPublish: NO_LINK_PUBLISH,
  compare: NO_PANEL_COMPARE,
  settingsUpdate: NO_PANEL_SETTINGS_UPDATE,
  inline: false,
}

const Ctx = createContext<PanelEnv>(DEFAULT_PANEL_ENV)

export const usePanelEnv = () => useContext(Ctx)

export function PanelEnvProvider({ value, children }: { value: PanelEnv; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Props every panel body gets from `PanelBody`. */
export interface PanelProps {
  settings: PanelSettings
  /** How many rows a list panel shows — the panel's topN or its kind's default. */
  rows: number
}
