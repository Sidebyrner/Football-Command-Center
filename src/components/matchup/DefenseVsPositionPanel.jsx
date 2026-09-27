import { useState } from 'react'
import { Loader2, Shield, AlertTriangle } from 'lucide-react'
import { useDefenseVsPosition } from '../../hooks/useDefenseVsPosition'
import { useWeeklySeasons } from '../../hooks/usePlayerWeekly'
import DvpHeatmap from './DvpHeatmap'
import DvpRankedList from './DvpRankedList'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K']

/**
 * How generous each defense is to each position, in this league's points.
 *
 * The one thing this must never do is blend seasons. A defense that was soft to
 * TEs last November is a different unit with different personnel now, and
 * averaging the two would launder that away — so the season selector is
 * explicit and the caveat is standing copy, not a footnote.
 */
export default function DefenseVsPositionPanel({ myTeamAbbrs }) {
  const seasons = useWeeklySeasons()
  const [season, setSeason] = useState(null)
  const [view, setView] = useState('heatmap')
  const [position, setPosition] = useState('RB')

  const active = season ?? seasons[0]?.season ?? null
  const { dvp, loading, error, profileName, seasonMeta } = useDefenseVsPosition(active)

  if (!seasons.length && !loading) {
    return (
      <p className="text-xs text-[var(--color-text-faint)]">
        No weekly data on disk. Run <code className="text-[var(--color-text-muted)]">npm run preprocess-nflverse</code> to build it.
      </p>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] flex items-center gap-1.5">
          <Shield size={12} />
          Defense vs position
        </h2>

        <div className="flex items-center gap-3">
          {seasons.length > 1 && (
            <div className="flex gap-1">
              {seasons.map((s) => (
                <button
                  key={s.season}
                  onClick={() => setSeason(s.season)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                    active === s.season
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-semibold'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {s.season}{!s.complete ? ` (${s.weeks} wk)` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 border-l border-[var(--color-border)] pl-3">
            {['heatmap', 'by position'].map((v) => (
              <button
                key={v}
                onClick={() => setView(v === 'heatmap' ? 'heatmap' : 'ranked')}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  (view === 'heatmap') === (v === 'heatmap')
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] font-semibold'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-[var(--color-text-muted)] flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" /> Scoring every game log against your league's rules…
        </p>
      )}
      {error && <p className="text-sm text-[var(--color-sit)]">{error}</p>}

      {!loading && dvp && (
        <>
          {view === 'ranked' && (
            <div className="flex gap-1 mb-2">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPosition(p)}
                  className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                    position === p
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-semibold'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {view === 'heatmap'
            ? <DvpHeatmap dvp={dvp} myTeamAbbrs={myTeamAbbrs} />
            : <DvpRankedList dvp={dvp} position={position} myTeamAbbrs={myTeamAbbrs} />}

          <div className="mt-3 space-y-1">
            <p className="text-[10px] text-[var(--color-text-muted)]">
              Points allowed per <span className="text-[var(--color-text)]">game the defense played</span>,
              summed across every player at that position who faced them, scored by{' '}
              <span className="text-[var(--color-text)]">{profileName ?? 'your league profile'}</span>.
              Volume counts: a defense that keeps facing three-receiver offenses will look soft to WRs.
            </p>
            <p className="text-[10px] text-[var(--color-caution)] flex items-start gap-1">
              <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
              This is {dvp.season} only — never blended with another year. Last season's
              defense is not this season's defense; personnel and coordinators turn over.
              {seasonMeta && !seasonMeta.complete && ` ${dvp.season} has ${dvp.weeks.length} weeks so far.`}
            </p>
          </div>
        </>
      )}
    </section>
  )
}
