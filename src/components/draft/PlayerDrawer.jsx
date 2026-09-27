import { useState, useEffect, useRef } from 'react'
import { X, Star, AlertTriangle, Info, TrendingDown, TrendingUp, BookOpen, Plus, Cpu, BarChart2, Loader2, Database, ListChecks, Activity } from 'lucide-react'
import { getStatusLabel } from '../../utils/playerHelpers'
import { injuryTone } from './injuryTone'
import { PositionChip, PlayerAvatar, TeamLogo } from '@ui/components/Player'
import { FilterChip, SegmentBar } from '@ui/components/Screen'
import './draft.css'
import useResearchStore, { selectPlayerItems } from '../../store/useResearchStore'
import ResearchCard from '../research/ResearchCard'
import ResearchItemForm from '../research/ResearchItemForm'
import EvalPanel from '../eval/EvalPanel'
import { usePlayerStats } from '../../hooks/usePlayerStats'
import { usePlayerWeekly, useWeeklySeasons } from '../../hooks/usePlayerWeekly'
import WeeklyGameLog from '../weekly/WeeklyGameLog'
import ConsistencyPanel from '../weekly/ConsistencyPanel'
import useMockDraftStore from '../../store/useMockDraftStore'

// ---------------------------------------------------------------------------
// Watch factor derivation — purely rule-based, no AI
// ---------------------------------------------------------------------------

function deriveWatchFactors(player, researchItems) {
  const factors = []

  if (player.team === 'FA') {
    factors.push({ level: 'high', text: 'Free agent — currently unsigned' })
  }

  if (player.injuryStatus) {
    const isHigh = ['Out', 'IR', 'PUP', 'Doubtful'].includes(player.injuryStatus)
    factors.push({
      level: isHigh ? 'high' : 'mid',
      text: `Injury status: ${player.injuryStatus}`,
    })
  }

  if (player.trending === 'drop') {
    factors.push({ level: 'mid', text: 'Trending drop across leagues' })
  }

  if (player.yearsExp === 0) {
    factors.push({ level: 'info', text: 'Rookie — no NFL track record' })
  }

  if (player.age != null && player.age >= 32) {
    factors.push({ level: 'mid', text: `Age ${player.age} — monitor usage and workload` })
  }

  const injuryNotes = researchItems.filter((i) => i.tags.includes('injury'))
  if (injuryNotes.length > 0) {
    factors.push({
      level: 'mid',
      text: `${injuryNotes.length} saved injury note${injuryNotes.length > 1 ? 's' : ''}`,
    })
  }

  const roleNotes = researchItems.filter(
    (i) => i.tags.includes('depth-chart') || i.tags.includes('role-change')
  )
  if (roleNotes.length > 0) {
    factors.push({
      level: 'info',
      text: `Role/depth chart item${roleNotes.length > 1 ? 's' : ''} saved`,
    })
  }

  return factors
}

function FactorIcon({ level }) {
  if (level === 'high') return <AlertTriangle size={14} color="var(--sit)" aria-label="High concern" />
  if (level === 'mid') return <AlertTriangle size={14} color="var(--caution)" aria-label="Worth watching" />
  return <Info size={14} color="var(--text-3)" aria-label="Note" />
}

// ---------------------------------------------------------------------------
// Context row helper
// ---------------------------------------------------------------------------

function ContextPill({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="dd-context-item">
      <span className="t-micro faint">{label}</span>
      <span className="t-body" style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function expLabel(yearsExp) {
  if (yearsExp == null) return null
  if (yearsExp === 0) return 'Rookie'
  if (yearsExp === 1) return '2nd yr'
  return `${yearsExp + 1}th yr`
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ children }) {
  return (
    <h3 className="t-micro faint" style={{ margin: 0 }}>
      {children}
    </h3>
  )
}

// ---------------------------------------------------------------------------
// Stats tab — nflverse historical season stats
// ---------------------------------------------------------------------------

function fmt(v, decimals = 0) {
  if (v == null || isNaN(v)) return '—'
  return decimals > 0 ? Number(v).toFixed(decimals) : Math.round(v).toLocaleString()
}

function fmtPct(v) {
  if (v == null || isNaN(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function StatRow({ label, value, highlight }) {
  return (
    <div className={`dd-stat-row t-meta${highlight ? ' highlight' : ''}`}>
      <span className="muted">{label}</span>
      <span className="value">{value}</span>
    </div>
  )
}

function StatSection({ title, children }) {
  return (
    <div className="card" style={{ padding: 'var(--space-m) var(--space-l)' }}>
      <p className="t-micro faint" style={{ margin: '0 0 4px' }}>{title}</p>
      {children}
    </div>
  )
}

function QBStats({ s }) {
  return (
    <>
      <StatSection title="Passing">
        <StatRow label="Games" value={fmt(s.games)} />
        <StatRow label="Completions / Att" value={s.attempts > 0 ? `${fmt(s.completions)}/${fmt(s.attempts)}` : '—'} />
        <StatRow label="Completion %" value={fmtPct(s.completion_pct)} />
        <StatRow label="Passing Yards" value={fmt(s.passing_yards)} />
        <StatRow label="Passing TDs" value={fmt(s.passing_tds)} />
        <StatRow label="Interceptions" value={fmt(s.interceptions)} />
        <StatRow label="Sacks" value={fmt(s.sacks)} />
        <StatRow label="ADOT" value={fmt(s.adot_qb, 1)} />
      </StatSection>
      <StatSection title="Rushing">
        <StatRow label="Carries" value={fmt(s.carries)} />
        <StatRow label="Rush Yards" value={fmt(s.rushing_yards)} />
        <StatRow label="Rush TDs" value={fmt(s.rushing_tds)} />
        {s.carries > 0 && <StatRow label="Yds / Carry" value={fmt(s.yards_per_carry, 1)} />}
      </StatSection>
      <StatSection title="Fantasy">
        <StatRow label="Fantasy Pts (Std)" value={fmt(s.fantasy_points, 1)} />
        <StatRow label="Fantasy Pts (PPR)" value={fmt(s.fantasy_points_ppr, 1)} />
        <StatRow label="Pts / Game" value={fmt(s.fantasy_points_per_game, 1)} />
      </StatSection>
    </>
  )
}

function RBStats({ s }) {
  return (
    <>
      <StatSection title="Rushing">
        <StatRow label="Games" value={fmt(s.games)} />
        <StatRow label="Carries" value={fmt(s.carries)} />
        <StatRow label="Rush Yards" value={fmt(s.rushing_yards)} />
        <StatRow label="Rush TDs" value={fmt(s.rushing_tds)} />
        {s.carries > 0 && <StatRow label="Yds / Carry" value={fmt(s.yards_per_carry, 1)} />}
        {s.games > 0 && <StatRow label="Carries / Game" value={fmt(s.carries_per_game, 1)} />}
      </StatSection>
      <StatSection title="Receiving">
        <StatRow label="Targets" value={fmt(s.targets)} />
        <StatRow label="Receptions" value={fmt(s.receptions)} />
        <StatRow label="Rec Yards" value={fmt(s.receiving_yards)} />
        <StatRow label="Rec TDs" value={fmt(s.receiving_tds)} />
        <StatRow label="Catch Rate" value={fmtPct(s.catch_rate)} />
        {s.target_share > 0 && <StatRow label="Target Share" value={fmtPct(s.target_share)} />}
        {s.wopr > 0 && <StatRow label="WOPR" value={fmt(s.wopr, 2)} />}
      </StatSection>
      <StatSection title="Fantasy">
        <StatRow label="Fantasy Pts (Std)" value={fmt(s.fantasy_points, 1)} />
        <StatRow label="Fantasy Pts (PPR)" value={fmt(s.fantasy_points_ppr, 1)} />
        <StatRow label="Pts / Game" value={fmt(s.fantasy_points_per_game, 1)} />
      </StatSection>
    </>
  )
}

function WRTEStats({ s }) {
  return (
    <>
      <StatSection title="Receiving">
        <StatRow label="Games" value={fmt(s.games)} />
        <StatRow label="Targets" value={fmt(s.targets)} />
        <StatRow label="Receptions" value={fmt(s.receptions)} />
        <StatRow label="Rec Yards" value={fmt(s.receiving_yards)} />
        <StatRow label="Rec TDs" value={fmt(s.receiving_tds)} />
        {s.games > 0 && <StatRow label="Targets / Game" value={fmt(s.targets_per_game, 1)} />}
        {s.receptions > 0 && s.receiving_yards > 0 && (
          <StatRow label="Yds / Reception" value={fmt(s.receiving_yards / s.receptions, 1)} />
        )}
      </StatSection>
      <StatSection title="Advanced">
        <StatRow label="Catch Rate" value={fmtPct(s.catch_rate)} />
        {s.target_share > 0 && <StatRow label="Target Share" value={fmtPct(s.target_share)} />}
        {s.air_yards_share > 0 && <StatRow label="Air Yards Share" value={fmtPct(s.air_yards_share)} />}
        {s.adot > 0 && <StatRow label="ADOT" value={fmt(s.adot, 1)} />}
        {s.wopr > 0 && <StatRow label="WOPR" value={fmt(s.wopr, 2)} />}
        {s.racr > 0 && <StatRow label="RACR" value={fmt(s.racr, 2)} />}
      </StatSection>
      <StatSection title="Fantasy">
        <StatRow label="Fantasy Pts (Std)" value={fmt(s.fantasy_points, 1)} />
        <StatRow label="Fantasy Pts (PPR)" value={fmt(s.fantasy_points_ppr, 1)} />
        <StatRow label="Pts / Game" value={fmt(s.fantasy_points_per_game, 1)} />
      </StatSection>
    </>
  )
}

function SeasonStats({ seasonData, position }) {
  const pos = position?.toUpperCase()
  if (pos === 'QB') return <QBStats s={seasonData} />
  if (pos === 'RB') return <RBStats s={seasonData} />
  if (pos === 'WR' || pos === 'TE') return <WRTEStats s={seasonData} />
  return (
    <p className="t-meta faint" style={{ margin: 0 }}>
      No stat breakdown available for {position}.
    </p>
  )
}

function StatsTab({ player }) {
  const { history, seasons, loading, error, hasData } = usePlayerStats(player)
  const [activeSeason, setActiveSeason] = useState(null)

  // Auto-select most recent season when data loads
  useEffect(() => {
    if (seasons.length > 0 && !activeSeason) {
      setActiveSeason(seasons[0])
    }
  }, [seasons, activeSeason])

  if (!player.gsisId) {
    return (
      <div className="dd-empty">
        <Database size={22} aria-hidden />
        <p className="t-body muted" style={{ margin: 0 }}>Player ID unavailable.</p>
        <p className="t-meta" style={{ margin: 0 }}>No GSIS ID in Sleeper metadata for this player.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="dd-empty" role="status">
        <Loader2 size={20} color="var(--accent)" className="dd-spin" aria-hidden />
        <p className="t-meta" style={{ margin: 0 }}>Loading historical stats…</p>
      </div>
    )
  }

  if (error && error.includes('preprocess')) {
    return (
      <div className="dd-empty">
        <Database size={22} aria-hidden />
        <p className="t-body muted" style={{ margin: 0, fontWeight: 600 }}>Historical data not loaded</p>
        <p className="t-meta" style={{ margin: 0 }}>Run the preprocessing script to populate nflverse stats:</p>
        <code className="dd-code">npm run preprocess-nflverse</code>
        <p className="t-meta" style={{ margin: 0 }}>
          This downloads and preprocesses nflverse player_stats for 2023–2024.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <p className="dd-callout-row t-meta" style={{ margin: 0, color: 'var(--sit)' }} role="alert">
        <AlertTriangle size={14} aria-hidden /> <span>{error}</span>
      </p>
    )
  }

  if (!hasData) {
    return (
      <div className="dd-empty">
        <Database size={22} aria-hidden />
        <p className="t-body muted" style={{ margin: 0 }}>No historical data for this player.</p>
        <p className="t-meta" style={{ margin: 0 }}>
          Could be a rookie or player not found in nflverse. Run{' '}
          <code className="dd-code">npm run preprocess-nflverse</code> to refresh.
        </p>
      </div>
    )
  }

  const currentSeason = activeSeason ?? seasons[0]
  const seasonData = history[String(currentSeason)]

  return (
    <section>
      {/* Season selector */}
      {seasons.length > 1 && (
        <div className="dd-chip-row" role="group" aria-label="Season">
          {seasons.map((yr) => (
            <FilterChip key={yr} label={String(yr)} selected={currentSeason === yr} onClick={() => setActiveSeason(yr)} />
          ))}
        </div>
      )}

      {/* Team context line */}
      {seasonData?.team && (
        <p className="t-meta faint" style={{ margin: 0 }}>
          {currentSeason} · {seasonData.team}
        </p>
      )}

      {/* Stats breakdown by position */}
      <div className="dd-list" style={{ gap: 'var(--space-m)' }}>
        <SeasonStats seasonData={seasonData} position={player.position} />
      </div>

      {/* Source attribution */}
      <p className="t-caption faint" style={{ margin: 0 }}>
        Source: nflverse player_stats · Regular season only
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Weekly tab — real week-by-week fantasy points under the league's own scoring.
// Distinct from the Stats tab (season aggregates) and from Evaluate (a 0-100
// percentile rank): this one is denominated in points you actually banked.
// ---------------------------------------------------------------------------

function WeeklyTab({ player }) {
  const manifestSeasons = useWeeklySeasons()
  const [season, setSeason] = useState(null)
  const active = season ?? manifestSeasons[0]?.season ?? null

  const { scored, distribution, loading, error, hasData, seasonMeta, profileName } =
    usePlayerWeekly(player, active)

  if (!player?.gsisId) {
    return (
      <p className="t-meta faint" style={{ margin: 0 }}>
        No nflverse id for this player, so there's no game log to score.
      </p>
    )
  }
  if (loading) {
    return (
      <p className="dd-callout-row t-meta muted" style={{ margin: 0 }} role="status">
        <Loader2 size={14} className="dd-spin" aria-hidden /> Loading weekly game log…
      </p>
    )
  }
  if (error) {
    return (
      <p className="dd-callout-row t-meta" style={{ margin: 0, color: 'var(--sit)' }} role="alert">
        <AlertTriangle size={14} aria-hidden /> <span>{error}</span>
      </p>
    )
  }
  if (!hasData) {
    return (
      <p className="t-meta faint" style={{ margin: 0 }}>
        No {active ?? ''} game log for this player yet.
        {manifestSeasons.length === 0 && ' Run: npm run preprocess-nflverse'}
      </p>
    )
  }

  return (
    <section style={{ gap: 'var(--space-l)' }}>
      {manifestSeasons.length > 1 && (
        <div className="dd-chip-row" role="group" aria-label="Season">
          {manifestSeasons.map((s) => (
            <FilterChip
              key={s.season}
              label={`${s.season}${!s.complete ? ` (${s.weeks} wk)` : ''}`}
              selected={active === s.season}
              onClick={() => setSeason(s.season)}
            />
          ))}
        </div>
      )}

      <WeeklyGameLog
        scored={scored}
        distribution={distribution}
        season={active}
        profileName={profileName}
      />
      <ConsistencyPanel
        scored={scored}
        distribution={distribution}
        season={active}
        profileName={profileName}
        seasonMeta={seasonMeta}
      />

      <p className="t-caption faint" style={{ margin: 0, paddingTop: 'var(--space-s)', borderTop: '0.5px solid var(--stroke)' }}>
        Source: nflverse weekly player stats · regular season only
      </p>
    </section>
  )
}

// Main drawer
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'weekly', label: 'Weekly', icon: Activity },
  { key: 'stats', label: 'Stats', icon: BarChart2 },
  { key: 'evaluate', label: 'Evaluate', icon: Cpu },
  { key: 'research', label: 'Research' },
]

export default function PlayerDrawer({ player, watchlist, onToggleWatch, onClose }) {
  const [addingItem, setAddingItem] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const drawerRef = useRef(null)

  const { items, notes, addItem, pinItem, archiveItem, deleteItem, updateNote } = useResearchStore()
  const playerItems = selectPlayerItems(items, player?.id, player?.name)
  const note = player ? (notes[player.id]?.text ?? '') : ''

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Prevent background scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!player) return null

  const isWatched = watchlist.has(player.id)

  const addTarget = useMockDraftStore((s) => s.addTarget)
  const planTargets = useMockDraftStore((s) => s.targets)
  const inPlan = (planTargets[player.position] ?? []).some((t) => t.playerId === player.id)
  const injuryColor = injuryTone(player.injuryStatus)
  const watchFactors = deriveWatchFactors(player, playerItems)

  function handleSaveItem(fields) {
    addItem(fields)
    setAddingItem(false)
  }

  function handleNoteChange(e) {
    updateNote(player.id, e.target.value)
  }

  const tabKeys = TABS.map((t) => t.key)
  const tabLabel = (key) => TABS.find((t) => t.key === key)?.label ?? key

  return (
    <div className="dd-drawer-scrim" onClick={onClose}>
      <aside
        ref={drawerRef}
        className="dd-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Player details: ${player.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dd-drawer-grabber" aria-hidden />

        {/* Header */}
        <header className="dd-drawer-head">
          <PlayerAvatar sleeperID={player.id} name={player.name} position={player.position} size={48} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dd-chip-row t-meta" style={{ gap: 6 }}>
              <PositionChip position={player.position} />
              <TeamLogo code={player.team} size={16} />
              <span className="muted">{player.team}</span>
              {player.number && <span className="faint">#{player.number}</span>}
            </div>
            <h2 className="t-title dd-truncate">{player.name}</h2>
            <div className="dd-chip-row t-meta" style={{ gap: 8, marginTop: 4 }}>
              <span className="dd-status-dot">
                <span className="dd-dot" style={{ background: injuryColor }} aria-hidden />
                <span className="muted">{getStatusLabel(player.injuryStatus)}</span>
              </span>
              {player.trending === 'add' && (
                <span className="dd-trend add"><TrendingUp size={12} aria-hidden /> Add</span>
              )}
              {player.trending === 'drop' && (
                <span className="dd-trend drop"><TrendingDown size={12} aria-hidden /> Drop</span>
              )}
            </div>
          </div>

          <div className="dd-drawer-actions">
            <button
              type="button"
              onClick={() => !inPlan && addTarget(player)}
              disabled={inPlan}
              title={inPlan ? 'Already in your draft plan' : 'Add to draft plan'}
              aria-label={inPlan ? 'Already in your draft plan' : 'Add to draft plan'}
              className={`dd-icon-button large${inPlan ? ' done' : ''}`}
              style={inPlan ? { opacity: 1 } : undefined}
            >
              <ListChecks size={17} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onToggleWatch(player.id)}
              title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
              aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
              aria-pressed={isWatched}
              className={`dd-icon-button large${isWatched ? ' on' : ''}`}
            >
              <Star size={17} fill={isWatched ? 'currentColor' : 'none'} aria-hidden />
            </button>
            <button type="button" onClick={onClose} className="dd-icon-button large" aria-label="Close drawer">
              <X size={17} aria-hidden />
            </button>
          </div>
        </header>

        {/* Tab navigation */}
        <div className="dd-drawer-tabs">
          <SegmentBar options={tabKeys} value={activeTab} label={tabLabel} onChange={setActiveTab} ariaLabel="Player details sections" />
        </div>

        {/* Scrollable body */}
        <div className="dd-drawer-body">

          {/* ── Overview tab ─────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* Context grid */}
              <section>
                <SectionHeader>Context</SectionHeader>
                <div className="card dd-context-grid">
                  <ContextPill label="ADP" value={player.adp != null ? Math.round(player.adp) : '—'} />
                  <ContextPill label="Bye" value={player.bye ?? '—'} />
                  <ContextPill label="Age" value={player.age ?? '—'} />
                  <ContextPill label="Exp" value={expLabel(player.yearsExp) ?? '—'} />
                  {player.depthChartOrder != null && (
                    <ContextPill label="Depth" value={`#${player.depthChartOrder}`} />
                  )}
                  {player.college && (
                    <div className="dd-context-item wide">
                      <span className="t-micro faint">College</span>
                      <span className="t-body dd-truncate" style={{ fontWeight: 600 }}>{player.college}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Watch factors */}
              {watchFactors.length > 0 && (
                <section>
                  <SectionHeader>Watch Factors</SectionHeader>
                  <div className="card">
                    <ul className="dd-list-plain">
                      {watchFactors.map((f, i) => (
                        <li key={i} className="dd-factor t-meta">
                          <FactorIcon level={f.level} />
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {/* Personal notes */}
              <section>
                <label htmlFor="dd-player-note" className="t-micro faint">Your Notes</label>
                <textarea
                  id="dd-player-note"
                  value={note}
                  onChange={handleNoteChange}
                  placeholder="Add notes about this player…"
                  rows={4}
                  className="dd-field"
                />
                {notes[player.id]?.updatedAt && (
                  <p className="t-caption faint" style={{ margin: 0 }}>
                    Last edited {new Date(notes[player.id].updatedAt).toLocaleString()}
                  </p>
                )}
              </section>
            </>
          )}

          {/* ── Weekly tab ────────────────────────────────────── */}
          {activeTab === 'weekly' && (
            <WeeklyTab player={player} />
          )}

          {/* ── Stats tab ─────────────────────────────────────── */}
          {activeTab === 'stats' && (
            <StatsTab player={player} />
          )}

          {/* ── Evaluate tab ──────────────────────────────────── */}
          {activeTab === 'evaluate' && (
            <EvalPanel player={player} />
          )}

          {/* ── Research tab ──────────────────────────────────── */}
          {activeTab === 'research' && (
            <section>
              <div className="dd-section-label">
                <SectionHeader>
                  Research
                  {playerItems.length > 0 && (
                    <span className="count t-meta" style={{ marginLeft: 6, color: 'var(--accent)' }}>
                      {playerItems.length}
                    </span>
                  )}
                </SectionHeader>
                {!addingItem && (
                  <button type="button" onClick={() => setAddingItem(true)} className="dd-text-button t-meta">
                    <Plus size={13} aria-hidden /> Add
                  </button>
                )}
              </div>

              {addingItem && (
                <ResearchItemForm
                  player={{ id: player.id, name: player.name, team: player.team, position: player.position }}
                  onSave={handleSaveItem}
                  onCancel={() => setAddingItem(false)}
                />
              )}

              {playerItems.length === 0 && !addingItem ? (
                <div className="dd-empty">
                  <BookOpen size={22} aria-hidden />
                  <p className="t-meta" style={{ margin: 0 }}>No research saved yet.</p>
                  <button type="button" onClick={() => setAddingItem(true)} className="dd-text-button t-meta">
                    Add your first note
                  </button>
                </div>
              ) : (
                <div className="dd-list" style={{ gap: 'var(--space-s)' }}>
                  {playerItems.map((item) => (
                    <ResearchCard
                      key={item.id}
                      item={item}
                      compact
                      onPin={pinItem}
                      onArchive={archiveItem}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
