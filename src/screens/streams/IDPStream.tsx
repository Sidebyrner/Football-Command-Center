/**
 * IDP Stream — free-agent defenders ranked by this week's projected points in
 * your scoring, each compared with the IDP starter a stream would replace.
 * Port of `IDPStreamView`, `IDPContextEditorView`, `IDPTeamEditorView` and
 * `IDPPlayerOverrideView`.
 */
import { useState } from 'react'
import { formatNumber } from '@core/numeric'
import type { Position } from '@core/Position'
import { PRACTICE_STATUS_LABEL, STREAM_PRACTICE, type StreamPractice } from '@core/Stream'
import {
  expTackles, IDP_PLATFORM, IDP_SUB_POSITION_LABEL, IDP_SUB_POSITIONS, pointsBreakdown, type IDPSubPosition,
} from '@core/streams/IDPStream'
import type { IDPStreamTypes } from '@models/streams/IDPStreamKind'
import { idpOpponentLabel, type IDPPlayerOverride, type IDPTeamContext, type IDPTeamOverride } from '@models/streams/IDPWeekContext'
import { STREAM_CONTEXT_SOURCE_LABEL, stripUndefined } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp } from '@ui/app/AppContext'
import { metric, pointsRows, StreamFormat, weekLabel } from './format'
import { DestructiveRow, FormSection, NotesField, Picker, Sheet, Slider, Stepper } from './parts'
import type { StreamEditorProps, StreamPlayerEditorProps, StreamScreenSpec } from './spec'
import { StreamContextListView, TeamRow } from './StreamContextListView'
import { StreamScreenView } from './StreamScreenView'

type Model = StreamScreenModel<IDPStreamTypes>
const F = StreamFormat
const IDP_POSITIONS: Position[] = ['LB', 'DL', 'DB']

/** The IDP editor's own `num` and `signed`: one decimal unless told otherwise. */
const n = (x: number, places = 1) => formatNumber(x, places)
const signed = (x: number, places = 1) => (x > 0 ? '+' : '') + n(x, places)

export const idpSpec: StreamScreenSpec<IDPStreamTypes> = {
  title: 'IDP Stream',
  screen: 'idpStream',
  filterPositions: IDP_POSITIONS,
  scoringSummary: (s) => {
    const parts: [string, number][] = [
      ['solo', s.solo], ['ast', s.ast], ['sack', s.sack], ['TFL', s.tfl], ['PD', s.pd],
      ['INT', s.int], ['FF', s.ff], ['QB hit', s.qbHit],
    ]
    const paid = parts.filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${formatNumber(v, 0, 1)}`)
    return paid.length === 0 ? 'no IDP scoring set' : paid.join(' · ')
  },
  usage: (p) => `${F.pct(p.snapShare)} snaps`,
  rowPills: (p) => [
    { label: 'snaps', value: F.whole(p.expSnaps) },
    { label: 'tackles', value: F.one(expTackles(p)) },
    { label: 'sacks', value: F.two(p.eSack) },
    { label: 'TFL', value: F.two(p.eTfl) },
    { label: 'QB hits', value: F.two(p.eQbHit) },
    { label: 'pass def', value: F.two(p.ePd) },
    { label: 'chance he plays', value: F.pct(p.pPlay) },
  ],
  starterPills: (p) => [{ label: 'snaps', value: F.whole(p.expSnaps) }],
  teamSpread: (t) => t.spreadDef,
  compare: {
    sections: (model, players) => [
      {
        title: 'Expected stat line',
        rows: [
          metric('Snaps', players.map((p) => p.expSnaps), F.whole),
          metric('Snap share', players.map((p) => p.snapShare), F.pct),
          metric('Solo', players.map((p) => p.eSolo)),
          metric('Assist', players.map((p) => p.eAst)),
          metric('Sack', players.map((p) => p.eSack), F.two),
          metric('TFL', players.map((p) => p.eTfl), F.two),
          metric('QB hit', players.map((p) => p.eQbHit), F.two),
          metric('Pass def', players.map((p) => p.ePd), F.two),
        ],
      },
      { title: 'Points by stat, if he plays', rows: pointsRows(players.map((p) => pointsBreakdown(p, model.scoring))) },
      {
        title: 'Matchup',
        rows: [
          metric('Tackle matchup ×', players.map((p) => p.tklMult), F.three),
          metric('Pass-pro ×', players.map((p) => p.sackMult), F.two),
        ],
      },
    ],
    cardPills: (p) => [
      { label: 'snaps', value: F.whole(p.expSnaps) },
      { label: 'P(plays)', value: F.pct(p.pPlay) },
    ],
    breakdown: (model, p) => pointsBreakdown(p, model.scoring),
    recentGames: (model, id) => model.recentGames(id).map((g) => {
      const parts = [weekLabel(g)]
      if (g.snapShare !== undefined) parts.push(F.pct(g.snapShare))
      parts.push(`${F.whole(g.tackles)} tkl`)
      if (g.sacks > 0) parts.push(`${F.one(g.sacks)} sk`)
      return { title: `${F.one(g.points)} pts`, detail: parts.join(' · ') }
    }),
  },
  ContextEditor: IDPContextEditorView,
  PlayerEditor: IDPPlayerOverrideView,
}

export function IDPStreamScreen() {
  const { services } = useApp()
  return <StreamScreenView model={services.idpStream} spec={idpSpec} />
}

/**
 * Every team playing this week, with the game context the model uses. Values
 * are auto-filled; editing one marks it as yours, and reset puts it back.
 */
function IDPContextEditorView({ model, onClose }: StreamEditorProps<IDPStreamTypes>) {
  return (
    <StreamContextListView
      model={model}
      onClose={onClose}
      footer="Spread is from each defense's side: positive means that team is the underdog, which means more plays to defend."
      row={(team) => (
        <TeamRow
          team={team.team}
          opponent={idpOpponentLabel(team)}
          trailing={`spread ${signed(team.spreadDef)} · O/U ${n(team.total)}`}
          details={<>
            {IDP_POSITIONS.map((p) => {
              const v = team.dvpPct[p]
              return <span key={p}>{p} {v !== undefined ? signed(v, 0) + '%' : '–'}</span>
            })}
            <span>pass-pro ×{n(team.oppSackEnv, 2)}</span>
          </>}
          sources={[team.linesSource, team.dvpSource, team.sackSource]}
        />
      )}
      editor={(team, close) => <IDPTeamEditorView model={model} team={team} onClose={close} />}
    />
  )
}

function sameDvp(a: Partial<Record<Position, number>>, b: Partial<Record<Position, number>> | undefined): boolean {
  if (!b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<Position>
  for (const k of keys) if (a[k] !== b[k]) return false
  return true
}

function IDPTeamEditorView({ model, team, onClose }: { model: Model; team: IDPTeamContext; onClose: () => void }) {
  const [spread, setSpread] = useState(team.spreadDef)
  const [total, setTotal] = useState(team.total)
  const [sackEnv, setSackEnv] = useState(team.oppSackEnv)
  const [dvp, setDvp] = useState<Partial<Record<Position, number>>>({ ...team.dvpPct })
  const [dvpGames, setDvpGames] = useState(Math.max(team.dvpGames, 1))
  const auto = model.autoTeams[team.team]

  /** Stores only what differs from the auto value, so a later auto refresh still flows through. */
  const save = async () => {
    const change: IDPTeamOverride = { source: 'manual' }
    if (spread !== auto?.spreadDef) change.spreadDef = spread
    if (total !== auto?.total) change.total = total
    if (!sameDvp(dvp, auto?.dvpPct) || dvpGames !== auto?.dvpGames) { change.dvpPct = dvp; change.dvpGames = dvpGames }
    if (sackEnv !== auto?.oppSackEnv) change.oppSackEnv = sackEnv
    await model.setTeamOverride(change, team.team)
  }

  return (
    <Sheet
      title={team.team}
      onClose={onClose}
      leading={[{ label: 'Cancel', onClick: onClose }]}
      trailing={[{ label: 'Save', primary: true, onClick: () => { void save().then(onClose) } }]}
    >
      <FormSection
        header={`${team.team} ${idpOpponentLabel(team)}`}
        footer={`Auto: spread ${signed(auto?.spreadDef ?? 0)}, total ${n(auto?.total ?? 45)} — ${auto ? STREAM_CONTEXT_SOURCE_LABEL[auto.linesSource] : 'none'}.`}
      >
        <Stepper label={`Spread ${signed(spread)}`} value={spread} onChange={setSpread} min={-25} max={25} step={0.5} />
        <Stepper label={`Total ${n(total)}`} value={total} onChange={setTotal} min={30} max={65} step={0.5} />
      </FormSection>
      <FormSection
        header={`Points ${team.opponent} allows vs average`}
        footer="Weighted by games / (games + 6) and capped at ±12% on tackles, so a two-game sample barely moves anything."
      >
        {IDP_POSITIONS.map((p) => (
          <Stepper
            key={p}
            label={`${p} ${signed(dvp[p] ?? 0, 0)}%`}
            value={dvp[p] ?? 0}
            onChange={(v) => setDvp((d) => ({ ...d, [p]: v }))}
            min={-80}
            max={150}
            step={5}
          />
        ))}
        <Stepper label={`Based on ${dvpGames} games`} value={dvpGames} onChange={setDvpGames} min={1} max={17} />
      </FormSection>
      <FormSection header={`${team.opponent} pass protection`} footer="1.00 is average. Above 1 means a leaky offensive line — more sacks. Capped at ±35%.">
        <Stepper label={`×${n(sackEnv, 2)}`} value={sackEnv} onChange={setSackEnv} min={0.6} max={1.4} step={0.05} />
      </FormSection>
      <FormSection>
        <DestructiveRow label="Reset to auto" onClick={() => { void model.setTeamOverride(undefined, team.team).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}

function IDPPlayerOverrideView({ model, row, onClose }: StreamPlayerEditorProps<IDPStreamTypes>) {
  const [position, setPosition] = useState<IDPSubPosition>(row.position)
  const [practice, setPractice] = useState<StreamPractice>(row.practice)
  const [roleConf, setRoleConf] = useState(row.roleConf)
  const [notes, setNotes] = useState(row.notes)
  const alignments = IDP_SUB_POSITIONS.filter((p) => IDP_PLATFORM[p] === row.platform)

  const save = async () => {
    const existing = model.overrides.players[row.id]
    const change: IDPPlayerOverride = stripUndefined({
      position: position !== row.position ? position : existing?.position,
      roleConf: roleConf !== row.roleConf ? roleConf : existing?.roleConf,
      practice: practice !== row.practice ? practice : existing?.practice,
      snapShareEst: existing?.snapShareEst,
      pressures: existing?.pressures,
      notes: notes.length === 0 ? undefined : notes,
    })
    await model.setPlayerOverride(change, row.id)
  }

  return (
    <Sheet
      title={row.name}
      onClose={onClose}
      leading={[{ label: 'Cancel', onClick: onClose }]}
      trailing={[{ label: 'Save', primary: true, onClick: () => { void save().then(onClose) } }]}
    >
      <FormSection footer="Alignment sets the per-snap priors: a box safety tackles far more than a free safety. Status sets P(plays).">
        <Picker label="Alignment" value={position} options={alignments} optionLabel={(p) => IDP_SUB_POSITION_LABEL[p]} onChange={setPosition} />
        <Picker label="Status" value={practice} options={STREAM_PRACTICE} optionLabel={(p) => PRACTICE_STATUS_LABEL[p]} onChange={setPractice} />
      </FormSection>
      <FormSection>
        <Slider label="Role confidence" value={roleConf} onChange={setRoleConf} min={0.2} max={1} step={0.05} minLabel="0.2" maxLabel="1" />
        <p className="stream-form-row t-meta muted">
          Role confidence {n(roleConf, 2)} — lower widens the range and pulls snap share toward a role prior.
        </p>
      </FormSection>
      <FormSection header="Notes"><NotesField value={notes} onChange={setNotes} /></FormSection>
      <FormSection>
        <DestructiveRow label="Clear edits" onClick={() => { void model.setPlayerOverride(undefined, row.id).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}
