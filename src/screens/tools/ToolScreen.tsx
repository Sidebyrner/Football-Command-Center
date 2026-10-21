/**
 * Hosts one of the original web app's tools (Draft, Draft Plan, Research,
 * Power Rankings, Odds) inside the new shell. Those tools read the league from
 * their own store; this bridges it from the league connected in Settings, so
 * there's one setup for the whole app. They talk to the real Sleeper API, so
 * the demo league explains that instead, and so does an ESPN league for the
 * tools that read the league (an ESPN id handed to Sleeper only 404s).
 */
import { useEffect, type ComponentType } from 'react'
import { FlaskConical, Link2Off } from 'lucide-react'
import useAppStore from '../../store/useAppStore'
import useScoringProfileStore from '../../store/useScoringProfileStore'
import { profileFromSleeperScoring } from '../../utils/sleeperScoring'
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
  const ready = !demo && settings.provider !== 'espn' && isConfigured(settings)
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

  // The tools score players under a profile of their own; give them the
  // league's real rules (the old Settings page's "Pull from Sleeper").
  const scoring = context?.league.scoringSettings
  const leagueName = context?.league.name
  useEffect(() => {
    if (!ready || !scoring) return
    const store = useScoringProfileStore.getState()
    const translated = profileFromSleeperScoring(scoring, leagueName ?? 'League')
    if (!translated.profile) return
    const same = JSON.stringify(store.activeProfile) === JSON.stringify(translated.profile)
    if (!same) store.applyLeagueScoring(translated)
  }, [ready, scoring, leagueName])
  return ready
}

/** Research is notes and news; the rest read the league from Sleeper. */
const LEAGUE_FREE_TOOLS: ReadonlySet<Screen> = new Set<Screen>(['research'])

export function ToolScreen({ screen, Tool }: { screen: Screen; Tool: ComponentType }) {
  const { demo, openScreen, services } = useApp()
  const settings = useModel(services.settingsModel).settings
  const ready = useLegacyStoreBridge()
  const espn = !demo && settings.provider === 'espn'
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
  if (espn && !LEAGUE_FREE_TOOLS.has(screen)) {
    return (
      <div className="card empty-state">
        <Link2Off size={28} color="var(--hue-team)" aria-hidden />
        <div className="t-title">{screenTitle[screen]} works with Sleeper leagues only for now</div>
        <div className="t-body muted">
          This tool reads your league straight from Sleeper, so it can’t open an ESPN league yet. Everything else in the app works with your ESPN league.
        </div>
        <button type="button" className="button" onClick={() => openScreen('settings')}>Open Settings</button>
      </div>
    )
  }
  if (!ready && !(espn && LEAGUE_FREE_TOOLS.has(screen))) return null
  return (
    <div className="fcc-tool">
      <ErrorBoundaryCard key={screen}><Tool /></ErrorBoundaryCard>
    </div>
  )
}
