import { useState, useMemo } from 'react'
import { Plus, ArrowDownWideNarrow, Trash2, Star, ClipboardList } from 'lucide-react'
import { ScreenHero } from '@ui/components/Screen'
import { PositionChip } from '@ui/components/Player'
import { LoadingPlaceholder } from '@ui/components/State'
import PlayerPicker from '../components/mockdraft/PlayerPicker'
import TargetCard from '../components/mockdraft/TargetCard'
import useMockDraftStore, { POSITIONS } from '../store/useMockDraftStore'
import useAppStore from '../store/useAppStore'
import useWatchlistStore from '../store/useWatchlistStore'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useLiveDraft } from '../hooks/useLiveDraft'
import '../components/draft/draft.css'

// Watchlisted players for this position who aren't in the plan yet, and
// haven't already been drafted by someone else. Suggestion only — adding
// one is always an explicit click, and starring stays independent of
// planning (a player can be both watched and planned, or just watched).
function WatchlistSuggestions({ pos, players, targets, watchlistIds, draftedIds, onAdd }) {
  const suggestions = useMemo(() => {
    if (!watchlistIds.length) return []
    const watched = new Set(watchlistIds)
    const planned = new Set(targets.map((t) => t.playerId))
    return players
      .filter((p) => p.position === pos && watched.has(p.id) && !planned.has(p.id) && !draftedIds?.has(p.id))
      .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity))
  }, [pos, players, targets, watchlistIds, draftedIds])

  if (suggestions.length === 0) return null

  return (
    <div className="dd-suggest">
      <div className="dd-suggest-title">
        <Star size={12} fill="currentColor" aria-hidden />
        <span className="t-micro">From your watchlist</span>
      </div>
      <ul className="dd-list-plain" style={{ gap: 2 }}>
        {suggestions.map((p) => (
          <li key={p.id} className="t-meta">
            <span className="dd-truncate" style={{ flex: 1, color: 'var(--text)' }}>{p.name}</span>
            <span className="faint" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
              {p.team}{p.adp != null && ` · ${Math.round(p.adp)}`}
            </span>
            <button
              type="button"
              onClick={() => onAdd(p)}
              className="dd-icon-button"
              aria-label={`Add ${p.name} to plan`}
              title="Add to plan"
            >
              <Plus size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PositionColumn({ pos, targets, players, watchlistIds, draftedIds, pickByPlayer, store }) {
  const [adding, setAdding] = useState(false)
  const goneCount = targets.filter((t) => draftedIds?.has(t.playerId)).length

  return (
    <section className="card dd-column" aria-label={`${pos} targets`}>
      <div className="dd-column-head">
        <div>
          <PositionChip position={pos} />
          <span className="t-meta faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {targets.length} target{targets.length === 1 ? '' : 's'}
            {goneCount > 0 && ` · ${goneCount} gone`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className={`dd-icon-button large${adding ? ' on' : ''}`}
          aria-label={`Add ${pos} target`}
          aria-expanded={adding}
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>

      <WatchlistSuggestions
        pos={pos}
        players={players}
        targets={targets}
        watchlistIds={watchlistIds}
        draftedIds={draftedIds}
        onAdd={(p) => store.addTarget(p)}
      />

      {adding && (
        <PlayerPicker
          players={players}
          position={pos}
          excludeIds={new Set(targets.map((t) => t.playerId))}
          placeholder={`Add ${pos}…`}
          onSelect={(p) => store.addTarget(p)}
          onClose={() => setAdding(false)}
        />
      )}

      {targets.length === 0 ? (
        <p className="t-meta faint" style={{ margin: 0, padding: '8px 2px' }}>
          No {pos} targets yet.
        </p>
      ) : (
        <ul className="dd-list-plain">
          {targets.map((t, i) => (
            <TargetCard
              key={t.id}
              target={t}
              index={i}
              isFirst={i === 0}
              isLast={i === targets.length - 1}
              players={players}
              draftedIds={draftedIds}
              pickByPlayer={pickByPlayer}
              onMove={(dir) => store.moveTarget(pos, t.id, dir)}
              onRemove={() => store.removeTarget(pos, t.id)}
              onNote={(note) => store.updateNote(pos, t.id, note)}
              onAddFallback={(p) => store.addFallback(pos, t.id, p)}
              onRemoveFallback={(pid) => store.removeFallback(pos, t.id, pid)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Pre-draft plan: ranked targets per position with notes and fallbacks.
 *
 * The value over a paper cheat sheet is that it stays live — once the draft
 * starts, targets that are gone strike through and the next surviving fallback
 * is marked, so you can see what your plan has become rather than what it was.
 */
export default function MockDraft() {
  const store = useMockDraftStore()
  const { targets } = store
  const { players, loading } = useDraftPlayers()
  const watchlistIds = useWatchlistStore((s) => s.ids)
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const practiceDraftId = useAppStore((s) => s.practiceDraftId)
  const { draftedIds, pickByPlayer, isLive } = useLiveDraft(leagueId, sleeperUserId, { draftIdOverride: practiceDraftId })

  const total = useMemo(
    () => Object.values(targets).reduce((n, l) => n + l.length, 0),
    [targets]
  )
  const goneTotal = useMemo(
    () => Object.values(targets).flat().filter((t) => draftedIds?.has(t.playerId)).length,
    [targets, draftedIds]
  )

  const answer = total === 0
    ? 'No targets yet'
    : isLive
      ? `${total - goneTotal} of ${total} targets left`
      : `${total} target${total !== 1 ? 's' : ''} planned`
  const detail = isLive
    ? 'The draft is live — gone targets strike through and the next fallback on the board is marked.'
    : 'Rank targets per position with notes and fallbacks; they stay live once the draft starts.'

  return (
    <div className="dd-page">
      <div className="dd-toolbar">
        <span className="dd-toolbar-spacer" />
        <button
          type="button"
          onClick={store.sortByAdp}
          disabled={total === 0}
          className="button dd-small"
        >
          <ArrowDownWideNarrow size={14} aria-hidden />
          Sort by ADP
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('Clear every target from your draft plan? This cannot be undone.')) store.clearAll()
          }}
          disabled={total === 0}
          className="button dd-small dd-danger"
        >
          <Trash2 size={14} aria-hidden />
          Clear
        </button>
      </div>

      <ScreenHero
        overline="Tools · Draft plan"
        icon={ClipboardList}
        hue="var(--hue-team)"
        answer={answer}
        detail={detail}
        stats={isLive && total > 0 ? [
          { value: String(total), label: 'targets' },
          { value: String(goneTotal), label: 'gone' },
        ] : []}
        trailing={isLive ? <span className="dd-live t-micro"><span className="dd-dot dd-pulse" aria-hidden /> Live</span> : undefined}
      />

      {loading ? (
        <LoadingPlaceholder label="Loading players…" cards={3} />
      ) : (
        <div className="dd-plan-grid">
          {POSITIONS.map((pos) => (
            <PositionColumn
              key={pos}
              pos={pos}
              targets={targets[pos] ?? []}
              players={players}
              watchlistIds={watchlistIds}
              draftedIds={draftedIds}
              pickByPlayer={pickByPlayer}
              store={store}
            />
          ))}
        </div>
      )}
    </div>
  )
}
