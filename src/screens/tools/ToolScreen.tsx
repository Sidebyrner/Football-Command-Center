/**
 * Hosts one of the original web app's tools (Draft, Draft Plan, Research,
 * Power Rankings, Odds) inside the new shell. Those tools read the league from
 * their own store; this bridges it from the league connected in Settings, so
 * there's one setup for the whole app. They talk to the real Sleeper API, so
 * the demo league explains that instead.
 */
import { useEffect, type ComponentType } from 'react'
import { FlaskConical } from 'lucide-react'
import useAppStore from '../../store/useAppStore'
import { isConfigured } from '@models/settings/AppSettings'
import { screenTitle, type Screen } from '@models/navigation/screens'
import { useApp, useModel } from '@ui/app/AppContext'
import { ErrorBoundaryCard } from './ErrorBoundaryCard'
import './tools.css'

export function useLegacyStoreBridge(): boolean {
  const { services, demo } = useApp()
  const settings = useModel(services.settingsModel).settings
  const dashboard = useModel(services.dashboard)
  const context = dashboard.context
  const ready = !demo && isConfigured(settings)
  useEffect(() => {
    if (!ready) return
    const state = useAppStore.getState()
    const next = {
      sleeperUsername: settings.sleeperUsername ?? state.sleeperUsername,
      sleeperUserId: settings.userID ?? state.sleeperUserId,
      leagueId: settings.leagueID ?? state.leagueId,
      leagueName: context?.league.name ?? state.leagueName,
      season: context ? String(context.scheduleSeason) : state.season,
      currentWeek: context?.currentWeek ?? state.currentWeek,
      isConfigured: true,
    }
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => state[k] !== next[k])
    if (changed) useAppStore.setState(next)
  }, [ready, settings.sleeperUsername, settings.userID, settings.leagueID, context])
  return ready
}

export function ToolScreen({ screen, Tool }: { screen: Screen; Tool: ComponentType }) {
  const { demo, openScreen } = useApp()
  const ready = useLegacyStoreBridge()
  if (demo) {
    return (
      <div className="card empty-state">
        <FlaskConical size={28} color="var(--hue-team)" aria-hidden />
        <div className="t-title">{screenTitle[screen]} uses your own league</div>
        <div className="t-body muted">
          The web-only tools read Sleeper directly, so they need a real league. Leave the demo in Settings to connect yours.
        </div>
        <button type="button" className="button primary" onClick={() => openScreen('settings')}>Open Settings</button>
      </div>
    )
  }
  if (!ready) return null
  return (
    <div className="fcc-tool">
      <ErrorBoundaryCard key={screen}><Tool /></ErrorBoundaryCard>
    </div>
  )
}
