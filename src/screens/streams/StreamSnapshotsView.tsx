/**
 * Frozen runs, newest first — the port of `StreamSnapshotsView` and
 * `StreamSnapshotDetailView`. One a day is saved automatically; frozen ones
 * are the Tuesday-night and Sunday-morning runs saved by hand.
 */
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, Snowflake, Trash2 } from 'lucide-react'
import { RISK_LABEL } from '@core/Stream'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import type { StreamSnapshot, StreamSnapshotSummary } from '@models/streams/StreamStore'
import { useModel } from '@ui/app/AppContext'
import { PositionChip } from '@ui/components/Player'
import { formatDateTime, formatFullDateTime, StreamFormat } from './format'
import { Sheet } from './parts'

export function StreamSnapshotsView<K extends StreamKindTypes>({ model: source, onClose }: { model: StreamScreenModel<K>; onClose: () => void }) {
  const model = useModel(source)
  const [open, setOpen] = useState<StreamSnapshotSummary>()

  if (open) {
    return (
      <Sheet
        title={`Week ${open.week}`}
        onClose={onClose}
        leading={[{ label: 'Snapshots', icon: ChevronLeft, onClick: () => setOpen(undefined) }]}
        trailing={[{ label: 'Done', primary: true, onClick: onClose }]}
      >
        <SnapshotDetail model={model} summary={open} />
      </Sheet>
    )
  }

  const groups = new Map<string, StreamSnapshotSummary[]>()
  for (const s of model.snapshots) {
    const key = `${s.season} · Week ${s.week}`
    const list = groups.get(key) ?? []
    list.push(s)
    groups.set(key, list)
  }
  const grouped = [...groups.entries()]
    .map(([key, rows]) => [key, [...rows].sort((a, b) => b.asOf - a.asOf)] as const)
    .sort((a, b) => (b[1][0]?.asOf ?? 0) - (a[1][0]?.asOf ?? 0))

  return (
    <Sheet title="Snapshots" onClose={onClose} trailing={[{ label: 'Done', primary: true, onClick: onClose }]}>
      {model.snapshots.length === 0 && (
        <p className="card t-body muted">No snapshots yet. One is saved the first time the screen loads each day.</p>
      )}
      {grouped.map(([key, rows]) => (
        <section key={key} className="stream-form-section">
          <h3 className="t-meta muted stream-form-header">{key}</h3>
          <div className="card stream-picker-list">
            {rows.map((summary) => (
              <div key={summary.id} className="stream-snapshot-row">
                <button type="button" className="stream-picker-row" onClick={() => setOpen(summary)}>
                  {summary.pinned ? <Snowflake size={16} color="var(--accent)" aria-hidden /> : <Clock size={16} color="var(--accent)" aria-hidden />}
                  <span className="stream-grow t-body">{formatDateTime(summary.asOf)}</span>
                  {summary.pinned && <span className="t-micro muted stream-plain">frozen</span>}
                  <ChevronRight size={16} className="faint" aria-hidden />
                </button>
                <button
                  type="button"
                  className="stream-remove"
                  aria-label={`Delete snapshot from ${formatDateTime(summary.asOf)}`}
                  title="Delete"
                  onClick={() => { void model.deleteSnapshot(summary.id) }}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}

/** A frozen run, read-only, exactly as it was on screen. */
function SnapshotDetail<K extends StreamKindTypes>({ model, summary }: { model: StreamScreenModel<K>; summary: StreamSnapshotSummary }) {
  const [snapshot, setSnapshot] = useState<StreamSnapshot<K>>()
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    model.loadSnapshot(summary.id).then(
      (s) => { if (!cancelled) { setSnapshot(s); setMissing(s === undefined) } },
      () => { if (!cancelled) setMissing(true) },
    )
    return () => { cancelled = true }
  }, [model, summary.id])

  if (!snapshot) {
    return missing
      ? <p className="t-body muted">This snapshot could not be read.</p>
      : <div className="stream-spinner" role="status" aria-label="Loading" />
  }
  const f1 = StreamFormat.one
  const inc = snapshot.report.incumbent
  return (
    <div className="stream-snapshot-detail">
      <p className="t-meta muted">As of {formatFullDateTime(snapshot.asOf)} · {RISK_LABEL[snapshot.risk]}</p>
      {inc && (
        <p className="card t-body stream-strong">Starter to beat: {inc.name} ({inc.team} {inc.opponent}) — {f1(inc.expPts)} pts</p>
      )}
      <ol className="stream-snapshot-list">
        {snapshot.report.ranked.filter((r) => r.available !== false).slice(0, 30).map((row, offset) => (
          <li key={row.id} className="stream-snapshot-item">
            <span className="t-meta muted stream-num stream-rank-num">{offset + 1}</span>
            <PositionChip position={row.platform} label={row.roleLabel} />
            <span className="stream-grow">
              <span className="t-body stream-strong">{row.name}</span>
              <span className="t-micro muted stream-plain">{row.team} {row.opponent}</span>
            </span>
            {row.pBeatIncumbent !== undefined && <span className="t-meta muted stream-num">{StreamFormat.pct(row.pBeatIncumbent)}</span>}
            <span className="t-body stream-num stream-strong">{f1(row.expPts)}</span>
          </li>
        ))}
      </ol>
      <p className="t-micro muted stream-plain">Free agents at the time. Actuals and backtest scoring against these snapshots come in a later build.</p>
    </div>
  )
}
