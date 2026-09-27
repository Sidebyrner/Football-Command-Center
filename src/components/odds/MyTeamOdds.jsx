import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getPositionColor } from '../../utils/playerHelpers'
import { toNflverseTeam } from '../../utils/nflTeams'
import { classifyGameScript, readForPosition, medianTotal as medianOf } from '../../utils/gameScript'

function formatKickoff(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function formatSpread(v) {
  if (v == null) return '—'
  return v > 0 ? `+${v}` : `${v}`
}

function Row({ r }) {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="py-1.5 pr-2 whitespace-nowrap">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ color: getPositionColor(r.position), backgroundColor: `${getPositionColor(r.position)}20` }}
        >
          {r.position ?? '?'}
        </span>
      </td>
      <td className="py-1.5 pr-2 min-w-0">
        <span className="text-[var(--color-text)]">{r.name}</span>
        {r.isStarter && (
          <span className="ml-1.5 text-[9px] font-semibold text-[var(--color-accent)]">STARTER</span>
        )}
      </td>
      <td className="py-1.5 pr-2 whitespace-nowrap text-[var(--color-text-muted)]">
        {r.game ? `${r.isHome ? 'vs' : '@'} ${r.opponent}` : <span className="text-[var(--color-text-faint)]">no game</span>}
      </td>
      <td className="py-1.5 pr-2 whitespace-nowrap text-[var(--color-text-faint)] hidden md:table-cell">
        {r.kickoff ?? '—'}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--color-text-muted)]">{formatSpread(r.spread)}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--color-text-muted)] hidden sm:table-cell">
        {r.total ?? '—'}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-[var(--color-text)]">
        {r.implied != null ? r.implied.toFixed(1) : '—'}
      </td>
      <td className="py-1.5 pr-2 whitespace-nowrap">
        {r.script ? (
          <span className="text-[10px] font-semibold text-[var(--color-text)]">{r.script.label}</span>
        ) : (
          <span className="text-[10px] text-[var(--color-text-faint)]">—</span>
        )}
      </td>
      <td className="py-1.5 text-[10px] text-[var(--color-text-muted)] leading-tight">
        {r.read ?? ''}
      </td>
    </tr>
  )
}

/**
 * The market, narrowed to the players you actually own.
 *
 * Everything here is one basis — what the lines imply about each player's
 * game — and it knows nothing whatsoever about the player. A replacement-level
 * body in a shootout outranks a stud in a slog on this page, which is exactly
 * why it names itself rather than offering a start/sit verdict. The lineup
 * optimizer on /matchup can run this same basis against the others.
 */
export default function MyTeamOdds({ myTeam, playersById, scheduleByTeam, impliedForTeam, source, week }) {
  const { rows, noGame } = useMemo(() => {
    if (!myTeam) return { rows: [], noGame: [] }

    const starters = new Set((myTeam.starterIds ?? []).filter((id) => id && id !== '0'))

    // Classify against this week's whole board, not just the games your
    // roster happens to touch — otherwise "high total" would mean something
    // different on your page than on the scatter above.
    const mid = medianOf(Object.values(scheduleByTeam ?? {}).map((g) => g?.totalLine))

    const all = (myTeam.playerIds ?? [])
      .filter((id) => id && id !== '0')
      .map((id) => {
        const p = playersById[id]
        if (!p) return null
        const game = scheduleByTeam?.[toNflverseTeam(p.team)] ?? null
        const implied = impliedForTeam ? impliedForTeam(p.team) : null
        const spread = game?.spreadLine ?? null
        const script = classifyGameScript(game?.totalLine, spread, mid)
        // spreadLine is in Odds-API sign here (negative = this team favored).
        const isFavored = spread != null ? spread < 0 : false
        return {
          id,
          name: p.name ?? id,
          position: p.position,
          isStarter: starters.has(id),
          game,
          opponent: game?.opponent ?? null,
          isHome: game?.isHome ?? false,
          kickoff: formatKickoff(game?.kickoff),
          spread,
          total: game?.totalLine ?? null,
          implied,
          script,
          read: script ? readForPosition(script.key, p.position, isFavored) : null,
        }
      })
      .filter(Boolean)

    return {
      rows: all.filter((r) => r.implied != null).sort((a, b) => b.implied - a.implied),
      noGame: all.filter((r) => r.implied == null),
    }
  }, [myTeam, playersById, scheduleByTeam, impliedForTeam])

  if (!myTeam) return null
  if (rows.length === 0 && noGame.length === 0) return null

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          Your roster, week {week}
        </h2>
        <Link
          to="/matchup"
          className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
        >
          Optimize a lineup on this basis →
        </Link>
      </div>

      <p className="text-[10px] text-[var(--color-text-faint)] mb-2 leading-relaxed">
        Sorted by implied team total — the market's view of the game each player is in, and nothing
        about the player himself. {source === 'schedule' && 'Recorded lines, not live ones. '}
        {noGame.length > 0 && `${noGame.length} of your ${rows.length + noGame.length} players have no line this week.`}
      </p>

      <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] border-b border-[var(--color-border)]">
              <th className="text-left font-medium py-1.5 pl-3 pr-2">Pos</th>
              <th className="text-left font-medium py-1.5 pr-2">Player</th>
              <th className="text-left font-medium py-1.5 pr-2">Game</th>
              <th className="text-left font-medium py-1.5 pr-2 hidden md:table-cell">Kick</th>
              <th className="text-right font-medium py-1.5 pr-2">Spread</th>
              <th className="text-right font-medium py-1.5 pr-2 hidden sm:table-cell">O/U</th>
              <th className="text-right font-medium py-1.5 pr-3">Implied</th>
              <th className="text-left font-medium py-1.5 pr-2">Script</th>
              <th className="text-left font-medium py-1.5">What it implies</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td:first-child]:pl-3">
            {rows.map((r) => <Row key={r.id} r={r} />)}
            {noGame.map((r) => <Row key={r.id} r={r} />)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
