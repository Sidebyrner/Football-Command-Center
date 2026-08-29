import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ArrowLeftRight, TrendingUp, Settings, Zap, ClipboardList, BookOpen, ListChecks } from 'lucide-react'
import useAppStore from '../../store/useAppStore'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/draft', icon: ClipboardList, label: 'Draft' },
  { to: '/plan', icon: ListChecks, label: 'Draft Plan' },
  { to: '/research', icon: BookOpen, label: 'Research' },
  { to: '/sit-start', icon: Zap, label: 'Sit / Start' },
  { to: '/trade', icon: ArrowLeftRight, label: 'Trade' },
  { to: '/odds', icon: TrendingUp, label: 'Odds' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const leagueName = useAppStore((s) => s.leagueName)

  return (
    <aside className="w-16 lg:w-56 flex-shrink-0 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col h-screen sticky top-0">
      {/* Logo / App Name */}
      <div className="px-3 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-[var(--color-accent)] flex items-center justify-center flex-shrink-0">
            <span className="text-black font-display font-bold text-sm">FC</span>
          </div>
          <span className="hidden lg:block font-display font-bold text-sm text-[var(--color-text)] leading-tight">
            Command<br />Center
          </span>
        </div>
        {leagueName && (
          <p className="hidden lg:block text-xs text-[var(--color-text-faint)] mt-2 truncate" title={leagueName}>
            {leagueName}
          </p>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-2 py-2 rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
                isActive
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
              }`
            }
          >
            <Icon size={17} className="flex-shrink-0" />
            <span className="hidden lg:block">{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
