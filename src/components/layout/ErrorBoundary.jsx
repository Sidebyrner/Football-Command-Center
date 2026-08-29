import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Catches render errors so one bad player row cannot white-screen the app.
 *
 * Mid-draft an unrecoverable blank page is the worst possible failure: the
 * board is unusable exactly when it is needed. This keeps the shell alive and
 * offers a way back.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 px-6 text-center">
        <AlertTriangle size={28} className="text-[var(--color-sit)]" />
        <h2 className="font-display font-semibold text-base text-[var(--color-text)]">
          Something broke on this screen
        </h2>
        <p className="text-xs text-[var(--color-text-muted)] max-w-md leading-relaxed">
          The rest of the app is still running. Your settings, watchlist and research
          notes are stored locally and are unaffected.
        </p>
        <pre className="text-[10px] text-[var(--color-text-faint)] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 max-w-md overflow-x-auto text-left">
          {error?.message ?? String(error)}
        </pre>
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <RotateCcw size={12} />
            Try again
          </button>
          <a
            href="/draft"
            className="text-xs px-3 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Back to draft board
          </a>
        </div>
      </div>
    )
  }
}
