/**
 * Which component draws each screen — the web's `RootView.view(for:)`. A
 * screen not built yet shows its placeholder; every league screen asks for
 * setup first.
 */
import type { ComponentType } from 'react'
import { isConfigured } from '@models/settings/AppSettings'
import type { Screen } from '@models/navigation/screens'
import { useApp, useModel } from '@ui/app/AppContext'
import { NeedsSetup } from '@ui/components/State'
import { Placeholder } from './Placeholder'
import { SettingsScreen } from './settings/SettingsScreen'
import { BoardScreen } from './board/BoardScreen'
import { MyTeamScreen } from './team/MyTeamScreen'
import { InjuriesScreen } from './lineup/InjuriesScreen'
import { MatchupScreen } from './lineup/MatchupScreen'
import { SitStartScreen } from './lineup/SitStartScreen'

/** Screens built so far; the rest render their placeholder. */
export const screens: Partial<Record<Screen, ComponentType>> = {
  settings: SettingsScreen,
  board: BoardScreen,
  dashboard: MyTeamScreen,
  sitStart: SitStartScreen,
  matchup: MatchupScreen,
  injuries: InjuriesScreen,
}

export function ScreenView({ screen }: { screen: Screen }) {
  const { services } = useApp()
  const settings = useModel(services.settingsModel).settings
  if (screen !== 'settings' && !isConfigured(settings)) return <NeedsSetup />
  const Component = screens[screen]
  return Component ? <Component /> : <Placeholder screen={screen} />
}
