/**
 * One slot's decision — ports of `DecideSheet` and `FreeAgentHopper`
 * (Views/Decide/FreeAgentHopper.swift): the comparison on the this-week lens,
 * with the free agents who could take the slot underneath. Adding one only
 * puts him in this comparison — the claim itself is made on the Waiver Board.
 * The session lives as long as the dialog; nothing is stored.
 */
import { useState } from 'react'
import { CirclePlus, Inbox } from 'lucide-react'
import { playerPosition } from '@data/playerIndex'
import type { DecideModel, DecideSession } from '@models/lineup/DecideModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { CompareDialog, type CompareSource } from '../market/CompareDialog'
import { SearchField } from '../market/shared'
import './lineup.css'

const trimWhitespaces = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

export function DecideDialog({ session, onClose }: { session: DecideSession; onClose: () => void }) {
  const { services } = useApp()
  useModel(session)
  const source: CompareSource = {
    ids: session.ids,
    incumbentID: session.slot.incumbentID,
    slotToken: session.slot.token,
    canRemove: (id) => session.canRemoveFromCompare(id),
    remove: (id) => session.removeFromCompare(id),
    canAdd: !session.isFull,
  }
  return (
    <CompareDialog
      model={services.discovery}
      source={source}
      initialLens="thisWeek"
      footer={<FreeAgentHopper decide={services.decide} session={session} />}
      onClose={onClose}
    />
  )
}

export function FreeAgentHopper({ decide, session }: { decide: DecideModel; session: DecideSession }) {
  const [query, setQuery] = useState('')
  const suggestions = decide.suggestions(session.slot, new Set(session.ids))
  const token = session.slot.token
  const results = trimWhitespaces(query) === '' ? undefined : decide.searchFreeAgents(query, session.slot, session.ids)
  const add = (id: string, replacing?: string) => { session.add(id, replacing); setQuery('') }
  return (
    <section className="card lineup-stack decide-hopper" aria-label="From the waiver wire" data-testid="decide.hopper">
      <div className="decide-hopper-title t-body">
        <Inbox size={16} aria-hidden /> From the waiver wire
      </div>
      {suggestions.length === 0 && (
        <p className="t-meta muted" style={{ margin: 0 }}>{`No free agent beats your weakest option at ${token} this week.`}</p>
      )}
      {suggestions.map((s) => (
        <HopperRow key={s.id} id={s.id} name={s.row.name}
          detail={[s.row.position, s.row.team].filter((x): x is string => x !== undefined).join(' · ')}
          reason={s.reason} session={session} onAdd={add} decide={decide} />
      ))}
      <SearchField value={query} onChange={setQuery} placeholder="Search free agents" />
      {results !== undefined && results.length === 0 && (
        <p className="t-meta muted" style={{ margin: 0 }}>{`No free agent at ${token} matches.`}</p>
      )}
      {results?.map((player) => (
        <HopperRow key={player.id} id={player.id} name={player.name}
          detail={[playerPosition(player), player.team].filter((x): x is string => x !== undefined).join(' · ')}
          session={session} onAdd={add} decide={decide} />
      ))}
    </section>
  )
}

function HopperRow({ id, name, detail, reason, session, onAdd, decide }: {
  id: string
  name: string
  detail: string
  reason?: string
  session: DecideSession
  onAdd: (id: string, replacing?: string) => void
  decide: DecideModel
}) {
  const [choosing, setChoosing] = useState(false)
  const full = session.isFull
  const replaceable = session.ids.filter((other) => session.canRemoveFromCompare(other))
  return (
    <div className="decide-hopper-row" data-testid={`decide.hopper.${id}`}>
      <div className="decide-hopper-row-main">
        <span className="decide-hopper-text">
          <span className="t-body" style={{ fontWeight: 600 }}>{name}</span>
          <span className="t-meta muted">{detail}</span>
          {reason && <span className="t-meta" style={{ color: 'var(--start)' }}>{reason}</span>}
        </span>
        <button
          type="button"
          className="decide-add"
          aria-expanded={full ? choosing : undefined}
          aria-label={full ? `Add ${name} in place of another player` : `Add ${name} to the comparison`}
          onClick={() => (full ? setChoosing((c) => !c) : onAdd(id))}
        >
          <CirclePlus size={22} aria-hidden />
        </button>
      </div>
      {full && choosing && (
        <div className="decide-replace" role="group" aria-label={`Replace a player with ${name}`}>
          {replaceable.map((other) => (
            <button key={other} type="button" className="button mk-small" onClick={() => { setChoosing(false); onAdd(id, other) }}>
              {`Replace ${decide.context?.playerName(other) ?? other}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
