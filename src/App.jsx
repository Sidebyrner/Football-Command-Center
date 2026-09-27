import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Shell } from '@ui/shell/Shell'
import { ScreenView } from './screens/ScreenView'
import { AppProvider, useApp, useModel } from '@ui/app/AppContext'
import { ACCENT_THEME_HEX } from '@models/settings/AppSettings'
import { PlayerCardSheet } from './screens/players/PlayerCardSheet'
import { LoadingPlaceholder } from '@ui/components/State'
import { launchScreen, pathFor } from '@models/navigation/screens'
import '@ui/tokens.css'
import '@ui/components/components.css'
import useAppStore from './store/useAppStore'
import { usePlanSync } from './hooks/usePlanSync'
import ErrorBoundary from './components/layout/ErrorBoundary'
import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import DraftDashboard from './pages/DraftDashboard'
import Research from './pages/Research'
import MockDraft from './pages/MockDraft'
import SitStart from './pages/SitStart'
import MatchupPlanner from './pages/MatchupPlanner'
import TradeAnalyzer from './pages/TradeAnalyzer'
import PowerRankings from './pages/PowerRankings'
import Planning from './pages/Planning'
import Odds from './pages/Odds'
import Settings from './pages/Settings'

function RequireConfig({ children }) {
  const isConfigured = useAppStore((s) => s.isConfigured)
  const location = useLocation()

  if (!isConfigured && location.pathname !== '/classic/settings') {
    return <Navigate to="/classic/settings" replace />
  }
  return children
}

function AppLayout({ children }) {
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar />
      {/* Keyed by route so navigating away from a crashed page resets the
          boundary, rather than carrying the error across navigations. */}
      <div className="flex-1 min-w-0">
        <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
      </div>
    </div>
  )
}

/** The new app: the five hubs, ported from the native app screen by screen. */
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

export default function App() {
  // Runs regardless of which route is active — the drawer's "add to plan"
  // action is reachable from the draft board, not just the /plan page, so
  // the sync can't be scoped to MockDraft alone.
  usePlanSync()

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/classic/settings"
          element={
            <AppLayout>
              <Settings />
            </AppLayout>
          }
        />
        <Route path="/" element={<Launch />} />
        {['/board', '/team', '/settings', '/lineup/*', '/market/*', '/streams/*'].map((path) => (
          <Route key={path} path={path} element={<NewApp />} />
        ))}
        <Route
          path="/classic"
          element={
            <RequireConfig>
              <AppLayout>
                <Dashboard />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/matchup"
          element={
            <RequireConfig>
              <AppLayout>
                <MatchupPlanner />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/sit-start"
          element={
            <RequireConfig>
              <AppLayout>
                <SitStart />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/trade"
          element={
            <RequireConfig>
              <AppLayout>
                <TradeAnalyzer />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/power-rankings"
          element={
            <RequireConfig>
              <AppLayout>
                <PowerRankings />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/planning"
          element={
            <RequireConfig>
              <AppLayout>
                <Planning />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/odds"
          element={
            <RequireConfig>
              <AppLayout>
                <Odds />
              </AppLayout>
            </RequireConfig>
          }
        />
        <Route
          path="/draft"
          element={
            <AppLayout>
              <DraftDashboard />
            </AppLayout>
          }
        />
        <Route
          path="/research"
          element={
            <AppLayout>
              <Research />
            </AppLayout>
          }
        />
        <Route
          path="/plan"
          element={
            <AppLayout>
              <MockDraft />
            </AppLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
