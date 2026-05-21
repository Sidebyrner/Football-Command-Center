import { useState, useEffect, useRef } from 'react'
import { X, Star, AlertTriangle, Info, TrendingDown, BookOpen, Plus, Cpu, BarChart2, Loader2, Database } from 'lucide-react'
import { getStatusColor, getStatusLabel, getPositionColor } from '../../utils/playerHelpers'
import useResearchStore, { selectPlayerItems } from '../../store/useResearchStore'
import ResearchCard from '../research/ResearchCard'
import ResearchItemForm from '../research/ResearchItemForm'
import EvalPanel from '../eval/EvalPanel'
import { usePlayerStats } from '../../hooks/usePlayerStats'

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
  if (level === 'high') return <AlertTriangle size={12} className="text-[var(--color-sit)] flex-shrink-0 mt-px" />
  if (level === 'mid') return <AlertTriangle size={12} className="text-[var(--color-caution)] flex-shrink-0 mt-px" />
  return <Info size={12} className="text-[var(--color-text-faint)] flex-shrink-0 mt-px" />
}

// ---------------------------------------------------------------------------
// Context row helper
// ---------------------------------------------------------------------------

function ContextPill({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wide">{label}</span>
      <span className="text-xs font-medium text-[var(--color-text)] tabular-nums">{value}</span>
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
    <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">
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
    <div className={`flex justify-between items-center py-1.5 border-b border-[var(--color-border)] last:border-0 ${highlight ? 'opacity-100' : ''}`}>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-[var(--color-text)]">{value}</span>
    </div>
  )
}

function StatSection({ title, children }) {
  return (
    <div className="rounded bg-[var(--color-surface-2)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1.5">{title}</p>
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
    <p className="text-xs text-[var(--color-text-faint)]">
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
      <div className="flex flex-col items-center py-10 text-center gap-2">
        <Database size={20} className="text-[var(--color-text-faint)]" />
        <p className="text-xs text-[var(--color-text-faint)]">Player ID unavailable.</p>
        <p className="text-[10px] text-[var(--color-text-faint)] max-w-48 leading-relaxed">
          No GSIS ID in Sleeper metadata for this player.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-10 gap-2">
        <Loader2 size={18} className="text-[var(--color-accent)] animate-spin" />
        <p className="text-xs text-[var(--color-text-faint)]">Loading historical stats…</p>
      </div>
    )
  }

  if (error && error.includes('preprocess')) {
    return (
      <div className="flex flex-col items-center py-8 text-center gap-2 px-2">
        <Database size={20} className="text-[var(--color-text-faint)]" />
        <p className="text-xs text-[var(--color-text-muted)] font-semibold">Historical data not loaded</p>
        <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed max-w-56">
          Run the preprocessing script to populate nflverse stats:
        </p>
        <code className="text-[10px] bg-[var(--color-surface-2)] text-[var(--color-accent)] px-2 py-1 rounded border border-[var(--color-border)]">
          npm run preprocess-nflverse
        </code>
        <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed max-w-56">
          This downloads and preprocesses nflverse player_stats for 2023–2024.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-xs text-[var(--color-sit)] py-4">{error}</p>
    )
  }

  if (!hasData) {
    return (
      <div className="flex flex-col items-center py-10 text-center gap-2">
        <Database size={20} className="text-[var(--color-text-faint)]" />
        <p className="text-xs text-[var(--color-text-faint)]">No historical data for this player.</p>
        <p className="text-[10px] text-[var(--color-text-faint)] max-w-48 leading-relaxed">
          Could be a rookie or player not found in nflverse. Run{' '}
          <code className="text-[var(--color-accent)]">npm run preprocess-nflverse</code> to refresh.
        </p>
      </div>
    )
  }

  const currentSeason = activeSeason ?? seasons[0]
  const seasonData = history[String(currentSeason)]

  return (
    <div className="space-y-4">
      {/* Season selector */}
      {seasons.length > 1 && (
        <div className="flex gap-1.5">
          {seasons.map((yr) => (
            <button
              key={yr}
              onClick={() => setActiveSeason(yr)}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                currentSeason === yr
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]'
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
      )}

      {/* Team context line */}
      {seasonData?.team && (
        <p className="text-[10px] text-[var(--color-text-faint)]">
          {currentSeason} · {seasonData.team}
        </p>
      )}

      {/* Stats breakdown by position */}
      <div className="space-y-3">
        <SeasonStats seasonData={seasonData} position={player.position} />
      </div>

      {/* Source attribution */}
      <p className="text-[10px] text-[var(--color-text-faint)] pt-1">
        Source: nflverse player_stats · Regular season only
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main drawer
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'overview', label: 'Overview' },
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
  const injuryColor = getStatusColor(player.injuryStatus)
  const posColor = getPositionColor(player.position)
  const watchFactors = deriveWatchFactors(player, playerItems)

  function handleSaveItem(fields) {
    addItem(fields)
    setAddingItem(false)
  }

  function handleNoteChange(e) {
    updateNote(player.id, e.target.value)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        ref={drawerRef}
        className="fixed right-0 top-0 h-full z-50 flex flex-col bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl"
        style={{ width: 'min(420px, 100vw)' }}
        aria-label={`Player details: ${player.name}`}
      >
        {/* Sticky header */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{ color: posColor, backgroundColor: `${posColor}20` }}
                >
                  {player.position}
                </span>
                <span className="text-xs text-[var(--color-text-muted)] truncate">
                  {player.team}
                </span>
                {player.number && (
                  <span className="text-xs text-[var(--color-text-faint)]">#{player.number}</span>
                )}
              </div>
              <h2 className="font-display font-semibold text-base text-[var(--color-text)] leading-tight truncate">
                {player.name}
              </h2>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className="inline-block rounded-full flex-shrink-0"
                  style={{ width: 7, height: 7, backgroundColor: injuryColor }}
                />
                <span className="text-xs text-[var(--color-text-muted)]">
                  {getStatusLabel(player.injuryStatus)}
                </span>
                {player.trending === 'add' && (
                  <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">▲ Add</span>
                )}
                {player.trending === 'drop' && (
                  <span className="text-[10px] font-semibold text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded">▼ Drop</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => onToggleWatch(player.id)}
                title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                className={`p-1.5 rounded transition-colors ${
                  isWatched
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
                }`}
              >
                <Star size={16} fill={isWatched ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
                aria-label="Close drawer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex-shrink-0 flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors relative ${
                activeTab === key
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]'
              }`}
            >
              {Icon && <Icon size={11} />}
              {label}
              {activeTab === key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* ── Overview tab ─────────────────────────────────── */}
          {activeTab === 'overview' && (
            <>
              {/* Context grid */}
              <section>
                <SectionHeader>Context</SectionHeader>
                <div className="grid grid-cols-4 gap-3 p-3 rounded bg-[var(--color-surface-2)]">
                  <ContextPill label="Rank" value={player.rank ?? '—'} />
                  <ContextPill label="Bye" value={player.byeWeek ?? '—'} />
                  <ContextPill label="Age" value={player.age ?? '—'} />
                  <ContextPill label="Exp" value={expLabel(player.yearsExp) ?? '—'} />
                  {player.depthChartOrder != null && (
                    <ContextPill label="Depth" value={`#${player.depthChartOrder}`} />
                  )}
                  {player.college && (
                    <div className="col-span-3 flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wide">College</span>
                      <span className="text-xs font-medium text-[var(--color-text)] truncate">{player.college}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Watch factors */}
              {watchFactors.length > 0 && (
                <section>
                  <SectionHeader>Watch Factors</SectionHeader>
                  <ul className="space-y-1.5">
                    {watchFactors.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]">
                        <FactorIcon level={f.level} />
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Personal notes */}
              <section>
                <SectionHeader>Your Notes</SectionHeader>
                <textarea
                  value={note}
                  onChange={handleNoteChange}
                  placeholder="Add notes about this player…"
                  rows={4}
                  className="w-full px-2.5 py-2 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
                />
                {notes[player.id]?.updatedAt && (
                  <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
                    Last edited {new Date(notes[player.id].updatedAt).toLocaleString()}
                  </p>
                )}
              </section>
            </>
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
              <div className="flex items-center justify-between mb-2">
                <SectionHeader>
                  Research
                  {playerItems.length > 0 && (
                    <span className="ml-1.5 text-[10px] text-[var(--color-accent)] font-bold normal-case tracking-normal">
                      {playerItems.length}
                    </span>
                  )}
                </SectionHeader>
                {!addingItem && (
                  <button
                    onClick={() => setAddingItem(true)}
                    className="flex items-center gap-1 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-accent)] transition-colors mb-2"
                  >
                    <Plus size={12} /> Add
                  </button>
                )}
              </div>

              {addingItem && (
                <div className="mb-3">
                  <ResearchItemForm
                    player={{ id: player.id, name: player.name, team: player.team, position: player.position }}
                    onSave={handleSaveItem}
                    onCancel={() => setAddingItem(false)}
                  />
                </div>
              )}

              {playerItems.length === 0 && !addingItem ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <BookOpen size={20} className="text-[var(--color-text-faint)] mb-2" />
                  <p className="text-xs text-[var(--color-text-faint)]">No research saved yet.</p>
                  <button
                    onClick={() => setAddingItem(true)}
                    className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    Add your first note
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
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
    </>
  )
}
