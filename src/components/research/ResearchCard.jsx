import { Pin, Archive, Trash2, ExternalLink } from 'lucide-react'
import { getTag } from '../../utils/researchTags'
import '../../screens/tools/researchTools.css'

const SOURCE_LABEL = {
  user: 'Note',
  mock: 'Example',
  sleeper: 'Sleeper',
  rss: 'Feed',
}

/** Each research tag's colour as a design token — the label always shows too. */
const TAG_TOKEN = {
  injury: 'var(--sit)',
  'depth-chart': 'var(--caution)',
  'role-change': 'var(--pos-wr)',
  'camp-buzz': 'var(--start)',
  suspension: 'var(--pos-te)',
  contract: 'var(--pos-qb)',
  coaching: 'var(--pos-def)',
  rookie: 'var(--hue-lineup)',
  offense: 'var(--pos-lb)',
  general: 'var(--text-2)',
}
export const tagToken = (value) => TAG_TOKEN[value] ?? 'var(--text-2)'

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TagPill({ value }) {
  const tag = getTag(value)
  return (
    <span className="rt-tag t-micro" style={{ '--tag': tagToken(value) }}>
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
  const title = item.title || 'Untitled'

  return (
    <article
      className={`card rt-note${item.isSaved ? ' pinned' : ''}`}
      style={compact ? { padding: 'var(--space-m)' } : undefined}
      aria-label={item.isSaved ? `${title} (pinned)` : title}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Player + source (full mode only) */}
          {!compact && item.playerName && (
            <div className="rt-row t-meta" style={{ marginBottom: 2 }}>
              <span className="muted" style={{ fontWeight: 600 }}>{item.playerName}</span>
              {item.playerPosition && (
                <span className="faint">{item.playerPosition} · {item.playerTeam}</span>
              )}
            </div>
          )}

          {/* Title */}
          <p className={`rt-note-title ${compact ? 't-meta' : 't-body'}`}>
            {item.title || <span className="faint" style={{ fontStyle: 'italic' }}>Untitled</span>}
          </p>
        </div>

        {/* Actions */}
        <div className="rt-note-actions">
          {onPin && (
            <button
              type="button"
              onClick={() => onPin(item.id)}
              title={item.isSaved ? 'Unpin' : 'Pin'}
              aria-label={item.isSaved ? `Unpin ${title}` : `Pin ${title}`}
              aria-pressed={!!item.isSaved}
              className={`rt-icon-button${item.isSaved ? ' on' : ''}`}
            >
              <Pin size={14} fill={item.isSaved ? 'currentColor' : 'none'} aria-hidden />
            </button>
          )}
          {onArchive && (
            <button
              type="button"
              onClick={() => onArchive(item.id)}
              title="Archive"
              aria-label={`Archive ${title}`}
              className="rt-icon-button"
            >
              <Archive size={14} aria-hidden />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              title="Delete"
              aria-label={`Delete ${title}`}
              className="rt-icon-button danger"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {item.body && (
        <p className={`rt-note-body muted line-clamp-3 ${compact ? 't-caption' : 't-meta'}`}>
          {item.body}
        </p>
      )}

      {/* Tags + meta */}
      <div className="rt-row">
        {item.tags.map((t) => (
          <TagPill key={t} value={t} />
        ))}

        <span className="ml-auto rt-row t-caption faint" style={{ whiteSpace: 'nowrap', flexWrap: 'nowrap' }}>
          {item.source !== 'user' && <span className="rt-badge">{sourceLabel}</span>}
          {dateStr}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rt-link inline-flex items-center"
              aria-label={`Open source for ${title} (new tab)`}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </span>
      </div>
    </article>
  )
}
