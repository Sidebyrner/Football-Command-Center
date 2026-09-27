/**
 * Two to four players side by side — the port of `StreamCompareView`: a
 * verdict first, then the range of outcomes, the stream's own sections,
 * recent form and every head-to-head. The best value on each row is tinted.
 *
 * Wide windows get a table whose player headers stay pinned while scrolling;
 * a phone gets one card per player instead (CSS picks which by width).
 */
import { useState, type CSSProperties } from 'react'
import { ArrowLeftRight, Flag, Plus, UserX, XCircle } from 'lucide-react'
import { PRACTICE_STATUS_LABEL, RISK_LABEL, type StreamComparison, type StreamVerdict } from '@core/Stream'
import { availabilityLabel } from '@models/league/LeagueContext'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip, positionColor } from '@ui/components/Player'
import { metric, StreamFormat, text } from './format'
import { Sheet, StreamPillGrid, Unavailable } from './parts'
import type { StreamCompareRow, StreamCompareSection, StreamCompareSpec, StreamGameCell } from './spec'
import { StreamPlayerPickerView } from './StreamPlayerPickerView'

export function StreamCompareView<K extends StreamKindTypes>({ model: source, spec, teamSpread, onClose }: {
  model: StreamScreenModel<K>
  spec: StreamCompareSpec<K>
  teamSpread: (t: K['Team']) => number
  onClose: () => void
}) {
  const model = useModel(source)
  const [adding, setAdding] = useState(false)
  const comparison = model.comparison
  const noun = model.kind.playerNoun
  return (
    <Sheet
      title={`Compare ${noun}s`}
      onClose={onClose}
      wide
      leading={[{ label: 'Clear', destructive: true, disabled: model.compareIDs.length === 0, onClick: () => model.clearCompare() }]}
      trailing={[
        { label: 'Add player', icon: Plus, disabled: !model.canAddToCompare, onClick: () => setAdding(true) },
        { label: 'Done', primary: true, onClick: onClose },
      ]}
    >
      {comparison ? (
        <div className="stream-compare">
          {comparison.verdict ? (
            <VerdictCard verdict={comparison.verdict} comparison={comparison} />
          ) : (
            <p className="card t-meta muted">Add another {noun} to get a verdict and head-to-head odds.</p>
          )}
          <RangeBars comparison={comparison} />
          <StackedCards model={model} spec={spec} comparison={comparison} />
          <CompareTable model={model} spec={spec} teamSpread={teamSpread} comparison={comparison} />
          {comparison.players.length > 1 && <HeadToHead comparison={comparison} />}
          <Flags comparison={comparison} />
          <p className="t-micro muted stream-plain">
            Same model and scoring as the stream list, at the {RISK_LABEL[model.risk].toLowerCase()} risk setting. Odds include each player's chance of not playing.
          </p>
        </div>
      ) : (
        <Unavailable icon={UserX} title="Nobody to compare" description={`Add ${noun}s from the list, or search for anyone.`} />
      )}
      {adding && <StreamPlayerPickerView model={model} mode="compare" onClose={() => setAdding(false)} />}
    </Sheet>
  )
}

type Comparison<K extends StreamKindTypes> = StreamComparison<K['Projection']>

// MARK: - Verdict

function VerdictCard<K extends StreamKindTypes>({ verdict, comparison }: { verdict: StreamVerdict; comparison: Comparison<K> }) {
  const leader = comparison.players[verdict.leader]!
  const runnerUp = StreamFormat.shortName(comparison.players[verdict.runnerUp]!.name)
  let headline: string, tint: string
  switch (verdict.confidence) {
    case 'clear': headline = `Start ${leader.name}`; tint = 'var(--start)'; break
    case 'lean': headline = `Lean ${leader.name}`; tint = 'var(--accent)'; break
    case 'tossUp': headline = `Toss-up — ${leader.name} by a nose`; tint = 'var(--caution)'; break
  }
  const odds = verdict.odds
    .map((o) => `beats ${StreamFormat.shortName(comparison.players[o.index]!.name)} ${StreamFormat.pct(o.pBeats)}`)
    .join(', ')
  const margin = verdict.margin >= 0
    ? `+${StreamFormat.one(verdict.margin)} pts over ${runnerUp}`
    : `${StreamFormat.one(-verdict.margin)} pts below ${runnerUp}'s projection, but the steadier bet`
  const flag = leader.flags[0]
  return (
    <div className="card stream-verdict" style={{ '--tint': tint } as CSSProperties}>
      <PlayerAvatar sleeperID={leader.playerID} name={leader.name} position={leader.platform} size={40} />
      <div className="stream-grow">
        <div className="t-section" style={{ color: tint }}>{headline}</div>
        <p className="t-body">{odds.slice(0, 1).toUpperCase()}{odds.slice(1)}. {margin}.</p>
        {flag !== undefined && <p className="t-meta stream-caution stream-label"><Flag size={13} aria-hidden /> {flag}</p>}
      </div>
    </div>
  )
}

// MARK: - Range bars

/** Floor to ceiling on one shared scale, the dot at expected points. */
function RangeBars<K extends StreamKindTypes>({ comparison }: { comparison: Comparison<K> }) {
  const top = Math.max(comparison.players.reduce((m, p) => Math.max(m, p.ceilingP75), 1), 1) * 1.08
  const x = (v: number) => Math.min(Math.max(v / top, 0), 1) * 100
  const one = StreamFormat.one
  return (
    <div className="card stream-range-card">
      <div className="stream-range-head">
        <span className="t-meta muted stream-strong">Range this week</span>
        <span className="t-micro faint stream-plain">floor · expected · ceiling</span>
      </div>
      {comparison.players.map((p) => (
        <div key={p.id} className="stream-range-row" role="img" aria-label={`${p.name}: floor ${one(p.floorP25)}, expected ${one(p.expPts)}, ceiling ${one(p.ceilingP75)}`}>
          <span className="t-meta stream-strong stream-ellipsis">{StreamFormat.shortName(p.name)}</span>
          <span className="range-track" style={{ '--tint': positionColor(p.platform) } as CSSProperties} aria-hidden>
            <span className="range-rail" />
            <span className="range-span" style={{ left: `${x(p.floorP25)}%`, width: `max(${x(p.ceilingP75) - x(p.floorP25)}%, 4px)` }} />
            <span className="range-dot small" style={{ left: `calc(${x(p.expPts)}% - 6px)` }} />
          </span>
          <span className="t-meta muted stream-num">{one(p.floorP25)} · {one(p.expPts)} · {one(p.ceilingP75)}</span>
        </div>
      ))}
    </div>
  )
}

// MARK: - Shared bits

function Ownership<K extends StreamKindTypes>({ model, p }: { model: StreamScreenModel<K>; p: K['Projection'] }) {
  if (p.playerID === undefined || !model.context) return null
  const a = model.context.availabilityOf(p.playerID)
  return <div className={`t-micro stream-plain ${a.kind === 'freeAgent' ? 'muted' : 'stream-caution'}`}>{availabilityLabel(a)}</div>
}

function RemoveButton<K extends StreamKindTypes>({ model, p }: { model: StreamScreenModel<K>; p: K['Projection'] }) {
  return (
    <button
      type="button"
      className="stream-remove"
      onClick={() => { if (p.playerID !== undefined) model.toggleCompare(p.playerID) }}
      aria-label={`Remove ${p.name} from comparison`}
      title="Remove from comparison"
    >
      <XCircle size={18} aria-hidden />
    </button>
  )
}

function Actions<K extends StreamKindTypes>({ model, p }: { model: StreamScreenModel<K>; p: K['Projection'] }) {
  const { openPlayerCard } = useApp()
  const context = model.context
  return (
    <div className="stream-compare-actions">
      {model.report?.incumbent?.id === p.id ? (
        <span className="t-micro stream-plain stream-strong" style={{ color: 'var(--accent)' }}>Starter to beat</span>
      ) : (
        <button type="button" className="stream-mini-button" title="Set as the starter to beat" onClick={() => { void model.setIncumbent(p.playerID) }}>Set to beat</button>
      )}
      {p.playerID !== undefined && context && (
        <button type="button" className="stream-mini-button" onClick={() => openPlayerCard(p.playerID!, context)}>Card</button>
      )}
    </div>
  )
}

// MARK: - Phone cards

function StackedCards<K extends StreamKindTypes>({ model, spec, comparison }: { model: StreamScreenModel<K>; spec: StreamCompareSpec<K>; comparison: Comparison<K> }) {
  const players = comparison.players
  const tint = (value: (p: K['Projection']) => number, p: K['Projection']) => {
    const values = players.map(value)
    return new Set(values).size > 1 && value(p) === Math.max(...values) ? 'var(--start)' : undefined
  }
  return (
    <div className="stream-compare-cards">
      {players.map((p) => {
        const games = p.playerID !== undefined ? spec.recentGames(model, p.playerID) : []
        return (
          <div key={p.id} className="card stream-compare-card">
            <div className="stream-starter-head">
              <PlayerAvatar sleeperID={p.playerID} name={p.name} position={p.platform} size={36} />
              <div className="stream-grow">
                <div className="stream-name-line">
                  <span className="t-section stream-ellipsis">{p.name}</span>
                  <PositionChip position={p.platform} label={p.roleLabel} />
                </div>
                <div className="t-meta muted">{p.team} {p.opponent} · {PRACTICE_STATUS_LABEL[p.practice]}</div>
                <Ownership model={model} p={p} />
              </div>
              <RemoveButton model={model} p={p} />
            </div>
            <StreamPillGrid pills={[
              { label: 'E[pts]', value: StreamFormat.one(p.expPts), tint: tint((x) => x.expPts, p) },
              { label: 'floor', value: StreamFormat.one(p.floorP25), tint: tint((x) => x.floorP25, p) },
              { label: 'ceiling', value: StreamFormat.one(p.ceilingP75), tint: tint((x) => x.ceilingP75, p) },
              ...spec.cardPills(p),
            ]} />
            <p className="t-meta muted">
              {spec.breakdown(model, p).slice(0, 4).map((b) => `${b.stat} ${StreamFormat.one(b.points)}`).join(' · ')}
            </p>
            {games.length > 0 && (
              <div className="stream-games">
                {games.map((g, i) => <div key={i} className="t-micro stream-plain">{g.title} — {g.detail}</div>)}
              </div>
            )}
            <Actions model={model} p={p} />
          </div>
        )
      })}
    </div>
  )
}

// MARK: - Wide table

function CompareTable<K extends StreamKindTypes>({ model, spec, teamSpread, comparison }: {
  model: StreamScreenModel<K>; spec: StreamCompareSpec<K>; teamSpread: (t: K['Team']) => number; comparison: Comparison<K>
}) {
  const players = comparison.players
  const projectionSection: StreamCompareSection = {
    title: 'Projection',
    rows: [
      metric('E[pts]', players.map((p) => p.expPts)),
      metric('Utility', players.map((p) => p.utility)),
      metric('P(plays)', players.map((p) => p.pPlay), StreamFormat.pct),
    ],
  }
  const gameSection: StreamCompareSection = {
    title: 'Game',
    rows: [
      text('Opponent', players.map((p) => p.opponent)),
      text('Spread', players.map((p) => { const t = model.teams[p.team]; return t ? StreamFormat.signed(teamSpread(t)) : '–' })),
      text('Total', players.map((p) => { const t = model.teams[p.team]; return t ? StreamFormat.one((t as unknown as { total: number }).total) : '–' })),
      metric('Role confidence', players.map((p) => p.roleConf), StreamFormat.two),
      text('Status', players.map((p) => PRACTICE_STATUS_LABEL[p.practice])),
      text('Season pts/g', players.map((p) => {
        const ppg = p.playerID !== undefined ? model.context?.sleeperPointsPerGame(p.playerID) : undefined
        return ppg !== undefined ? StreamFormat.one(ppg) : '–'
      })),
    ],
  }
  const sections = [projectionSection, ...spec.sections(model, players), gameSection]
  const games = players.map((p) => (p.playerID !== undefined ? spec.recentGames(model, p.playerID) : []))
  const style = { '--cols': players.length } as CSSProperties
  return (
    <div className="card stream-compare-table" style={style} role="table" aria-label="Comparison">
      <div className="stream-table-head" role="row">
        <span role="columnheader" aria-label="Stat" />
        {players.map((p) => (
          <div key={p.id} role="columnheader" className="stream-table-player">
            <div className="stream-table-player-top">
              <PlayerAvatar sleeperID={p.playerID} name={p.name} position={p.platform} size={30} />
              <RemoveButton model={model} p={p} />
            </div>
            <div className="t-body stream-strong stream-ellipsis">{p.name}</div>
            <div className="stream-name-line">
              <PositionChip position={p.platform} label={p.roleLabel} />
              <span className="t-micro muted stream-plain stream-ellipsis">{p.team} {p.opponent}</span>
            </div>
            <Ownership model={model} p={p} />
            <Actions model={model} p={p} />
          </div>
        ))}
      </div>
      {sections.map((section) => (
        <div key={section.title} role="rowgroup" className="stream-table-group">
          <div role="row" className="stream-table-title t-meta muted stream-strong"><span role="cell">{section.title}</span></div>
          {section.rows.map((row) => <TableRow key={row.label} row={row} />)}
        </div>
      ))}
      <div role="rowgroup" className="stream-table-group">
        <div role="row" className="stream-table-title t-meta muted stream-strong"><span role="cell">Recent games</span></div>
        <RecentRows games={games} />
      </div>
    </div>
  )
}

function TableRow({ row }: { row: StreamCompareRow }) {
  if (row.kind === 'text') {
    return (
      <div role="row" className="stream-table-row">
        <span role="rowheader" className="t-meta muted">{row.label}</span>
        {row.values.map((v, i) => <span key={i} role="cell" className="t-body stream-ellipsis">{v}</span>)}
      </div>
    )
  }
  const top = Math.max(...row.values)
  const distinct = new Set(row.values.map(row.format)).size > 1
  return (
    <div role="row" className="stream-table-row">
      <span role="rowheader" className="t-meta muted">{row.label}</span>
      {row.values.map((v, i) => {
        const best = distinct && v === top
        return (
          <span key={i} role="cell" className={`t-body stream-num${best ? ' stream-best' : ''}`}>
            {row.format(v)}{best && <span className="stream-vh"> (best)</span>}
          </span>
        )
      })}
    </div>
  )
}

function RecentRows({ games }: { games: StreamGameCell[][] }) {
  const rows = games.reduce((m, g) => Math.max(m, g.length), 0)
  if (rows === 0) return <p className="t-meta faint">No completed games this season yet.</p>
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} role="row" className="stream-table-row">
          <span role="rowheader" className="t-meta muted">{i === 0 ? 'Latest first' : ''}</span>
          {games.map((g, j) => {
            const cell = g[i]
            return cell ? (
              <span key={j} role="cell" className="stream-game-cell">
                <span className="t-body stream-num stream-strong">{cell.title}</span>
                <span className="t-micro muted stream-plain stream-ellipsis">{cell.detail}</span>
              </span>
            ) : (
              <span key={j} role="cell" className="faint">—</span>
            )
          })}
        </div>
      ))}
    </>
  )
}

// MARK: - Head to head

function HeadToHead<K extends StreamKindTypes>({ comparison }: { comparison: Comparison<K> }) {
  const players = comparison.players
  return (
    <div className="card stream-h2h">
      <div className="stream-h2h-head">
        <div className="section-title">
          <ArrowLeftRight size={17} strokeWidth={2.4} color="var(--hue)" aria-hidden />
          <h3 className="t-section">Head to head</h3>
        </div>
        <p className="t-meta muted">Chance the row player outscores the column player this week.</p>
      </div>
      <table className="stream-h2h-table">
        <thead>
          <tr>
            <td />
            {players.map((p) => <th key={p.id} scope="col" className="t-meta">{StreamFormat.shortName(p.name)}</th>)}
          </tr>
        </thead>
        <tbody>
          {players.map((row, i) => (
            <tr key={row.id}>
              <th scope="row" className="t-meta">{StreamFormat.shortName(row.name)}</th>
              {players.map((_, j) => {
                const p = comparison.headToHead[i]?.[j]
                if (p === undefined) return <td key={j} className="faint">—</td>
                const color = p >= 0.6 ? 'var(--start)' : p <= 0.4 ? 'var(--sit)' : undefined
                return <td key={j} className="stream-num" style={{ color, fontWeight: p >= 0.5 ? 600 : 400 }}>{StreamFormat.pct(p)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Flags<K extends StreamKindTypes>({ comparison }: { comparison: Comparison<K> }) {
  const flagged = comparison.players.filter((p) => p.flags.length > 0)
  if (flagged.length === 0) return null
  return (
    <details className="stream-flags t-meta">
      <summary>Data flags</summary>
      {flagged.map((p) => <p key={p.id} className="stream-caution">{p.name}: {p.flags.join(' · ')}</p>)}
    </details>
  )
}
