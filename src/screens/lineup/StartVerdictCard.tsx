/**
 * The this-week start call — a port of `StartVerdictCard` (Views/Decide/
 * StartVerdictCard.swift): who starts over whom, how sure, why, and what to
 * do if a Questionable pick sits. `ConfidenceChip` is its chip.
 */
import { BadgeCheck, ClockAlert, Inbox } from 'lucide-react'
import { GUT_CONFIDENCE_LABEL, type CompareGutCheck, type GutConfidence } from '@models/player/CompareGutCheck'
import { START_SIGNAL_LABEL, type StartVerdict } from '@models/player/StartVerdict'
import { CONFIDENCE_TINT, GutCheckView } from '../workspaces/panels/compareVerdictCard'
import { InjuryBadge } from './shared'
import './lineup.css'

export function StartVerdictCard({ verdict, gutCheck, compact = false, openWaivers }: {
  verdict: StartVerdict
  gutCheck?: CompareGutCheck
  compact?: boolean
  /** Shown when a free agent wins — the claim happens on the Waiver Board. */
  openWaivers?: () => void
}) {
  return (
    <section className="compare-block compare-verdict" aria-label="Start call" data-testid="decide.verdict">
      <div className="compare-verdict-headline">
        <BadgeCheck size={16} color="var(--accent)" aria-hidden />
        <span style={{ flex: 1 }}>{verdict.headline}</span>
        {!gutCheck && <ConfidenceChip confidence={verdict.confidence} />}
      </div>
      {verdict.edgeLine && <span className="t-meta muted">{verdict.edgeLine}</span>}
      {verdict.ranked.length > 0 && !compact && (
        <ol className="compare-verdict-ranked">
          {verdict.ranked.slice(0, 4).map((r) => (
            <li key={r.id}>
              <span className="compare-verdict-name">{r.name}</span>
              {r.isIncumbent ? <span className="compare-yours">STARTING</span>
                : r.isFreeAgent ? <span className="compare-yours" style={{ color: 'var(--start)' }}>FA</span> : null}
              {r.badge && <InjuryBadge label={r.badge} />}
              {r.topOn.length > 0 && <span className="muted">{`best on ${r.topOn.map((s) => START_SIGNAL_LABEL[s]).join(', ')}`}</span>}
            </li>
          ))}
        </ol>
      )}
      {verdict.blocked.length > 0 && (
        <span className="t-meta muted">{`Can't start: ${verdict.blocked.map((b) => `${b.name} (${b.reason})`).join(', ')}`}</span>
      )}
      {verdict.contingency && (
        <div className="compare-verdict-line t-meta">
          <ClockAlert size={14} color="var(--caution)" aria-hidden />
          <span>{verdict.contingency}</span>
        </div>
      )}
      {!compact && (
        <>
          <span className="t-meta muted">{verdict.postureLine}</span>
          {verdict.notes.map((note) => <span key={note} className="t-meta tertiary">{note}</span>)}
        </>
      )}
      {openWaivers && (
        <div>
          <button type="button" className="button mk-small" onClick={openWaivers} data-testid="decide.openWaivers">
            <Inbox size={14} aria-hidden /> Open Waivers
          </button>
        </div>
      )}
      {gutCheck && <GutCheckView check={gutCheck} />}
    </section>
  )
}

export function ConfidenceChip({ confidence }: { confidence: GutConfidence }) {
  const tint = CONFIDENCE_TINT[confidence]
  return (
    <span className="compare-gut-chip" style={{ color: tint, background: `color-mix(in srgb, ${tint} 14%, transparent)`, whiteSpace: 'nowrap' }}>
      {GUT_CONFIDENCE_LABEL[confidence]}
    </span>
  )
}
