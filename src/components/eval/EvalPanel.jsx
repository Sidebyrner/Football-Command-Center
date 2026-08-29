import { useState, useMemo } from 'react'
import { TrendingUp, BarChart2, AlertTriangle, Info, Zap, ChevronDown, ChevronUp, Loader2, SlashIcon } from 'lucide-react'
import { evaluateWeekly, evaluateDraft } from '../../utils/evaluationEngine'
import useScoringProfileStore from '../../store/useScoringProfileStore'
import { getPositionColor } from '../../utils/playerHelpers'
import { usePlayerStats } from '../../hooks/usePlayerStats'
import { useCohorts } from '../../hooks/useCohorts'
import { toEvalMetrics } from '../../services/nflverseService'

// Below this share of real inputs the composite is too thin to headline.
const MIN_HEADLINE_COVERAGE = 0.5

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

// Display names for every metric the engine can score.
const METRIC_LABELS = {
  targetShare: 'Target Share',
  targetsPerGame: 'Targets / Game',
  airYardsShare: 'Air Yards Share',
  wopr: 'WOPR',
  racr: 'RACR',
  adot: 'ADOT',
  trueCatchRate: 'Catch Rate',
  yardsPerTarget: 'Yds / Target',
  receivingFirstDowns: 'Rec 1st Downs / G',
  qbRating: 'Passer Rating',
  completionPct: 'Completion %',
  yardsPerAttempt: 'Yds / Attempt',
  adotQb: 'ADOT (pass)',
  intRate: 'Ball Security',
  sackRate: 'Sack Avoidance',
  rushingAttempts: 'Carries / Game',
  seasonRushYards: 'Season Rush Yards',
  yardsPerCarry: 'Yds / Carry',
  touchesPerGame: 'Touches / Game',
  rushingFirstDowns: 'Rush 1st Downs / G',
  fantasyPointsPerGame: 'Fantasy Pts / G',
  fgPct: 'FG %',
}

// Shown in place of the ring when too little of the model is real data.
// The ring reads as a confident measurement; a thin score has not earned it.
function ThinScore({ score }) {
  return (
    <div className="flex flex-col items-center justify-center" style={{ width: 80, height: 80 }}>
      <span className="text-lg font-bold tabular-nums text-[var(--color-text-muted)]">{score}</span>
      <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">low data</span>
    </div>
  )
}

// ── Factor bar ────────────────────────────────────────────────────────────────
function FactorBar({ factor }) {
  const pct = Math.round((factor.value ?? 0) * 100)
  const label = METRIC_LABELS[factor.key] ?? factor.key

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

// ── Coverage disclosure ───────────────────────────────────────────────────────
// States plainly how much of the score is backed by real data, and which inputs
// were excluded. Excluded inputs are dropped from the weighting, not estimated.
function Coverage({ coverage, factors }) {
  const [open, setOpen] = useState(false)
  const pct = Math.round(coverage * 100)
  const tone = coverage >= 0.8 ? 'text-emerald-400'
    : coverage >= MIN_HEADLINE_COVERAGE ? 'text-amber-400'
    : 'text-rose-400'

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition-colors"
      >
        <Info size={10} />
        <span className={tone}>{pct}% of model weight from real data</span>
        {factors.length > 0 && (open ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      </button>
      {open && factors.length > 0 && (
        <p className="text-[10px] text-[var(--color-text-faint)] mt-1 leading-relaxed">
          Excluded (no data, not estimated): {factors.map((f) => METRIC_LABELS[f] ?? f).join(' · ')}
        </p>
      )}
    </div>
  )
}

// ── Unavailable state ─────────────────────────────────────────────────────────
// Shown instead of a score when the model has nothing real to work with.
// A blank panel beats a confident-looking number built on defaults.
function Unavailable({ reason }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-4">
      <SlashIcon size={20} className="text-[var(--color-text-faint)]" />
      <p className="text-xs font-semibold text-[var(--color-text-muted)]">No score available</p>
      <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed max-w-[15rem]">{reason}</p>
    </div>
  )
}

// ── Weekly panel ─────────────────────────────────────────────────────────────
function WeeklyPanel({ result, posColor }) {
  if (!result.available) return <Unavailable reason={result.reason} />
  const thin = result.coverage < MIN_HEADLINE_COVERAGE

  return (
    <div className="space-y-4">
      {/* Score header — the ring is withheld when too little of the model is real */}
      <div className="flex items-center gap-4">
        {thin
          ? <ThinScore score={result.score} />
          : <ScoreRing score={result.score} color={posColor} />}
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
          <Coverage coverage={result.coverage} factors={result.missingFactors} />
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
    </div>
  )
}

// ── Draft panel ───────────────────────────────────────────────────────────────
function DraftPanel({ result, posColor }) {
  if (!result.available) return <Unavailable reason={result.reason} />
  const thin = result.coverage < MIN_HEADLINE_COVERAGE

  return (
    <div className="space-y-4">
      {/* Score + tier */}
      <div className="flex items-center gap-4">
        {thin
          ? <ThinScore score={result.score} />
          : <ScoreRing score={result.score} color={posColor} />}
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
          <Coverage coverage={result.coverage} factors={result.missingFactors} />
        </section>
      )}

      {/* Risk detail — why the risk label reads the way it does */}
      {result.riskFlags?.length > 0 && (
        <section>
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">
            Risk Factors
          </h4>
          <ul className="space-y-1">
            {result.riskFlags.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                <AlertTriangle size={10} className="text-[var(--color-caution)] flex-shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
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
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function EvalPanel({ player }) {
  const [mode, setMode] = useState('weekly')
  const activeProfile = useScoringProfileStore((s) => s.activeProfile)
  const posColor = getPositionColor(player.position)

  const { history, seasons, loading: statsLoading } = usePlayerStats(player)
  const { cohorts, loading: cohortsLoading, error: cohortsError } = useCohorts()

  const mostRecentSeason = seasons[0] ?? null
  const realMetrics = useMemo(() => {
    if (!history || !mostRecentSeason) return null
    return toEvalMetrics(history[String(mostRecentSeason)])
  }, [history, mostRecentSeason])

  const weeklyResult = useMemo(
    () => evaluateWeekly(player, activeProfile, realMetrics, cohorts),
    [player, activeProfile, realMetrics, cohorts]
  )
  const draftResult = useMemo(
    () => evaluateDraft(player, activeProfile, realMetrics, cohorts),
    [player, activeProfile, realMetrics, cohorts]
  )

  const loading = statsLoading || cohortsLoading
  const result = mode === 'weekly' ? weeklyResult : draftResult

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

      {/* Provenance — say exactly where the numbers came from */}
      <div className="flex items-start gap-1.5 px-2.5 py-2 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]">
        <Zap size={11} className="text-[var(--color-accent)] flex-shrink-0 mt-px" />
        {cohortsError ? (
          <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
            Cohort data missing. Run{' '}
            <code className="text-[var(--color-accent)]">npm run preprocess-nflverse</code>{' '}
            to enable scoring.
          </p>
        ) : mostRecentSeason ? (
          <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
            Percentiles vs. real {mostRecentSeason} qualifying {player.position}s from nflverse.
            Unmeasured inputs are excluded from the weighting, never estimated.
            {mode === 'weekly' && (
              <>
                {' '}<span className="text-[var(--color-caution)]">
                  Based on season-long usage only — no opponent, weather or game-script
                  input yet, so this does not reflect a specific week's matchup.
                </span>
              </>
            )}
          </p>
        ) : (
          <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
            No nflverse season history for this player.
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--color-text-faint)]">
          <Loader2 size={13} className="animate-spin" />
          Loading model inputs…
        </div>
      ) : mode === 'weekly' ? (
        <WeeklyPanel result={result} posColor={posColor} />
      ) : (
        <DraftPanel result={result} posColor={posColor} />
      )}
    </div>
  )
}
