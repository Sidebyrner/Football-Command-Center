/**
 * The Board — a port of `Board/BoardView.swift`: the week at a glance as
 * tiles you pick and order — live score and games up top, the week's
 * decisions, then the season. Each tile opens the screen behind it.
 *
 * The layout is kept on the device under the same key the phone's
 * `@AppStorage` uses, `board.layout.v1`, in `BoardLayout`'s string form.
 */
import { useState } from 'react'
import { LayoutGrid, Pencil, RefreshCw } from 'lucide-react'
import { kickoffLabel } from '@models/league/GameDayWindow'
import { BoardLayout, boardTileWidth } from '@models/team/BoardTile'
import { LocalKeyValueStorage } from '@models/workspaces/KeyValueStorage'
import { useApp, useModel } from '@ui/app/AppContext'
import { ScreenHero } from '@ui/components/Screen'
import { hueForScreen } from '@ui/hues'
import { BoardEditSheet } from './BoardEditSheet'
import { BoardTileView } from './BoardTiles'
import { LiveBadge } from './LiveIndicators'
import '../team/team.css'
import './board.css'

export const BOARD_LAYOUT_KEY = 'board.layout.v1'
const storage = new LocalKeyValueStorage()

export function BoardScreen() {
  const { services } = useApp()
  const [stored, setStored] = useState<string | undefined>(() => storage.getItem(BOARD_LAYOUT_KEY))
  const [editing, setEditing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const layout = BoardLayout.decode(stored)

  const save = (next: BoardLayout) => {
    storage.setItem(BOARD_LAYOUT_KEY, next.encoded)
    setStored(next.encoded)
  }

  const refresh = async () => {
    setRefreshing(true)
    try { await services.loadIfConfigured(true) } finally { setRefreshing(false) }
  }

  return (
    <div className="bt-board-screen">
      <div className="bt-screen-toolbar">
        <button type="button" className="button bt-small" disabled={refreshing} onClick={() => void refresh()} aria-label="Refresh the Board">
          <RefreshCw size={14} aria-hidden className={refreshing ? 'bt-spin' : undefined} /> Refresh
        </button>
        <button type="button" className="button bt-small" onClick={() => setEditing(true)} data-testid="board.edit">
          <Pencil size={14} aria-hidden /> Edit
        </button>
      </div>

      <BoardHero />

      {layout.visible.length > 0 && (
        <div className="bt-board-grid">
          {BoardLayout.rows(layout.visible).map((row) => (
            <div key={row.join('|')} className="bt-board-row">
              {row.map((tile) => <BoardTileView key={tile} tile={tile} />)}
              {row.length === 1 && boardTileWidth(row[0]!) === 'half' && <span aria-hidden />}
            </div>
          ))}
        </div>
      )}

      {layout.visible.length === 0 && (
        <div className="card empty-state">
          <LayoutGrid size={28} color="var(--text-2)" aria-hidden />
          <div className="t-title">No tiles</div>
          <div className="t-body muted">Every tile is hidden.</div>
          <button type="button" className="button primary" onClick={() => setEditing(true)}>Choose tiles</button>
        </div>
      )}

      {editing && <BoardEditSheet layout={layout} onSave={save} onClose={() => setEditing(false)} />}
    </div>
  )
}

/** The Board's answer: which week, and whether games are on or when the next one kicks off. */
function BoardHero() {
  const { services } = useApp()
  const gameDay = useModel(services.gameDay)
  const matchup = useModel(services.matchup)
  const week = gameDay.context?.currentWeek ?? matchup.week
  const live = gameDay.games.filter((g) => g.status === 'inProgress').length
  const now = gameDay.context?.now() ?? Date.now()
  const kickoffs = gameDay.games
    .filter((g) => g.status === 'pregame')
    .map((g) => g.startTime)
    .filter((t): t is number => t !== undefined && t > now)
  const next = kickoffs.length > 0 ? Math.min(...kickoffs) : undefined
  const answer = live > 0
    ? `${live} game${live === 1 ? '' : 's'} live`
    : next !== undefined ? `Next kickoff ${kickoffLabel(next)}` : 'Your week'
  return (
    <ScreenHero
      overline={week !== undefined ? `Board · Week ${week}` : 'Board'}
      icon={LayoutGrid}
      answer={answer}
      detail="Your week at a glance — tap any tile for the full screen."
      hue={hueForScreen('board')}
      trailing={live > 0 ? <LiveBadge /> : undefined}
    />
  )
}
