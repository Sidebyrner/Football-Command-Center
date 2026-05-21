import useAppStore from '../../store/useAppStore'
import RefreshButton from '../shared/RefreshButton'

export default function Header({ title, onRefresh, refreshing = false }) {
  const { leagueName, currentWeek, season } = useAppStore()

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="font-display font-semibold text-base text-[var(--color-text)]">{title}</h1>
        {leagueName && (
          <span className="hidden sm:block text-xs text-[var(--color-text-faint)] border border-[var(--color-border)] rounded px-2 py-0.5">
            {leagueName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--color-text-faint)] tabular-nums">
          {season} · Wk {currentWeek}
        </span>
        {onRefresh && (
          <RefreshButton onClick={onRefresh} loading={refreshing} />
        )}
      </div>
    </header>
  )
}
