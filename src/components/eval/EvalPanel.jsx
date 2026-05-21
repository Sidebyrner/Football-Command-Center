import { useState, useMemo } from 'react'
import { TrendingUp, BarChart2, AlertTriangle, Info, Zap, Shield, ChevronDown, ChevronUp } from 'lucide-react'
import { evaluateWeekly, evaluateDraft } from '../../utils/evaluationEngine'
import useScoringProfileStore from '../../store/useScoringProfileStore'
import { getPositionColor } from '../../utils/playerHelpers'
import { usePlayerStats } from '../../hooks/usePlayerStats'
import { toEvalMetrics } from '../../services/nflverseService'

// ── Designation badge ────────────────────────────────────────────────────────
const DESIGNATION_STYLES = {
  'Strong Start': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'Start':        { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  'Fringe':       { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/25' },
  'Sit':          { bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/25' },
  'High Risk / High Upside': { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/25' },
  'Out':          { bg: 'bg-rose-500/15',    text: 'text-rose-500',    border: 'border-rose-500/30' },
}

const TIER_STYLES = {
  1: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  2: { bg: 'bg-sky-500/10',    text: 'text-sky-400',     border: 'border-sky-500/25' },
  3: { bg: 'bg-amber-500/10',  text: 'text-amber-400',   border: 'border-amber-500/25' },
  4: { bg: 'bg-slate-500/10',  text: 'text-slate-400',   border: 'border-slate-500/20' },
  5: { bg: 'bg-rose-500/10',   text: 'text-rose-400',    border: 'border-rose-500/20' },
}

const RISK_COLORS = {
  'Low':      'text-emerald-400',
  'Moderate': 'text-amber-400',
  'High':     'text-rose-400',
  'Very High':'text-rose-500',
}

function DesignationBadge({ designation }) {
  const s = DESIGNATION_STYLES[designation] ?? DESIGNATION_STYLES['Fringe']
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded border text-xs font-semibold ${s.bg} ${s.text} ${s.border}`}>
      {designation}
    </span>
  )
}

function TierBadge({ tier, label }) {
  const s = TIER_STYLES[tier] ?? TIER_STYLES[5]
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded border text-xs font-semibold ${s.bg} ${s.text} ${s.border}`}>
      {label}
    </span>
  )
}

// ── Score arc / ring visual ──────────────────────────────────────────────────
function ScoreRing({ score, color }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }}>
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(248,250,252,0.07)" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span className="absolute text-lg font-bold tabular-nums" style={{ color }}>
        {score}
      </span>
    </div>
  )
}

// ── Factor bar ────────────────────────────────────────────────────────────────
function FactorBar({ factor }) {
  const LABELS = {
    targetShare: 'Target Share',
    yprr: 'Yds / Route Run',
    qbRating: 'QB Rating',
    airYardsShare: 'Air Yards Share',
    redZoneTargets: 'RZ Targets',
    firstReadTargetRate: 'First Read %',
    adot: 'ADOT',
    trueCatchRate: 'True Catch Rate',
    olPassProtection: 'OL Protection',
    separation: 'Separation',
    completionPct: 'Completion %',
    impliedTeamTotal: 'Team Total',
    last4Snaps: 'Snap % (L4)',
    rushingAttempts: 'Rush Attempts',
    opponentDefRankFavor: 'Matchup',
    sackRatePenalty: 'Sack Resistance',
    intRatePenalty: 'Ball Security',
    seasonRushYards: 'Rush Yards',
  }

  const pct = Math.round((factor.value ?? 0) * 100)
  const label = LABELS[factor.key] ?? factor.key

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--color-text-muted)] w-28 flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--color-surface)] overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-[var(--color-text-faint)] w-7 text-right">{pct}</span>
    </div>
  )
}

// ── Format impact row ─────────────────────────────────────────────────────────
function FormatImpactRow({ item }) {
  const isBoost = item.type === 'boost'
  return (
    <li className={`flex items-start gap-1.5 text-[11px] ${isBoost ? 'text-emerald-400' : 'text-rose-400'}`}>
      <span className="flex-shrink-0 font-bold mt-px">{isBoost ? '▲' : '▼'}</span>
      <span>{item.text}</span>
    </li>
  )
}

// ── Missing factors disclosure ────────────────────────────────────────────────
function MissingFactors({ factors }) {
  const [open, setOpen] = useState(false)
  if (!factors.length) return null

  const LABELS = {
    targetShare: 'Target Share', yprr: 'YPRR', airYardsShare: 'Air Yards Share',
    redZoneTargets: 'RZ Targets', firstReadTargetRate: 'First Read %',
    adot: 'ADOT', trueCatchRate: 'True Catch Rate', separation: 'Separation',
    qbRating: 'QB Rating', olPassProtection: 'OL Protection',
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition-colors"
      >
        <Info size={10} />
        {factors.length} metric{factors.length > 1 ? 's' : ''} unavailable (mock data used)
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {open && (
        <p className="text-[10px] text-[var(--color-text-faint)] mt-1 leading-relaxed">
          {factors.map((f) => LABELS[f] ?? f).join(' · ')}
        </p>
      )}
    </div>
  )
}

// ── Weekly panel ─────────────────────────────────────────────────────────────
function WeeklyPanel({ result, posColor }) {
  return (
    <div className="space-y-4">
      {/* Score header */}
      <div className="flex items-center gap-4">
        <ScoreRing score={result.score} color={posColor} />
        <div className="space-y-1.5">
          <DesignationBadge designation={result.designation} />
          {result.injuryModifier < 1 && result.injuryModifier > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-[var(--color-caution)]">
              <AlertTriangle size={10} />
              Score reduced for injury status
            </div>
          )}
        </div>
      </div>

      {/* Top factors */}
      {result.topFactors.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">
            Top Inputs
          </h4>
          <div className="space-y-1.5">
            {result.topFactors.map((f) => (
              <FactorBar key={f.key} factor={f} />
            ))}
          </div>
          <MissingFactors factors={result.missingFactors} />
        </section>
      )}

      {/* Format impact */}
      {result.formatImpact.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">
            Format Impact
          </h4>
          <ul className="space-y-1">
            {result.formatImpact.map((item, i) => (
              <FormatImpactRow key={i} item={item} />
            ))}
          </ul>
        </section>
      )}

      {result.formatImpact.length === 0 && (
        <p className="text-[10px] text-[var(--color-text-faint)] italic">
          No notable format-specific impacts for this position.
        </p>
      )}
    </div>
  )
}

// ── Draft panel ───────────────────────────────────────────────────────────────
function DraftPanel({ result, posColor }) {
  return (
    <div className="space-y-4">
      {/* Score + tier */}
      <div className="flex items-center gap-4">
        <ScoreRing score={result.score} color={posColor} />
        <div className="space-y-1.5">
          <TierBadge tier={result.tier} label={result.tierLabel} />
          <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
            <span>Floor <b className="text-[var(--color-text)]">{result.floor}</b></span>
            <span className="text-[var(--color-text-faint)]">/</span>
            <span>Ceiling <b className="text-[var(--color-text)]">{result.ceiling}</b></span>
            <span className={`font-semibold ${RISK_COLORS[result.risk] ?? ''}`}>
              {result.risk} Risk
            </span>
          </div>
        </div>
      </div>

      {/* Top factors */}
      {result.topFactors.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">
            Draft Factors
          </h4>
          <div className="space-y-1.5">
            {result.topFactors.map((f) => (
              <FactorBar key={f.key} factor={f} />
            ))}
          </div>
          <MissingFactors factors={result.missingFactors} />
        </section>
      )}

      {/* Format impact */}
      {result.formatImpact.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">
            Format Impact
          </h4>
          <ul className="space-y-1">
            {result.formatImpact.map((item, i) => (
              <FormatImpactRow key={i} item={item} />
            ))}
          </ul>
        </section>
      )}

      {result.formatImpact.length === 0 && (
        <p className="text-[10px] text-[var(--color-text-faint)] italic">
          No notable format-specific impacts for this position.
        </p>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function EvalPanel({ player }) {
  const [mode, setMode] = useState('weekly')
  const activeProfile = useScoringProfileStore((s) => s.activeProfile)
  const posColor = getPositionColor(player.position)

  // Pull most recent nflverse season stats to feed real metrics into the engine
  const { history, seasons } = usePlayerStats(player)
  const mostRecentSeason = seasons[0] ?? null
  const realMetrics = useMemo(() => {
    if (!history || !mostRecentSeason) return null
    return toEvalMetrics(history[String(mostRecentSeason)])
  }, [history, mostRecentSeason])

  const weeklyResult = useMemo(
    () => evaluateWeekly(player, activeProfile, realMetrics),
    [player, activeProfile, realMetrics]
  )
  const draftResult = useMemo(
    () => evaluateDraft(player, activeProfile, realMetrics),
    [player, activeProfile, realMetrics]
  )

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded overflow-hidden border border-[var(--color-border)]">
        {[
          { key: 'weekly', icon: TrendingUp, label: 'Weekly Eval' },
          { key: 'draft',  icon: BarChart2,  label: 'Draft Value' },
        ].map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold transition-colors ${
              mode === key
                ? 'bg-[var(--color-accent)] text-black'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-surface-2)]'
            }`}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Data source notice */}
      <div className="flex items-start gap-1.5 px-2.5 py-2 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]">
        <Zap size={11} className="text-[var(--color-accent)] flex-shrink-0 mt-px" />
        {realMetrics ? (
          <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
            Using nflverse {mostRecentSeason} season data for available metrics. Untracked inputs (YPRR, separation, OL grade) use position defaults.
          </p>
        ) : (
          <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
            Using synthetic position defaults. Run{' '}
            <code className="text-[var(--color-accent)]">npm run preprocess-nflverse</code>{' '}
            to load real historical metrics.
          </p>
        )}
      </div>

      {/* Panel content */}
      {mode === 'weekly'
        ? <WeeklyPanel result={weeklyResult} posColor={posColor} />
        : <DraftPanel result={draftResult} posColor={posColor} />
      }
    </div>
  )
}
