/**
 * TE Stream — free-agent tight ends ranked by this week's projected points in
 * your scoring, each compared with the TE a stream would replace. Port of
 * `TEStreamView`, `TEContextEditorView`, `TETeamEditorView` and
 * `TEPlayerOverrideView`.
 */
import { useState } from 'react'
import { PRACTICE_STATUS_LABEL, STREAM_PRACTICE, type StreamPractice } from '@core/Stream'
import { teHasLongCatchBonuses, TE_ROLE_LABEL, TE_ROLE_SUMMARY, TE_ROLES, TE_STREAM_KNOBS, tePointsBreakdown, type TERole } from '@core/streams/TEStream'
import type { TEStreamTypes } from '@models/streams/TEStreamKind'
import { teOpponentLabel, type TEPlayerOverride, type TETeamContext, type TETeamOverride } from '@models/streams/TEWeekContext'
import { STREAM_CONTEXT_SOURCE_LABEL, stripUndefined } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp } from '@ui/app/AppContext'
import { metric, num, pointsRows, StreamFormat, text, weekLabel } from './format'
import { DestructiveRow, FormSection, NotesField, Picker, Sheet, Slider, Stepper } from './parts'
import type { StreamEditorProps, StreamPlayerEditorProps, StreamScreenSpec } from './spec'
import { StreamContextListView, TeamRow } from './StreamContextListView'
import { StreamScreenView } from './StreamScreenView'

type Model = StreamScreenModel<TEStreamTypes>
const F = StreamFormat
const routesText = (routes: number | undefined) => (routes !== undefined ? F.pct(routes) : '–')

export const teSpec: StreamScreenSpec<TEStreamTypes> = {
  title: 'TE Stream',
  screen: 'teStream',
  filterPositions: [],
  scoringSummary: (s) => {
    const parts: string[] = []
    if (s.reception !== 0) parts.push(`${num(s.reception)} per catch`)
    else parts.push('no PPR')
    if (s.premiumReception !== 0) parts.push(`+${num(s.premiumReception)} TE premium per catch`)
    if (s.receivingYard !== 0) parts.push(`${num(s.receivingYard)}/yd`)
    if (s.firstDown !== 0) parts.push(`${num(s.firstDown)}/first down`)
    if (s.premiumFirstDown !== 0) parts.push(`+${num(s.premiumFirstDown)} TE premium per first down`)
    if (s.touchdown !== 0) parts.push(`${num(s.touchdown)}/TD`)
    if (teHasLongCatchBonuses(s)) parts.push(`+${num(s.bonus30)} 30–39 yd catch, +${num(s.bonus30 + s.bonus40)} 40+`)
    if (s.touchdownBonus40 !== 0 || s.touchdownBonus50 !== 0) {
      parts.push(`+${num(s.touchdownBonus40)} 40+ yd TD, +${num(s.touchdownBonus40 + s.touchdownBonus50)} 50+`)
    }
    return parts.join(' · ')
  },
  usage: (p) => {
    let line = `${F.pct(p.targetShare)} of targets`
    if (p.estRouteShare !== undefined) line += ` · ~${F.pct(p.estRouteShare)} routes`
    return line
  },
  rowPills: (p) => [
    { label: 'targets', value: F.one(p.expTargets) },
    { label: 'rec yds', value: F.whole(p.eRecYd) },
    { label: 'first downs', value: F.one(p.eFirstDowns) },
    { label: 'TDs', value: F.two(p.eTouchdowns) },
    { label: 'est. routes', value: routesText(p.estRouteShare) },
    { label: 'chance he plays', value: F.pct(p.pPlay) },
  ],
  starterPills: (p) => [
    { label: 'targets', value: F.one(p.expTargets) },
    { label: 'TDs', value: F.two(p.eTouchdowns) },
  ],
  teamSpread: (t) => t.spreadOff,
  compare: {
    sections: (model, players) => [
      {
        title: 'Expected stat line',
        rows: [
          metric('Targets', players.map((p) => p.expTargets)),
          metric('Target share', players.map((p) => p.targetShare), F.pct),
          text('Est. route share', players.map((p) => routesText(p.estRouteShare))),
          metric('Receptions', players.map((p) => p.eRec)),
          metric('Yards', players.map((p) => p.eRecYd), F.whole),
          metric('First downs', players.map((p) => p.eFirstDowns)),
          metric('TD', players.map((p) => p.eTouchdowns), F.two),
          metric('30+ catches', players.map((p) => p.e30), F.two),
          text('aDOT', players.map((p) => (p.adot !== undefined ? F.one(p.adot) : '–'))),
          text('Red-zone share', players.map((p) => (p.redZoneShare !== undefined ? F.pct(p.redZoneShare) : '–'))),
        ],
      },
      { title: 'Points by stat, if he plays', rows: pointsRows(players.map((p) => tePointsBreakdown(p, model.scoring))) },
      {
        title: 'Matchup',
        rows: [
          metric('Pass volume ×', players.map((p) => p.envMult), F.three),
          metric('TE matchup ×', players.map((p) => p.dvpMult), F.three),
          metric('Seam coverage ×', players.map((p) => p.coverageMult), F.two),
          metric('Red zone ×', players.map((p) => p.redZoneMult), F.two),
          metric('Vacated targets', players.map((p) => p.vacatedTargetBoost), F.pct),
        ],
      },
    ],
    cardPills: (p) => [
      { label: 'targets', value: F.one(p.expTargets) },
      { label: 'TDs', value: F.two(p.eTouchdowns) },
    ],
    breakdown: (model, p) => tePointsBreakdown(p, model.scoring),
    recentGames: (model, id) => model.recentGames(id).map((g) => {
      const parts = [weekLabel(g)]
      parts.push(`${F.whole(g.receptions)}/${F.whole(g.targets)} for ${F.whole(g.yards)}`)
      parts.push(`${F.whole(g.firstDowns)} 1st dn`)
      if (g.touchdowns > 0) parts.push(`${F.whole(g.touchdowns)} TD`)
      if (g.redZoneTargets > 0) parts.push(`${F.whole(g.redZoneTargets)} RZ tgt`)
      if (g.snapShare !== undefined) parts.push(`${F.pct(g.snapShare)} snaps`)
      return { title: `${F.one(g.points)} pts`, detail: parts.join(' · ') }
    }),
  },
  ContextEditor: TEContextEditorView,
  PlayerEditor: TEPlayerOverrideView,
}

export function TEStreamScreen() {
  const { services } = useApp()
  return <StreamScreenView model={services.teStream} spec={teSpec} />
}

/**
 * Every team playing this week, with the passing-game context the TE model
 * uses. Values are auto-filled; editing one marks it as yours, and reset puts it back.
 */
function TEContextEditorView({ model, onClose }: StreamEditorProps<TEStreamTypes>) {
  return (
    <StreamContextListView
      model={model}
      onClose={onClose}
      footer="Spread is from each offense's side: positive means that team is the underdog, which means more passing."
      row={(team) => (
        <TeamRow
          team={team.team}
          opponent={teOpponentLabel(team)}
          trailing={`spread ${F.signed(team.spreadOff)} · O/U ${F.one(team.total)}`}
          details={<>
            <span>TE matchup {team.dvpPct !== undefined ? F.signed(team.dvpPct, 0) + '%' : '–'}</span>
            <span>seam coverage ×{F.two(team.seamCoverageAdj)}</span>
          </>}
          sources={[team.linesSource, team.dvpSource, team.seamCoverageSource]}
        />
      )}
      editor={(team, close) => <TETeamEditorView model={model} team={team} onClose={close} />}
    />
  )
}

function TETeamEditorView({ model, team, onClose }: { model: Model; team: TETeamContext; onClose: () => void }) {
  const [spread, setSpread] = useState(team.spreadOff)
  const [total, setTotal] = useState(team.total)
  const [dvp, setDvp] = useState(team.dvpPct ?? 0)
  const [dvpGames, setDvpGames] = useState(Math.max(team.dvpGames, 1))
  const [coverage, setCoverage] = useState(team.seamCoverageAdj)
  const auto = model.autoTeams[team.team]

  /** Stores only what differs from the auto value, so a later auto refresh still flows through. */
  const save = async () => {
    const change: TETeamOverride = { source: 'manual' }
    if (spread !== auto?.spreadOff) change.spreadOff = spread
    if (total !== auto?.total) change.total = total
    if (dvp !== (auto?.dvpPct ?? 0) || dvpGames !== auto?.dvpGames) { change.dvpPct = dvp; change.dvpGames = dvpGames }
    if (coverage !== auto?.seamCoverageAdj) change.seamCoverageAdj = coverage
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
        header={`${team.team} ${teOpponentLabel(team)}`}
        footer={`Auto: spread ${F.signed(auto?.spreadOff ?? 0)}, total ${F.one(auto?.total ?? 45)} — ${auto ? STREAM_CONTEXT_SOURCE_LABEL[auto.linesSource] : 'none'}. Underdogs throw more.`}
      >
        <Stepper label={`Spread ${F.signed(spread)}`} value={spread} onChange={setSpread} min={-25} max={25} step={0.5} />
        <Stepper label={`Total ${F.one(total)}`} value={total} onChange={setTotal} min={30} max={65} step={0.5} />
      </FormSection>
      <FormSection
        header={`What ${team.opponent} allows to tight ends vs average`}
        footer="Weighted by games / (games + 6) and capped at ±18% on yards and first downs."
      >
        <Stepper label={`TE points ${F.signed(dvp, 0)}%`} value={dvp} onChange={setDvp} min={-60} max={100} step={5} />
        <Stepper label={`Based on ${dvpGames} games`} value={dvpGames} onChange={setDvpGames} min={1} max={17} />
      </FormSection>
      <FormSection
        header={`${team.opponent} linebacker and safety coverage`}
        footer="1.00 is neutral. Above 1 when a coverage linebacker or safety is out or the defense struggles over the middle; below 1 against a strong coverage linebacker or safety, or a QB downgrade. Capped at ±30%."
      >
        <Stepper label={`×${F.two(coverage)}`} value={coverage} onChange={setCoverage} min={0.7} max={1.3} step={0.05} />
      </FormSection>
      <FormSection>
        <DestructiveRow label="Reset to auto" onClick={() => { void model.setTeamOverride(undefined, team.team).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}

function TEPlayerOverrideView({ model, row, onClose }: StreamPlayerEditorProps<TEStreamTypes>) {
  const neutral = TE_STREAM_KNOBS.neutralRedZoneShare
  const [role, setRole] = useState<TERole>(row.role)
  const [practice, setPractice] = useState<StreamPractice>(row.practice)
  const [roleConf, setRoleConf] = useState(row.roleConf)
  const [redZoneShare, setRedZoneShare] = useState(row.redZoneShare ?? neutral)
  const [vacated, setVacated] = useState(row.vacatedTargetBoost)
  const [notes, setNotes] = useState(row.notes)

  const save = async () => {
    const existing = model.overrides.players[row.id]
    const change: TEPlayerOverride = stripUndefined({
      role: role !== row.role ? role : existing?.role,
      practice: practice !== row.practice ? practice : existing?.practice,
      roleConf: roleConf !== row.roleConf ? roleConf : existing?.roleConf,
      redZoneShare: redZoneShare !== (row.redZoneShare ?? neutral) ? redZoneShare : existing?.redZoneShare,
      targetShareEst: existing?.targetShareEst,
      vacatedTargetBoost: vacated !== row.vacatedTargetBoost ? vacated : existing?.vacatedTargetBoost,
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
      <FormSection footer="Role sets the per-target priors and how many snaps are routes: a featured or seam TE runs a route on most snaps, an inline red-zone TE on about half. Status sets P(plays).">
        <Picker label="Role" value={role} options={TE_ROLES} optionLabel={(r) => `${TE_ROLE_LABEL[r]} — ${TE_ROLE_SUMMARY[r]}`} onChange={setRole} />
        <Picker label="Status" value={practice} options={STREAM_PRACTICE} optionLabel={(p) => PRACTICE_STATUS_LABEL[p]} onChange={setPractice} />
      </FormSection>
      <FormSection>
        <Slider label="Role confidence" value={roleConf} onChange={setRoleConf} min={0.2} max={1} step={0.05} minLabel="0.2" maxLabel="1" />
        <p className="stream-form-row t-meta muted">
          Role confidence {F.two(roleConf)} — lower widens the range and pulls target share toward the role prior.
        </p>
        <Slider label="Red-zone share" value={redZoneShare} onChange={setRedZoneShare} min={0} max={0.5} step={0.01} minLabel="0%" maxLabel="50%" />
        <p className="stream-form-row t-meta muted">
          Red-zone target share {F.pct(redZoneShare)} — 15% is neutral; it moves the TD rate up to ±70%.
        </p>
        <Slider label="Vacated targets" value={vacated} onChange={setVacated} min={0} max={TE_STREAM_KNOBS.vacatedBoostCap} step={0.01} minLabel="0%" maxLabel="10%" />
        <p className="stream-form-row t-meta muted">
          Vacated targets +{F.pct(vacated)} — target share added when a teammate (a WR1, the other TE) is out.
        </p>
      </FormSection>
      <FormSection header="Notes"><NotesField value={notes} onChange={setNotes} /></FormSection>
      <FormSection>
        <DestructiveRow label="Clear edits" onClick={() => { void model.setPlayerOverride(undefined, row.id).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}
