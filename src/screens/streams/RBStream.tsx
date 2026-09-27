/**
 * RB Stream — free-agent backs ranked by this week's projected points in
 * your scoring, each compared with the RB a stream would replace. Port of
 * `RBStreamView`, `RBContextEditorView`, `RBTeamEditorView` and
 * `RBPlayerOverrideView`.
 */
import { useState } from 'react'
import { PRACTICE_STATUS_LABEL, STREAM_PRACTICE, type StreamPractice } from '@core/Stream'
import {
  RB_ROLE_LABEL, RB_ROLE_SUMMARY, RB_ROLES, rbFirstDowns, rbPointsBreakdown, rbPrior, rbTouchdowns, type RBRole,
} from '@core/streams/RBStream'
import type { RBStreamTypes } from '@models/streams/RBStreamKind'
import { rbOpponentLabel, rbTeamImplied, type RBPlayerOverride, type RBTeamContext, type RBTeamOverride } from '@models/streams/RBWeekContext'
import { STREAM_CONTEXT_SOURCE_LABEL, stripUndefined } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp } from '@ui/app/AppContext'
import { metric, num, pointsRows, StreamFormat, text, weekLabel } from './format'
import { DestructiveRow, FormSection, NotesField, Picker, Sheet, Slider, Stepper } from './parts'
import type { StreamEditorProps, StreamPlayerEditorProps, StreamScreenSpec } from './spec'
import { StreamContextListView, TeamRow } from './StreamContextListView'
import { StreamScreenView } from './StreamScreenView'

type Model = StreamScreenModel<RBStreamTypes>
const F = StreamFormat

export const rbSpec: StreamScreenSpec<RBStreamTypes> = {
  title: 'RB Stream',
  screen: 'rbStream',
  filterPositions: [],
  scoringSummary: (s) => {
    const parts: string[] = []
    parts.push(s.reception !== 0 ? `${num(s.reception)} per catch` : 'no PPR')
    if (s.rushingYard !== 0) parts.push(`${num(s.rushingYard)}/yd`)
    if (s.firstDown !== 0) parts.push(`${num(s.firstDown)}/first down`)
    if (s.touchdown !== 0) parts.push(`${num(s.touchdown)}/TD`)
    const run40 = s.runBonus30 + s.runBonus40
    if (run40 !== 0) parts.push(`+${num(run40)} 40+ yd run`)
    if (s.touchdownBonus40 !== 0 || s.touchdownBonus50 !== 0) {
      parts.push(`+${num(s.touchdownBonus40)} 40+ yd TD, +${num(s.touchdownBonus40 + s.touchdownBonus50)} 50+`)
    }
    if (s.fumble !== 0 || s.fumbleLost !== 0) parts.push(`fumble ${num(s.fumble)}, lost ${num(s.fumble + s.fumbleLost)}`)
    return parts.join(' · ')
  },
  usage: (p) => `${F.pct(p.carryShare)} of carries`,
  rowPills: (p) => [
    { label: 'carries', value: F.one(p.expCarries) },
    { label: 'targets', value: F.one(p.expTargets) },
    { label: 'rush yds', value: F.whole(p.eRushYd) },
    { label: 'rec yds', value: F.whole(p.eRecYd) },
    { label: 'first downs', value: F.one(rbFirstDowns(p)) },
    { label: 'TDs', value: F.two(rbTouchdowns(p)) },
    { label: 'chance he plays', value: F.pct(p.pPlay) },
  ],
  starterPills: (p) => [
    { label: 'carries', value: F.one(p.expCarries) },
    { label: 'implied', value: F.one(p.implied) },
  ],
  teamSpread: (t) => t.spreadOff,
  compare: {
    sections: (model, players) => [
      {
        title: 'Expected stat line',
        rows: [
          metric('Carries', players.map((p) => p.expCarries)),
          metric('Carry share', players.map((p) => p.carryShare), F.pct),
          metric('Targets', players.map((p) => p.expTargets)),
          metric('Rush yards', players.map((p) => p.eRushYd), F.whole),
          metric('Rec yards', players.map((p) => p.eRecYd), F.whole),
          metric('Rush first downs', players.map((p) => p.eRushFirstDowns)),
          metric('Rec first downs', players.map((p) => p.eRecFirstDowns)),
          metric('TD', players.map((p) => rbTouchdowns(p)), F.two),
          metric('30+ plays', players.map((p) => p.e30), F.two),
          metric('40+ plays', players.map((p) => p.e40), F.two),
          text('Red-zone share', players.map((p) => (p.redZoneShare !== undefined ? F.pct(p.redZoneShare) : '–'))),
        ],
      },
      { title: 'Points by stat, if he plays', rows: pointsRows(players.map((p) => rbPointsBreakdown(p, model.scoring))) },
      {
        title: 'Game script',
        rows: [
          metric('Implied team total', players.map((p) => p.implied)),
          metric('Rush volume ×', players.map((p) => p.rushEnv), F.three),
          metric('RB matchup ×', players.map((p) => p.dvpMult), F.three),
          metric('Line ×', players.map((p) => p.lineMult), F.two),
          metric('Red zone ×', players.map((p) => p.redZoneMult), F.two),
        ],
      },
    ],
    cardPills: (p) => [
      { label: 'carries', value: F.one(p.expCarries) },
      { label: '1st dn', value: F.one(rbFirstDowns(p)) },
    ],
    breakdown: (model, p) => rbPointsBreakdown(p, model.scoring),
    recentGames: (model, id) => model.recentGames(id).map((g) => {
      const parts = [weekLabel(g)]
      parts.push(`${F.whole(g.carries)}–${F.whole(g.rushYards)}`)
      parts.push(`${F.whole(g.firstDowns)} 1st dn`)
      if (g.targets > 0) parts.push(`${F.whole(g.targets)} tgt`)
      if (g.touchdowns > 0) parts.push(`${F.whole(g.touchdowns)} TD`)
      if (g.longestRun !== undefined && g.longestRun >= 20) parts.push(`long ${F.whole(g.longestRun)}`)
      if (g.fumblesLost > 0) parts.push('fumble lost')
      return { title: `${F.one(g.points)} pts`, detail: parts.join(' · ') }
    }),
  },
  ContextEditor: RBContextEditorView,
  PlayerEditor: RBPlayerOverrideView,
}

export function RBStreamScreen() {
  const { services } = useApp()
  return <StreamScreenView model={services.rbStream} spec={rbSpec} />
}

/**
 * Every team playing this week, with the running-game context the RB model
 * uses. Values are auto-filled; editing one marks it as yours, and reset puts it back.
 */
function RBContextEditorView({ model, onClose }: StreamEditorProps<RBStreamTypes>) {
  return (
    <StreamContextListView
      model={model}
      onClose={onClose}
      footer="Spread is from each offense's side: positive means that team is the underdog, which means fewer carries and a lower implied total."
      row={(team) => (
        <TeamRow
          team={team.team}
          opponent={rbOpponentLabel(team)}
          trailing={`spread ${F.signed(team.spreadOff)} · O/U ${F.one(team.total)}`}
          details={<>
            <span>implied {F.one(rbTeamImplied(team))}</span>
            <span>RB matchup {team.dvpPct !== undefined ? F.signed(team.dvpPct, 0) + '%' : '–'}</span>
            <span>line ×{F.two(team.lineAdj)}</span>
          </>}
          sources={[team.linesSource, team.dvpSource, team.lineSource]}
        />
      )}
      editor={(team, close) => <RBTeamEditorView model={model} team={team} onClose={close} />}
    />
  )
}

function RBTeamEditorView({ model, team, onClose }: { model: Model; team: RBTeamContext; onClose: () => void }) {
  const [spread, setSpread] = useState(team.spreadOff)
  const [total, setTotal] = useState(team.total)
  const [dvp, setDvp] = useState(team.dvpPct ?? 0)
  const [dvpGames, setDvpGames] = useState(Math.max(team.dvpGames, 1))
  const [lineAdj, setLineAdj] = useState(team.lineAdj)
  const auto = model.autoTeams[team.team]

  /** Stores only what differs from the auto value, so a later auto refresh still flows through. */
  const save = async () => {
    const change: RBTeamOverride = { source: 'manual' }
    if (spread !== auto?.spreadOff) change.spreadOff = spread
    if (total !== auto?.total) change.total = total
    if (dvp !== (auto?.dvpPct ?? 0) || dvpGames !== auto?.dvpGames) { change.dvpPct = dvp; change.dvpGames = dvpGames }
    if (lineAdj !== auto?.lineAdj) change.lineAdj = lineAdj
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
        header={`${team.team} ${rbOpponentLabel(team)}`}
        footer={`Auto: spread ${F.signed(auto?.spreadOff ?? 0)}, total ${F.one(auto?.total ?? 45)} — ${auto ? STREAM_CONTEXT_SOURCE_LABEL[auto.linesSource] : 'none'}. Favorites run more and score more.`}
      >
        <Stepper label={`Spread ${F.signed(spread)}`} value={spread} onChange={setSpread} min={-25} max={25} step={0.5} />
        <Stepper label={`Total ${F.one(total)}`} value={total} onChange={setTotal} min={30} max={65} step={0.5} />
      </FormSection>
      <FormSection
        header={`What ${team.opponent} allows to running backs vs average`}
        footer="Weighted by games / (games + 6) and capped at ±15% on yards and first downs."
      >
        <Stepper label={`RB points ${F.signed(dvp, 0)}%`} value={dvp} onChange={setDvp} min={-60} max={100} step={5} />
        <Stepper label={`Based on ${dvpGames} games`} value={dvpGames} onChange={setDvpGames} min={1} max={17} />
      </FormSection>
      <FormSection
        header={`${team.team} blocking vs ${team.opponent} front`}
        footer="1.00 is neutral. Below 1 for O-line injuries or stacked boxes; above 1 for front-seven injuries or light boxes. Capped at ±25%."
      >
        <Stepper label={`×${F.two(lineAdj)}`} value={lineAdj} onChange={setLineAdj} min={0.7} max={1.3} step={0.05} />
      </FormSection>
      <FormSection>
        <DestructiveRow label="Reset to auto" onClick={() => { void model.setTeamOverride(undefined, team.team).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}

function RBPlayerOverrideView({ model, row, onClose }: StreamPlayerEditorProps<RBStreamTypes>) {
  const neutralRedZone = rbPrior(row.role).redZoneShare
  const [role, setRole] = useState<RBRole>(row.role)
  const [practice, setPractice] = useState<StreamPractice>(row.practice)
  const [roleConf, setRoleConf] = useState(row.roleConf)
  const [redZoneShare, setRedZoneShare] = useState(row.redZoneShare ?? neutralRedZone)
  const [notes, setNotes] = useState(row.notes)

  const save = async () => {
    const existing = model.overrides.players[row.id]
    const change: RBPlayerOverride = stripUndefined({
      role: role !== row.role ? role : existing?.role,
      practice: practice !== row.practice ? practice : existing?.practice,
      roleConf: roleConf !== row.roleConf ? roleConf : existing?.roleConf,
      redZoneShare: redZoneShare !== (row.redZoneShare ?? neutralRedZone) ? redZoneShare : existing?.redZoneShare,
      carryShareEst: existing?.carryShareEst,
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
      <FormSection footer="Role sets the carry-share, target-share and per-carry priors, and what counts as a neutral red-zone share. Status sets P(plays).">
        <Picker label="Role" value={role} options={RB_ROLES} optionLabel={(r) => `${RB_ROLE_LABEL[r]} — ${RB_ROLE_SUMMARY[r]}`} onChange={setRole} />
        <Picker label="Status" value={practice} options={STREAM_PRACTICE} optionLabel={(p) => PRACTICE_STATUS_LABEL[p]} onChange={setPractice} />
      </FormSection>
      <FormSection>
        <Slider label="Role confidence" value={roleConf} onChange={setRoleConf} min={0.2} max={1} step={0.05} minLabel="0.2" maxLabel="1" />
        <p className="stream-form-row t-meta muted">
          Role confidence {F.two(roleConf)} — lower widens the range and pulls carry share toward the role prior.
        </p>
        <Slider label="Red-zone share" value={redZoneShare} onChange={setRedZoneShare} min={0} max={0.9} step={0.01} minLabel="0%" maxLabel="90%" />
        <p className="stream-form-row t-meta muted">
          Share of team red-zone carries {F.pct(redZoneShare)} — it moves the TD rate up to ±60% around the role's neutral share.
        </p>
      </FormSection>
      <FormSection header="Notes"><NotesField value={notes} onChange={setNotes} /></FormSection>
      <FormSection>
        <DestructiveRow label="Clear edits" onClick={() => { void model.setPlayerOverride(undefined, row.id).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}
