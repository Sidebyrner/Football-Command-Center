import { useState } from 'react'
import { Loader2, Shield, AlertTriangle } from 'lucide-react'
import { useDefenseVsPosition } from '../../hooks/useDefenseVsPosition'
import { useWeeklySeasons } from '../../hooks/usePlayerWeekly'
import DvpHeatmap from './DvpHeatmap'
import DvpRankedList from './DvpRankedList'
import { FilterChip, ScreenSection, SegmentBar } from '@ui/components/Screen'
import '../../screens/tools/researchTools.css'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K']
const VIEWS = ['heatmap', 'ranked']

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
      <ScreenSection title="Defense vs position" icon={Shield} hue="var(--hue-team)">
        <p className="card t-meta muted" style={{ margin: 0 }}>
          No weekly data on disk. Run <code>npm run preprocess-nflverse</code> to build it.
        </p>
      </ScreenSection>
    )
  }

  return (
    <ScreenSection
      title="Defense vs position"
      icon={Shield}
      hue="var(--hue-team)"
      subtitle="How generous each defense is to each position, in your league's points."
    >
      <div className="card rt-stack">
        <div className="rt-row" style={{ justifyContent: 'space-between' }}>
          {seasons.length > 1 && (
            <div className="rt-row" role="group" aria-label="Season">
              {seasons.map((s) => (
                <FilterChip
                  key={s.season}
                  label={`${s.season}${!s.complete ? ` (${s.weeks} wk)` : ''}`}
                  selected={active === s.season}
                  onClick={() => setSeason(s.season)}
                />
              ))}
            </div>
          )}
          <div style={{ minWidth: 220, flex: '0 1 260px', marginLeft: 'auto' }}>
            <SegmentBar
              options={VIEWS}
              value={view}
              label={(v) => (v === 'heatmap' ? 'Heatmap' : 'By position')}
              onChange={setView}
              ariaLabel="Defense vs position view"
            />
          </div>
        </div>

        {loading && (
          <p className="t-meta muted flex items-center gap-1.5" role="status" style={{ margin: 0 }}>
            <Loader2 size={13} className="animate-spin" aria-hidden /> Scoring every game log against your league's rules…
          </p>
        )}
        {error && <p className="t-meta" role="alert" style={{ margin: 0, color: 'var(--sit)' }}>{error}</p>}

        {!loading && dvp && (
          <>
            {view === 'ranked' && (
              <div className="rt-row" role="group" aria-label="Position">
                {POSITIONS.map((p) => (
                  <FilterChip key={p} label={p} selected={position === p} onClick={() => setPosition(p)} />
                ))}
              </div>
            )}

            {view === 'heatmap'
              ? <DvpHeatmap dvp={dvp} myTeamAbbrs={myTeamAbbrs} />
              : <DvpRankedList dvp={dvp} position={position} myTeamAbbrs={myTeamAbbrs} />}

            <div className="rt-stack" style={{ gap: 'var(--space-xs)' }}>
              <p className="t-meta muted" style={{ margin: 0 }}>
                Points allowed per <strong style={{ color: 'var(--text)' }}>game the defense played</strong>,
                summed across every player at that position who faced them, scored by{' '}
                <strong style={{ color: 'var(--text)' }}>{profileName ?? 'your league profile'}</strong>.
                Volume counts: a defense that keeps facing three-receiver offenses will look soft to WRs.
              </p>
              <p className="t-meta flex items-start gap-1" style={{ margin: 0, color: 'var(--caution)' }}>
                <AlertTriangle size={12} className="flex-shrink-0" style={{ marginTop: 2 }} aria-hidden />
                <span>
                  This is {dvp.season} only — never blended with another year. Last season's
                  defense is not this season's defense; personnel and coordinators turn over.
                  {seasonMeta && !seasonMeta.complete && ` ${dvp.season} has ${dvp.weeks.length} weeks so far.`}
                </span>
              </p>
            </div>
          </>
        )}
      </div>
    </ScreenSection>
  )
}
