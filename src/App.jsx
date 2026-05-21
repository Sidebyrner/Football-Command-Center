import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import useAppStore from './store/useAppStore'
import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import DraftDashboard from './pages/DraftDashboard'
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
  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <Sidebar />
      <div className="flex-1 min-w-0">{children}</div>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
