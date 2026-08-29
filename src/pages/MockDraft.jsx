import { useState, useMemo } from 'react'
import { Plus, ArrowDownWideNarrow, Trash2, Radio } from 'lucide-react'
import Header from '../components/layout/Header'
import PlayerPicker from '../components/mockdraft/PlayerPicker'
import TargetCard from '../components/mockdraft/TargetCard'
import useMockDraftStore, { POSITIONS } from '../store/useMockDraftStore'
import useAppStore from '../store/useAppStore'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useLiveDraft } from '../hooks/useLiveDraft'
import { getPositionColor } from '../utils/playerHelpers'

function PositionColumn({ pos, targets, players, draftedIds, pickByPlayer, store }) {
  const [adding, setAdding] = useState(false)
  const color = getPositionColor(pos)
  const goneCount = targets.filter((t) => draftedIds?.has(t.playerId)).length

  return (
    <section className="flex flex-col min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}20` }}
          >
            {pos}
          </span>
          <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums">
            {targets.length}
            {goneCount > 0 && ` · ${goneCount} gone`}
          </span>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
          aria-label={`Add ${pos} target`}
        >
          <Plus size={14} />
        </button>
      </div>

      {adding && (
        <div className="mb-2">
          <PlayerPicker
            players={players}
            position={pos}
            excludeIds={new Set(targets.map((t) => t.playerId))}
            placeholder={`Add ${pos}…`}
            onSelect={(p) => store.addTarget(p)}
            onClose={() => setAdding(false)}
          />
        </div>
      )}

      {targets.length === 0 ? (
        <p className="text-[10px] text-[var(--color-text-faint)] italic px-1 py-3">
          No {pos} targets yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
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
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const { draftedIds, pickByPlayer, isLive } = useLiveDraft(leagueId, sleeperUserId)

  const total = useMemo(
    () => Object.values(targets).reduce((n, l) => n + l.length, 0),
    [targets]
  )
  const goneTotal = useMemo(
    () => Object.values(targets).flat().filter((t) => draftedIds?.has(t.playerId)).length,
    [targets, draftedIds]
  )

  return (
    <div className="flex flex-col h-screen">
      <Header title="Draft Plan" />

      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
          {total} target{total !== 1 ? 's' : ''}
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 text-xs">
            <Radio size={11} className="text-[var(--color-start)] animate-pulse" />
            <span className="text-[var(--color-text-muted)]">
              {goneTotal} of {total} gone
            </span>
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={store.sortByAdp}
          disabled={total === 0}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-40"
        >
          <ArrowDownWideNarrow size={12} />
          Sort by ADP
        </button>
        <button
          onClick={() => {
            if (confirm('Clear every target from your draft plan? This cannot be undone.')) store.clearAll()
          }}
          disabled={total === 0}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[var(--color-sit)] transition-colors disabled:opacity-40"
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      <main className="flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-xs text-[var(--color-text-faint)]">Loading players…</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-6">
            {POSITIONS.map((pos) => (
              <PositionColumn
                key={pos}
                pos={pos}
                targets={targets[pos] ?? []}
                players={players}
                draftedIds={draftedIds}
                pickByPlayer={pickByPlayer}
                store={store}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
