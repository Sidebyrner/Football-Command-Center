import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Shell } from '@ui/shell/Shell'
import { ScreenView } from './screens/ScreenView'
import { AppProvider, useApp, useModel } from '@ui/app/AppContext'
import { ACCENT_THEME_HEX } from '@models/settings/AppSettings'
import { PlayerCardSheet } from './screens/players/PlayerCardSheet'
import { LoadingPlaceholder } from '@ui/components/State'
import { launchScreen, pathFor } from '@models/navigation/screens'
import '@ui/tokens.css'
import '@ui/components/components.css'
import { usePlanSync } from './hooks/usePlanSync'

/** The app: five hubs, workspaces and the web tools, ported from the native app. */
function NewApp() {
  return (
    <AppProvider fallback={<div className="fcc" style={{ padding: 16 }}><LoadingPlaceholder label="Starting…" /></div>}>
      <NewShell />
    </AppProvider>
  )
}

function NewShell() {
  const { services } = useApp()
  const accent = ACCENT_THEME_HEX[useModel(services.settingsModel).settings.accentTheme]
  return (
    <Shell accent={accent} overlay={<PlayerCardSheet />}>
      {(screen) => <ScreenView screen={screen} />}
    </Shell>
  )
}

/** Board on a phone, My Team on a wider screen — as on the native app. */
function Launch() {
  const isPhone = window.matchMedia?.('(max-width: 899px)').matches ?? true
  return <Navigate to={pathFor(launchScreen(isPhone))} replace />
}

/**
 * Addresses from the original web app, so bookmarks still land somewhere
 * sensible: its screens now live in the new app, and its tools under /tools.
 */
const REDIRECTS = {
  '/classic': '/team',
  '/dashboard': '/team',
  '/matchup': '/lineup/matchup',
  '/sit-start': '/lineup/sit-start',
  '/trade': '/market/trades',
  '/planning': '/market/planning',
  '/classic/settings': '/settings',
  '/draft': '/tools/draft',
  '/plan': '/tools/draft-plan',
  '/research': '/tools/research',
  '/power-rankings': '/tools/power-rankings',
  '/odds': '/tools/odds',
}

export default function App() {
  // The draft drawer's "add to plan" action is reachable from the draft board,
  // not just the plan, so the sync runs for the whole app.
  usePlanSync()

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Launch />} />
        {['/board', '/team', '/settings', '/lineup/*', '/market/*', '/streams/*', '/tools/*', '/workspaces/:id'].map((path) => (
          <Route key={path} path={path} element={<NewApp />} />
        ))}
        {Object.entries(REDIRECTS).map(([from, to]) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
