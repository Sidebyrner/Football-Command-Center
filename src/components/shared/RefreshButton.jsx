import { RefreshCw } from 'lucide-react'

export default function RefreshButton({ onClick, loading = false, label = 'Refresh' }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded
        bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]
        hover:text-[var(--color-text)] hover:border-[var(--color-accent)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]
        disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      {label}
    </button>
  )
}
