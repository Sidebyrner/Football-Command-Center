import { useState, useMemo } from 'react'
import { getPositionColor } from '../../utils/playerHelpers'
import { unsupportedFor } from '../../utils/weeklyScoring'
import { signalsFor } from '../../hooks/useAcquisitionBoard'

const STATUS_LABEL = {
  free: { label: 'Free agent', action: 'Claim', tone: 'text-[var(--color-start)]' },
  'rival-bench': { label: 'On a bench', action: 'Trade', tone: 'text-[var(--color-caution)]' },
  'rival-starter': { label: 'Rival starter', action: 'Trade', tone: 'text-[var(--color-text-muted)]' },
  mine: { label: 'Yours', action: '—', tone: 'text-[var(--color-accent)]' },
}

const SIGNAL_TONE = {
  startable: 'bg-[var(--color-start)]/15 text-[var(--color-start)]',
  'above-replacement': 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]',
  opportunity: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
  form: 'bg-[var(--color-caution)]/15 text-[var(--color-caution)]',
}

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K']

// Two different questions, never averaged into one. Raw points per game is
// deliberately NOT offered as a cross-position sort: a QB outscores every RB in
// absolute terms, so it just lists quarterbacks and buries the players this
// page exists to surface.
const SORTS = [
  {
    key: 'surplus',
    label: 'Value over the start line',
    hint: "Points per game above the last player your league actually starts at his position — comparable across positions",
    of: (p) => (p.vsLine ?? -Infinity),
  },
  {
    key: 'opportunity',
    label: 'Opportunity (target share)',
    hint: 'Recent target share, highest first — the buy-low view: usage that the points have not caught up to yet',
    of: (p) => (p.recentTgtShare ?? -Infinity),
  },
]
const STATUSES = [
  { key: 'available', label: 'Gettable', hint: 'Free agents and players sitting on a rival bench' },
  { key: 'free', label: 'Free agents only', hint: 'A waiver claim, no negotiation needed' },
  { key: 'all', label: 'Everyone', hint: 'Includes rival starters — the expensive trades' },
]

function Pct({ value }) {
  if (value == null) return <span className="text-[var(--color-text-faint)]">—</span>
  return <span className="tabular-nums">{Math.round(value * 100)}%</span>
}

function Num({ value, digits = 1 }) {
  if (value == null) return <span className="text-[var(--color-text-faint)]">—</span>
  return <span className="tabular-nums">{value.toFixed(digits)}</span>
}

/**
 * Who to go get, and why.
 *
 * Every row is ranked on ONE stated number — points per game in your scoring —
 * and then labelled with the separate signals that actually fired on him. There
 * is no composite score here on purpose: "startable production" and "target
 * share running ahead of the points" are different claims with different shelf
 * lives, and averaging them together would hide which one you are betting on.
 */
export default function AcquisitionBoard({
  players, baselines, trending, playersById, profileName,
  selectedWeek, byeTeams, onClearWeek, loading, error,
}) {
  const [position, setPosition] = useState('ALL')
  const [status, setStatus] = useState('available')
  const [sortKey, setSortKey] = useState('surplus')

  const rows = useMemo(() => {
    const sort = SORTS.find((s) => s.key === sortKey) ?? SORTS[0]
    const out = []
    for (const p of players) {
      if (p.status === 'mine') continue
      if (position !== 'ALL' && p.position !== position) continue
      if (status === 'free' && p.status !== 'free') continue
      if (status === 'available' && p.status === 'rival-starter') continue
      if (p.games < 2) continue
      // The link between the two halves of this page: in a week you can't
      // fill, a player who is himself on bye is worth nothing to you.
      if (selectedWeek && byeTeams?.has(p.nflverseTeam)) continue

      const signals = signalsFor(p, baselines)
      if (!signals.length) continue

      const line = baselines?.[p.position]?.startLine
      const vsLine = line != null && p.perGame != null
        ? Math.round((p.perGame - line) * 10) / 10
        : null
      out.push({ ...p, signals, vsLine })
    }
    return out.sort((a, b) => sort.of(b) - sort.of(a)).slice(0, 60)
  }, [players, baselines, position, status, selectedWeek, byeTeams, sortKey])

  // Trending is the only signal that reaches DEF and IDP, because the weekly
  // production file contains neither. Kept in its own panel rather than
  // interleaved, so a trending DEF never looks like it was ranked against
  // players whose points we can actually measure.
  const trendingRows = useMemo(() => {
    const scanned = new Set(players.map((p) => p.id).filter(Boolean))
    return (trending ?? [])
      .map((t) => {
        const meta = playersById?.[t.player_id]
        return {
          id: t.player_id,
          count: t.count ?? 0,
          name: meta?.name ?? t.player_id,
          position: meta?.position ?? null,
          team: meta?.team ?? null,
          noProductionData: !scanned.has(t.player_id),
        }
      })
      .filter((t) => position === 'ALL' || t.position === position)
      .slice(0, 12)
  }, [trending, playersById, players, position])

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Scanning every player's season…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load production data: {error}</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                position === pos
                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-faint)] hover:text-[var(--color-text)]'
              }`}
              style={position === pos && pos !== 'ALL' ? { color: getPositionColor(pos) } : undefined}
            >
              {pos}
            </button>
          ))}
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text)]"
          title={STATUSES.find((s) => s.key === status)?.hint}
        >
          {STATUSES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-faint)]">
          Rank by
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-[11px] text-[var(--color-text)]"
            title={SORTS.find((s) => s.key === sortKey)?.hint}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </label>

        {selectedWeek && (
          <button
            onClick={onClearWeek}
            className="px-2 py-1 rounded text-[11px] font-semibold bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:brightness-125"
            title={`Showing only players who are not themselves on bye in week ${selectedWeek}`}
          >
            Helps week {selectedWeek} ✕
          </button>
        )}
      </div>

      <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] border-b border-[var(--color-border)]">
              <th className="text-left font-medium py-1.5 pl-3">Player</th>
              <th className="text-left font-medium py-1.5 px-2">Status</th>
              <th className="text-right font-medium py-1.5 px-2" title="Points per game above the last player your league actually starts at this position">
                vs line
              </th>
              <th className="text-right font-medium py-1.5 px-2">Pts/gm</th>
              <th className="text-right font-medium py-1.5 px-2">Last 4</th>
              <th className="text-right font-medium py-1.5 px-2">Floor–ceil</th>
              <th className="text-right font-medium py-1.5 px-2">Tgt share</th>
              <th className="text-left font-medium py-1.5 px-2">Why he's here</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const st = STATUS_LABEL[p.status] ?? STATUS_LABEL.free
              return (
                <tr key={p.gsisId} className="border-b border-[var(--color-border)] last:border-0 align-top">
                  <td className="py-1.5 pl-3 pr-2 whitespace-nowrap">
                    <span
                      className="text-[9px] font-bold px-1 py-0.5 rounded mr-1.5"
                      style={{ color: getPositionColor(p.position), backgroundColor: `${getPositionColor(p.position)}20` }}
                    >
                      {p.position}
                    </span>
                    <span className="font-semibold text-[var(--color-text)]">{p.name}</span>
                    <span className="text-[var(--color-text-faint)] ml-1">{p.team}</span>
                  </td>
                  <td className={`py-1.5 px-2 whitespace-nowrap ${st.tone}`}>
                    {st.label}
                    {p.owner && <span className="text-[var(--color-text-faint)]"> · {p.owner}</span>}
                    <span className="text-[var(--color-text-faint)]"> · {st.action}</span>
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold whitespace-nowrap">
                    {p.vsLine == null ? (
                      <span className="text-[var(--color-text-faint)]">—</span>
                    ) : (
                      <span
                        className="tabular-nums"
                        style={{ color: p.vsLine >= 0 ? 'var(--color-start)' : 'var(--color-text-muted)' }}
                      >
                        {p.vsLine >= 0 ? '+' : ''}{p.vsLine.toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--color-text)]"><Num value={p.perGame} /></td>
                  <td className="py-1.5 px-2 text-right text-[var(--color-text-muted)]"><Num value={p.formPerGame} /></td>
                  <td className="py-1.5 px-2 text-right text-[var(--color-text-muted)] whitespace-nowrap">
                    <Num value={p.floor} />–<Num value={p.ceiling} />
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--color-text-muted)]"><Pct value={p.recentTgtShare} /></td>
                  <td className="py-1.5 px-2">
                    <div className="flex flex-wrap gap-1">
                      {p.signals.map((s) => (
                        <span
                          key={s.key}
                          title={s.detail}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SIGNAL_TONE[s.key] ?? ''}`}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-[var(--color-text-muted)]">
                  Nothing clears a signal under these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--color-text-faint)] leading-relaxed">
        Scored in {profileName ?? 'your scoring profile'}, ranked on the one number you picked above —
        never a composite. The tags say which separate signal flagged each player; hover one for the
        arithmetic. The start line at each position is the season pace of the last player your league
        actually starts there — {baselines?.RB?.starters ?? '—'} RBs across every roster — so "startable"
        means startable in this league, not in a generic redraft, and "vs line" is comparable between a
        quarterback and a running back in a way raw points are not.
      </p>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
          Trending adds league-wide
        </h3>
        <div className="flex flex-wrap gap-2">
          {trendingRows.map((t) => (
            <div key={t.id} className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-2 py-1.5 text-xs">
              <span className="font-semibold text-[var(--color-text)]">{t.name}</span>
              {t.position && (
                <span className="ml-1" style={{ color: getPositionColor(t.position) }}>{t.position}</span>
              )}
              <span className="text-[var(--color-text-faint)] ml-1.5 tabular-nums">+{t.count.toLocaleString()}</span>
              {t.noProductionData && (
                <span
                  className="ml-1.5 text-[9px] text-[var(--color-caution)]"
                  title={unsupportedFor(t.position).length
                    ? 'The weekly production file has no rows for this position — popularity is the only signal available'
                    : 'No scored weeks for this player in the production file'}
                >
                  popularity only
                </span>
              )}
            </div>
          ))}
          {!trendingRows.length && (
            <p className="text-xs text-[var(--color-text-muted)]">No trending adds returned.</p>
          )}
        </div>
        <p className="text-[10px] text-[var(--color-text-faint)] mt-2">
          Sleeper's league-wide add counts. This is the crowd's opinion, not production — and it's the
          only signal on this page that reaches DEF and IDP, which the weekly stats file doesn't cover
          at all.
        </p>
      </section>
    </div>
  )
}
