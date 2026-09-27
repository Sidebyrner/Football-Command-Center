/**
 * Search every player in the stream's pool — yours, rivals', free agents — to
 * set the starter to beat or add to a comparison. Port of `StreamPlayerPickerView`.
 */
import { useState } from 'react'
import { CheckCircle2, Search } from 'lucide-react'
import { availabilityLabel } from '@models/league/LeagueContext'
import type { StreamKindTypes, StreamPickerRow } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip } from '@ui/components/Player'
import { StreamFormat } from './format'
import { Sheet } from './parts'

/** Which list the picker adds to. */
export type StreamPickerMode = 'incumbent' | 'compare'

export function StreamPlayerPickerView<K extends StreamKindTypes>({ model: source, mode, onClose }: {
  model: StreamScreenModel<K>; mode: StreamPickerMode; onClose: () => void
}) {
  const model = useModel(source)
  const [query, setQuery] = useState('')
  const noun = model.kind.playerNoun
  const empty = query.replace(/^[\s]+|[\s]+$/g, '').length === 0
  const results = model.searchPlayers(empty ? '' : query)

  const choose = async (player: StreamPickerRow) => {
    if (mode === 'incumbent') await model.setIncumbent(player.id)
    else model.toggleCompare(player.id)
    onClose()
  }

  return (
    <Sheet
      title={mode === 'incumbent' ? 'Starter to beat' : 'Add to compare'}
      onClose={onClose}
      leading={[{ label: 'Cancel', onClick: onClose }]}
    >
      <label className="stream-search">
        <Search size={15} aria-hidden />
        <span className="stream-vh">Search</span>
        <input type="search" placeholder="Name or team" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </label>
      {empty ? (
        <section className="stream-form-section">
          <h3 className="t-meta muted stream-form-header">Top projected {noun}s</h3>
          <Rows model={model} mode={mode} players={results} onChoose={choose} />
          <p className="t-meta muted stream-form-footer">
            Search to find anyone else, including rivals' players and backups below the stream list's usage floor.
          </p>
        </section>
      ) : results.length === 0 ? (
        <p className="card t-body muted">No {noun} matches “{query}”.</p>
      ) : (
        <Rows model={model} mode={mode} players={results} onChoose={choose} />
      )}
    </Sheet>
  )
}

function Rows<K extends StreamKindTypes>({ model, mode, players, onChoose }: {
  model: StreamScreenModel<K>; mode: StreamPickerMode; players: StreamPickerRow[]; onChoose: (p: StreamPickerRow) => void
}) {
  return (
    <div className="card stream-picker-list">
      {players.map((player) => {
        const comparing = mode === 'compare' && model.isComparing(player.id)
        return (
          <button
            key={player.id}
            type="button"
            className="stream-picker-row"
            disabled={mode === 'compare' && !model.canAddToCompare && !model.isComparing(player.id)}
            onClick={() => onChoose(player)}
            aria-pressed={mode === 'compare' ? comparing : undefined}
          >
            <PlayerAvatar sleeperID={player.id} name={player.name} position={player.platform} size={30} />
            <span className="stream-grow">
              <span className="stream-name-line">
                <span className="t-body stream-strong">{player.name}</span>
                <PositionChip position={player.platform} label={player.roleLabel} />
              </span>
              <span className={`t-micro stream-plain ${player.availability.kind === 'freeAgent' ? 'muted' : 'stream-caution'}`}>
                {[player.team, availabilityLabel(player.availability)].filter((x): x is string => x !== undefined).join(' · ')}
              </span>
            </span>
            {player.projected !== undefined && <span className="t-body stream-num">{StreamFormat.one(player.projected)}</span>}
            {comparing && <CheckCircle2 size={18} color="var(--accent)" aria-label="In compare" />}
          </button>
        )
      })}
    </div>
  )
}
