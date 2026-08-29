import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import useAppStore from './store/useAppStore'
import ErrorBoundary from './components/layout/ErrorBoundary'
import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import DraftDashboard from './pages/DraftDashboard'
import Research from './pages/Research'
import SitStart from './pages/SitStart'
import TradeAnalyzer from './pages/TradeAnalyzer'
import Odds from './pages/Odds'
import Settings from './pages/Settings'

function RequireConfig({ children }) {
  const isConfigured = useAppStore((s) => s.isConfigured)
  const location = useLocation()

  if (!isConfigured && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/settings"
          element={
            <AppLayout>
              <Settings />
            </AppLayout>
          }
        />
        <Route
          path="/"
          element={
            <RequireConfig>
              <AppLayout>
                <Dashboard />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
