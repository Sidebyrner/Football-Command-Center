import { Pin, Archive, Trash2, ExternalLink } from 'lucide-react'
import { getTag } from '../../utils/researchTags'

const SOURCE_LABEL = {
  user: 'Note',
  mock: 'Example',
  sleeper: 'Sleeper',
  rss: 'Feed',
}

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function TagPill({ value }) {
  const tag = getTag(value)
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide"
      style={{ color: tag.color, backgroundColor: tag.bg }}
    >
      {tag.label}
    </span>
  )
}

/**
 * Research item card.
 * compact=true → used in the player drawer (tighter layout, no player header)
 * compact=false → used on the Research page (full layout)
 */
export default function ResearchCard({ item, onPin, onArchive, onDelete, compact = false }) {
  const dateStr = formatDate(item.publishedAt ?? item.createdAt)
  const sourceLabel = SOURCE_LABEL[item.source] ?? item.source

  return (
    <div
      className={`group relative rounded border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors hover:border-[rgba(248,250,252,0.15)] ${
        compact ? 'px-3 py-2.5' : 'px-4 py-3'
      } ${item.isSaved ? 'border-l-2 border-l-[var(--color-accent)]' : ''}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Player + source (full mode only) */}
          {!compact && item.playerName && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-[var(--color-text-muted)]">
                {item.playerName}
              </span>
              {item.playerPosition && (
                <span className="text-[10px] text-[var(--color-text-faint)]">
                  {item.playerPosition} · {item.playerTeam}
                </span>
              )}
            </div>
          )}

          {/* Title */}
          <p className={`font-medium text-[var(--color-text)] leading-snug ${compact ? 'text-xs' : 'text-sm'}`}>
            {item.title || <span className="italic text-[var(--color-text-faint)]">Untitled</span>}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {onPin && (
            <button
              onClick={() => onPin(item.id)}
              title={item.isSaved ? 'Unpin' : 'Pin'}
              className={`p-1 rounded transition-colors ${
                item.isSaved
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
              }`}
            >
              <Pin size={12} fill={item.isSaved ? 'currentColor' : 'none'} />
            </button>
          )}
          {onArchive && (
            <button
              onClick={() => onArchive(item.id)}
              title="Archive"
              className="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
            >
              <Archive size={12} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(item.id)}
              title="Delete"
              className="p-1 rounded text-[var(--color-text-faint)] hover:text-[var(--color-sit)] transition-colors"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {item.body && (
        <p
          className={`mt-1.5 text-[var(--color-text-muted)] leading-relaxed line-clamp-3 ${
            compact ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {item.body}
        </p>
      )}

      {/* Tags + meta */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {item.tags.map((t) => (
          <TagPill key={t} value={t} />
        ))}

        <span className="ml-auto flex items-center gap-2 text-[10px] text-[var(--color-text-faint)] whitespace-nowrap">
          {item.source !== 'user' && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-faint)]">
              {sourceLabel}
            </span>
          )}
          {dateStr}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] hover:underline inline-flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={10} />
            </a>
          )}
        </span>
      </div>
    </div>
  )
}
