/**
 * The call on a comparison — a port of `VerdictCard` (Views/Watchlist/
 * WatchlistComponents.swift): keep or go after, whether the move is worth it,
 * a bid only where the league bids, and the gut check that argues back.
 */
import { useState } from 'react'
import { ArrowUpCircle, BadgeCheck, ChevronDown, ChevronUp, CircleDollarSign, Hand, MinusCircle, PauseCircle, Repeat } from 'lucide-react'
import type { LeagueContext } from '@models/league/LeagueContext'
import { buildGutCheck, GUT_CONFIDENCE_LABEL, type CompareGutCheck, type GutConfidence, type GutPoint } from '@models/player/CompareGutCheck'
import { computeVerdict, verdictInputs, verdictLeague, type CompareVerdict, type VerdictPriority } from '@models/player/CompareVerdict'
import type { PlayerComparison } from '@models/player/PlayerComparison'

const PRIORITY_ICON: Record<VerdictPriority['kind'], typeof ArrowUpCircle> = {
  spend: ArrowUpCircle, hold: PauseCircle, keep: Hand, notAClaim: Repeat, nothing: MinusCircle,
}
const PRIORITY_TINT: Record<VerdictPriority['kind'], string> = {
  spend: 'var(--start)', hold: 'var(--caution)', keep: 'var(--accent)', notAClaim: 'var(--text-2)', nothing: 'var(--text-2)',
}
const CONFIDENCE_TINT: Record<GutConfidence, string> = { clear: 'var(--start)', lean: 'var(--caution)', coinFlip: '#ea580c' }

export function CompareVerdictCard({ comparison, context }: { comparison: PlayerComparison; context: LeagueContext }) {
  const verdict = computeVerdict(verdictInputs(comparison), verdictLeague(context.leagueFacts, context.currentWeek))
  return <VerdictView verdict={verdict} gutCheck={buildGutCheck(comparison, verdict)} />
}

export function VerdictView({ verdict, gutCheck }: { verdict: CompareVerdict; gutCheck?: CompareGutCheck }) {
  const Icon = PRIORITY_ICON[verdict.priority.kind]
  // Only worth saying when it tells players apart.
  const flagThin = !verdict.ranked.every((r) => r.thinData)
  return (
    <section className="compare-block compare-verdict" aria-label="Verdict" data-testid="compare-verdict">
      <div className="compare-verdict-headline">
        <BadgeCheck size={16} color="var(--accent)" aria-hidden />
        <span>{verdict.headline}</span>
      </div>
      <div className="compare-verdict-line t-meta">
        <Icon size={14} color={PRIORITY_TINT[verdict.priority.kind]} aria-hidden />
        <span>{verdict.priority.text}</span>
      </div>
      {verdict.faab && (
        <div className="compare-verdict-line t-meta">
          <CircleDollarSign size={14} color="var(--caution)" aria-hidden />
          <span>{`Bid $${verdict.faab.low}–$${verdict.faab.high}. ${verdict.faab.note}`}</span>
        </div>
      )}
      {verdict.ranked.length > 0 && (
        <ol className="compare-verdict-ranked">
          {verdict.ranked.slice(0, 4).map((r) => (
            <li key={r.id}>
              <span className="compare-verdict-name">{r.name}</span>
              {r.availability.kind === 'mine' && <span className="compare-yours">YOURS</span>}
              <span className="muted">{r.reasons.join(' · ')}</span>
              {flagThin && r.thinData && <span className="faint">thin data</span>}
            </li>
          ))}
        </ol>
      )}
      {gutCheck && <GutCheckView check={gutCheck} />}
    </section>
  )
}

function GutCheckView({ check }: { check: CompareGutCheck }) {
  const [open, setOpen] = useState(true)
  const tint = CONFIDENCE_TINT[check.confidence]
  return (
    <div className="compare-gut">
      <button type="button" className="compare-gut-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="compare-gut-title">Gut check</span>
        <span className="compare-gut-chip" style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)` }}>
          {GUT_CONFIDENCE_LABEL[check.confidence]}
        </span>
        <span className="spacer" />
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <>
          <p className="t-meta compare-gut-summary">{check.summary}</p>
          {check.caseForAlternative.length > 0 && <Points title={`Case for ${check.alternativeName}`} points={check.caseForAlternative} />}
          {check.risksForPick.length > 0 && <Points title={`Risks for ${check.pickName}`} points={check.risksForPick} />}
        </>
      )}
    </div>
  )
}

function Points({ title, points }: { title: string; points: readonly GutPoint[] }) {
  return (
    <div className="compare-gut-points">
      <span className="compare-block-title">{title}</span>
      <ul>
        {points.map((p) => <li key={p.text} className={p.strength === 0 ? 'muted' : undefined}>{p.text}</li>)}
      </ul>
    </div>
  )
}
