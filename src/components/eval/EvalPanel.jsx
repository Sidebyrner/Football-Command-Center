import { useState, useMemo } from 'react'
import { AlertTriangle, Info, Zap, ChevronDown, ChevronUp, Loader2, SlashIcon } from 'lucide-react'
// evaluateWeekly stays exported from the engine for the in-season build; the
// Weekly Eval tab is removed here because it has no matchup/weather/game-script
// input and produced near-identical scores to Draft Value while still labelling
// itself a start/sit call it cannot actually make.
import { evaluateDraft } from '../../utils/evaluationEngine'
import useScoringProfileStore from '../../store/useScoringProfileStore'
import { positionColor } from '@ui/components/Player'
import '../../screens/tools/researchTools.css'
import { usePlayerStats } from '../../hooks/usePlayerStats'
import { useCohorts } from '../../hooks/useCohorts'
import { toEvalMetrics } from '../../services/nflverseService'

// Below this share of real inputs the composite is too thin to headline.
const MIN_HEADLINE_COVERAGE = 0.5

// Tier and risk colours from the design tokens; the tier label and the risk
// word always print too, so the colour is never the only signal.
const TIER_TOKEN = {
  1: 'var(--start)',
  2: 'var(--hue-team)',
  3: 'var(--caution)',
  4: 'var(--text-2)',
  5: 'var(--sit)',
}

const RISK_TOKEN = {
  'Low':      'var(--start)',
  'Moderate': 'var(--caution)',
  'High':     'var(--sit)',
  'Very High':'var(--sit)',
}

function TierBadge({ tier, label }) {
  const color = TIER_TOKEN[tier] ?? TIER_TOKEN[5]
  return (
    <span
      className="t-meta"
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 999, fontWeight: 600,
        color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
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
    <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }} role="img" aria-label={`Score ${score} of 100`}>
      <svg width="80" height="80" className="-rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="var(--inset)" strokeWidth="6" />
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
      <span className="absolute t-title" style={{ color }} aria-hidden>
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
      <span className="t-title muted">{score}</span>
      <span className="t-micro faint">low data</span>
    </div>
  )
}

// ── Factor bar ────────────────────────────────────────────────────────────────
function FactorBar({ factor }) {
  const pct = Math.round((factor.value ?? 0) * 100)
  const label = METRIC_LABELS[factor.key] ?? factor.key

  return (
    <div className="flex items-center gap-2">
      <span className="t-meta muted w-28 flex-shrink-0 truncate">{label}</span>
      <div className="rt-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="t-meta faint w-7 text-right">{pct}</span>
    </div>
  )
}

// ── Format impact row ─────────────────────────────────────────────────────────
function FormatImpactRow({ item }) {
  const isBoost = item.type === 'boost'
  return (
    <li className="flex items-start gap-1.5 t-meta" style={{ color: isBoost ? 'var(--start)' : 'var(--sit)' }}>
      <span className="flex-shrink-0 font-bold mt-px" aria-label={isBoost ? 'Boost' : 'Drag'}>{isBoost ? '▲' : '▼'}</span>
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
  const tone = coverage >= 0.8 ? 'var(--start)'
    : coverage >= MIN_HEADLINE_COVERAGE ? 'var(--caution)'
    : 'var(--sit)'

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={factors.length > 0 ? open : undefined}
        className="flex items-center gap-1 t-meta faint"
        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
      >
        <Info size={12} aria-hidden />
        <span style={{ color: tone }}>{pct}% of model weight from real data</span>
        {factors.length > 0 && (open ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />)}
      </button>
      {open && factors.length > 0 && (
        <p className="t-meta faint" style={{ margin: '4px 0 0' }}>
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
      <SlashIcon size={20} color="var(--text-3)" aria-hidden />
      <p className="t-body muted" style={{ margin: 0, fontWeight: 600 }}>No score available</p>
      <p className="t-meta faint max-w-[15rem]" style={{ margin: 0 }}>{reason}</p>
    </div>
  )
}

// ── Weekly panel ─────────────────────────────────────────────────────────────
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
          <div className="flex items-center gap-3 flex-wrap t-meta muted">
            <span>Floor <b style={{ color: 'var(--text)' }}>{result.floor}</b></span>
            <span className="faint">/</span>
            <span>Ceiling <b style={{ color: 'var(--text)' }}>{result.ceiling}</b></span>
            <span style={{ fontWeight: 600, color: RISK_TOKEN[result.risk] }}>
              {result.risk} Risk
            </span>
          </div>
        </div>
      </div>

      {/* Top factors */}
      {result.topFactors.length > 0 && (
        <section>
          <h4 className="t-micro muted" style={{ margin: '0 0 var(--space-s)' }}>
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
          <h4 className="t-micro muted" style={{ margin: '0 0 var(--space-s)' }}>
            Risk Factors
          </h4>
          <ul className="space-y-1">
            {result.riskFlags.map((f, i) => (
              <li key={i} className="flex items-start gap-1.5 t-meta muted">
                <AlertTriangle size={12} color="var(--caution)" className="flex-shrink-0" style={{ marginTop: 1 }} aria-hidden />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Format impact */}
      {result.formatImpact.length > 0 && (
        <section>
          <h4 className="t-micro muted" style={{ margin: '0 0 var(--space-s)' }}>
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
  const activeProfile = useScoringProfileStore((s) => s.activeProfile)
  const posColor = positionColor(player.position)

  const { history, seasons, loading: statsLoading } = usePlayerStats(player)
  const { cohorts, loading: cohortsLoading, error: cohortsError } = useCohorts()

  const mostRecentSeason = seasons[0] ?? null
  const realMetrics = useMemo(() => {
    if (!history || !mostRecentSeason) return null
    return toEvalMetrics(history[String(mostRecentSeason)])
  }, [history, mostRecentSeason])

  const draftResult = useMemo(
    () => evaluateDraft(player, activeProfile, realMetrics, cohorts),
    [player, activeProfile, realMetrics, cohorts]
  )

  const loading = statsLoading || cohortsLoading

  return (
    <div className="space-y-4">
      {/* Provenance — say exactly where the numbers came from */}
      <div className="inset flex items-start gap-1.5">
        <Zap size={12} color="var(--accent)" className="flex-shrink-0" style={{ marginTop: 2 }} aria-hidden />
        {cohortsError ? (
          <p className="t-meta faint" style={{ margin: 0 }}>
            Cohort data missing. Run{' '}
            <code>npm run preprocess-nflverse</code>{' '}
            to enable scoring.
          </p>
        ) : mostRecentSeason ? (
          <p className="t-meta faint" style={{ margin: 0 }}>
            Percentiles vs. real {mostRecentSeason} qualifying {player.position}s from nflverse.
            Unmeasured inputs are excluded from the weighting, never estimated. Draft value
            only — season-long production, not a specific week's matchup.
          </p>
        ) : (
          <p className="t-meta faint" style={{ margin: 0 }}>
            No nflverse season history for this player.
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 t-meta faint" role="status">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Loading model inputs…
        </div>
      ) : (
        <DraftPanel result={draftResult} posColor={posColor} />
      )}
    </div>
  )
}
