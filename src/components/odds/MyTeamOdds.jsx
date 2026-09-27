import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Users } from 'lucide-react'
import { ScreenSection } from '@ui/components/Screen'
import { PositionChip } from '@ui/components/Player'
import '../../screens/tools/researchTools.css'
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
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>
        <PositionChip position={r.position} label={r.position ?? '?'} />
      </td>
      <td style={{ minWidth: 120 }}>
        <span style={{ fontWeight: 600 }}>{r.name}</span>
        {r.isStarter && <span className="t-micro" style={{ marginLeft: 6, color: 'var(--accent)' }}>Starter</span>}
      </td>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
        {r.game ? `${r.isHome ? 'vs' : '@'} ${r.opponent}` : <span className="faint">no game</span>}
      </td>
      <td className="faint hidden md:table-cell" style={{ whiteSpace: 'nowrap' }}>
        {r.kickoff ?? '—'}
      </td>
      <td className="num muted">{formatSpread(r.spread)}</td>
      <td className="num muted hidden sm:table-cell">{r.total ?? '—'}</td>
      <td className="num" style={{ fontWeight: 700 }}>
        {r.implied != null ? r.implied.toFixed(1) : '—'}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {r.script ? (
          <span className="t-meta" style={{ fontWeight: 600 }}>{r.script.label}</span>
        ) : (
          <span className="t-meta faint">—</span>
        )}
      </td>
      <td className="t-meta muted" style={{ minWidth: 180 }}>
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
 * optimizer on Lineup › Matchup can run this same basis against the others.
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
    <ScreenSection title={`Your roster, week ${week}`} icon={Users} hue="var(--hue-market)">
      <div className="rt-row" style={{ justifyContent: 'space-between' }}>
        <p className="t-meta muted" style={{ margin: 0, flex: '1 1 260px' }}>
          Sorted by implied team total — the market's view of the game each player is in, and nothing
          about the player himself. {source === 'schedule' && 'Recorded lines, not live ones. '}
          {noGame.length > 0 && `${noGame.length} of your ${rows.length + noGame.length} players have no line this week.`}
        </p>
        <Link to="/lineup/matchup" className="rt-link t-meta">
          Optimize a lineup on this basis →
        </Link>
      </div>

      <div className="card rt-scroll" style={{ padding: 0 }}>
        <table className="rt-table">
          <caption className="sr-only">Your players' games this week, by implied team total</caption>
          <thead>
            <tr>
              <th scope="col">Pos</th>
              <th scope="col">Player</th>
              <th scope="col">Game</th>
              <th scope="col" className="hidden md:table-cell">Kick</th>
              <th scope="col" className="num">Spread</th>
              <th scope="col" className="num hidden sm:table-cell">O/U</th>
              <th scope="col" className="num">Implied</th>
              <th scope="col">Script</th>
              <th scope="col">What it implies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.id} r={r} />)}
            {noGame.map((r) => <Row key={r.id} r={r} />)}
          </tbody>
        </table>
      </div>
    </ScreenSection>
  )
}
