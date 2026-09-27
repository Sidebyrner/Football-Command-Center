/**
 * QB Stream — quarterbacks ranked on this week and the rest of the season,
 * each compared with the QB a stream would replace. Port of `QBStreamView`,
 * `QBTeamEditorView` and `QBPlayerOverrideView`.
 */
import { useState } from 'react'
import { QB_KNOBS, QB_ROLE_LABEL, QB_ROLES, type QBRole } from '@core/streams/QBStream'
import { PRACTICE_STATUS_LABEL, STREAM_PRACTICE, type StreamPractice } from '@core/Stream'
import { qbOpponentLabel, type QBStreamTypes, type QBTeamContext, type QBTeamOverride, type QBPlayerOverride } from '@models/streams/QBStreamKind'
import { STREAM_CONTEXT_SOURCE_LABEL, stripUndefined } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp } from '@ui/app/AppContext'
import { metric, num, pointsRows, rosCompareSection, rosPills, StreamFormat, weekLabel } from './format'
import { DestructiveRow, FormSection, NotesField, Picker, Sheet, Slider, Stepper } from './parts'
import type { StreamEditorProps, StreamPlayerEditorProps, StreamScreenSpec } from './spec'
import { StreamContextListView, TeamRow } from './StreamContextListView'
import { StreamScreenView } from './StreamScreenView'

type Model = StreamScreenModel<QBStreamTypes>
const F = StreamFormat

export const qbSpec: StreamScreenSpec<QBStreamTypes> = {
  title: 'QB Stream',
  screen: 'qbStream',
  filterPositions: [],
  scoringSummary: (s) => {
    const parts = [`${num(s.passYard)}/pass yd`, `${num(s.passTD)}/pass TD`]
    if (s.passFirstDown !== 0) parts.push(`${num(s.passFirstDown)}/first down`)
    if (s.incompletion !== 0) parts.push(`${num(s.incompletion)} per incompletion`)
    if (s.sack !== 0) parts.push(`${num(s.sack)} per sack`)
    if (s.interception !== 0) parts.push(`INT ${num(s.interception)} (pick-six ${num(s.interception + s.pickSixExtra)})`)
    if (s.bonus30 + s.bonus40 !== 0) parts.push(`+${num(s.bonus30 + s.bonus40)} 40+ completion`)
    if (s.touchdownBonus40 !== 0) parts.push(`+${num(s.touchdownBonus40)} 40+ yd TD`)
    return parts.join(' · ')
  },
  usage: (p) => `${QB_ROLE_LABEL[p.role]} · ${F.pct(p.compRate)} comp`,
  rowPills: (p) => [
    { label: 'attempts', value: F.one(p.expAtt) },
    { label: 'completion', value: F.pct(p.compRate) },
    { label: 'pass yds', value: F.whole(p.ePassYd) },
    { label: 'pass TDs', value: F.two(p.ePassTd) },
    { label: 'INTs', value: F.two(p.eInt) },
    { label: 'sacks', value: F.one(p.eSacks) },
    { label: 'rush yds', value: F.whole(p.eRushYd) },
    ...rosPills(p.ros),
  ],
  starterPills: (p) => [
    { label: 'attempts', value: F.one(p.expAtt) },
    { label: 'rest of season /g', value: F.one(p.ros.perGame) },
  ],
  teamSpread: (t) => t.spreadOff,
  compare: {
    sections: (_model, players) => [
      {
        title: 'Expected stat line',
        rows: [
          metric('Dropbacks', players.map((p) => p.expDropbacks)),
          metric('Attempts', players.map((p) => p.expAtt)),
          metric('Completion %', players.map((p) => p.compRate), F.pct),
          metric('Incompletions', players.map((p) => p.eInc)),
          metric('Pass yards', players.map((p) => p.ePassYd), F.whole),
          metric('Pass first downs', players.map((p) => p.ePassFd)),
          metric('Pass TD', players.map((p) => p.ePassTd), F.two),
          metric('INT', players.map((p) => p.eInt), F.two),
          metric('Sacks', players.map((p) => p.eSacks)),
          metric('Rush yards', players.map((p) => p.eRushYd), F.whole),
          metric('Rush first downs', players.map((p) => p.eRushFd)),
        ],
      },
      { title: 'Points by stat, if he plays', rows: pointsRows(players.map((p) => p.breakdown)) },
      {
        title: 'Matchup',
        rows: [
          metric('QB points ×', players.map((p) => p.dvpMult), F.three),
          metric('Completions ×', players.map((p) => p.compAdj), F.three),
          metric('Sacks ×', players.map((p) => p.sackAdj), F.three),
          metric('INTs ×', players.map((p) => p.intAdj), F.three),
          metric('Script ×', players.map((p) => p.envMult), F.three),
        ],
      },
      rosCompareSection(players),
    ],
    cardPills: (p) => [
      { label: 'comp', value: F.pct(p.compRate) },
      { label: 'ROS /g', value: F.one(p.ros.perGame) },
    ],
    breakdown: (_model, p) => p.breakdown,
    recentGames: (model, id) => model.recentGames(id).map((g) => {
      const parts = [weekLabel(g)]
      parts.push(`${F.whole(g.completions)}/${F.whole(g.attempts)}, ${F.whole(g.yards)} yds`)
      if (g.touchdowns > 0) parts.push(`${F.whole(g.touchdowns)} TD`)
      if (g.interceptions > 0) parts.push(`${F.whole(g.interceptions)} INT`)
      if (g.sacks > 0) parts.push(`${F.whole(g.sacks)} sk`)
      if (g.rushYards >= 10) parts.push(`${F.whole(g.rushYards)} rush`)
      return { title: `${F.one(g.points)} pts`, detail: parts.join(' · ') }
    }),
  },
  ContextEditor: QBContextEditor,
  PlayerEditor: QBPlayerOverrideView,
}

export function QBStreamScreen() {
  const { services } = useApp()
  return <StreamScreenView model={services.qbStream} spec={qbSpec} />
}

const pctOrDash = (x: number | undefined) => (x !== undefined ? F.pct(x) : '–')
const signedPctOrDash = (x: number | undefined) => (x !== undefined ? F.signed(x, 0) + '%' : '–')

function QBContextEditor({ model, onClose }: StreamEditorProps<QBStreamTypes>) {
  return (
    <StreamContextListView
      model={model}
      onClose={onClose}
      footer="Spread is from each offense's side: positive means that team is the underdog — more dropbacks, more pass volume."
      row={(team) => (
        <TeamRow
          team={team.team}
          opponent={qbOpponentLabel(team)}
          trailing={`spread ${F.signed(team.spreadOff)} · O/U ${F.one(team.total)}`}
          details={<>
            <span>QB matchup {signedPctOrDash(team.dvpPct)}</span>
            <span>comp allowed {pctOrDash(team.oppCompAllowed)}</span>
            <span>sack {pctOrDash(team.oppSackRate)}</span>
          </>}
          sources={[team.linesSource, team.dvpSource, team.ratesSource]}
        />
      )}
      editor={(team, close) => <QBTeamEditorView model={model} team={team} onClose={close} />}
    />
  )
}

function QBTeamEditorView({ model, team, onClose }: { model: Model; team: QBTeamContext; onClose: () => void }) {
  const [spread, setSpread] = useState(team.spreadOff)
  const [total, setTotal] = useState(team.total)
  const [dvp, setDvp] = useState(team.dvpPct ?? 0)
  const [dvpGames, setDvpGames] = useState(Math.max(team.dvpGames, 1))
  const [comp, setComp] = useState(team.oppCompAllowed ?? QB_KNOBS.priorComp)
  const [sack, setSack] = useState(team.oppSackRate ?? QB_KNOBS.priorSack)
  const [int, setInt] = useState(team.oppIntRate ?? QB_KNOBS.priorINT)
  const auto = model.autoTeams[team.team]

  const save = async () => {
    const change: QBTeamOverride = { source: 'manual' }
    if (spread !== auto?.spreadOff) change.spreadOff = spread
    if (total !== auto?.total) change.total = total
    if (dvp !== (auto?.dvpPct ?? 0) || dvpGames !== auto?.dvpGames) { change.dvpPct = dvp; change.dvpGames = dvpGames }
    if (comp !== (auto?.oppCompAllowed ?? QB_KNOBS.priorComp)) change.oppCompAllowed = comp
    if (sack !== (auto?.oppSackRate ?? QB_KNOBS.priorSack)) change.oppSackRate = sack
    if (int !== (auto?.oppIntRate ?? QB_KNOBS.priorINT)) change.oppIntRate = int
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
        header={`${team.team} ${qbOpponentLabel(team)}`}
        footer={`Auto: spread ${F.signed(auto?.spreadOff ?? 0)}, total ${F.one(auto?.total ?? 45)} — ${auto ? STREAM_CONTEXT_SOURCE_LABEL[auto.linesSource] : 'none'}. Underdogs throw more.`}
      >
        <Stepper label={`Spread ${F.signed(spread)}`} value={spread} onChange={setSpread} min={-25} max={25} step={0.5} />
        <Stepper label={`Total ${F.one(total)}`} value={total} onChange={setTotal} min={30} max={65} step={0.5} />
      </FormSection>
      <FormSection header={`What ${team.opponent} allows to quarterbacks vs average`}>
        <Stepper label={`QB points ${F.signed(dvp, 0)}%`} value={dvp} onChange={setDvp} min={-60} max={100} step={5} />
        <Stepper label={`Based on ${dvpGames} games`} value={dvpGames} onChange={setDvpGames} min={1} max={17} />
      </FormSection>
      <FormSection
        header={`${team.opponent} pass defense`}
        footer="Each moves the QB's own rate by half its difference from the league, capped. In this scoring incompletions and sacks cost a point each."
      >
        <Stepper label={`Completion allowed ${F.pct(comp)}`} value={comp} onChange={setComp} min={0.5} max={0.8} step={0.005} />
        <Stepper label={`Sack rate ${F.pct(sack)}`} value={sack} onChange={setSack} min={0.02} max={0.14} step={0.0025} />
        <Stepper label={`INT rate ${F.pct(int)}`} value={int} onChange={setInt} min={0.005} max={0.06} step={0.001} />
      </FormSection>
      <FormSection>
        <DestructiveRow label="Reset to auto" onClick={() => { void model.setTeamOverride(undefined, team.team).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}

function QBPlayerOverrideView({ model, row, onClose }: StreamPlayerEditorProps<QBStreamTypes>) {
  const [role, setRole] = useState<QBRole>(row.role)
  const [practice, setPractice] = useState<StreamPractice>(row.practice)
  const [starterConf, setStarterConf] = useState(row.starterConf)
  const [notes, setNotes] = useState(row.notes)

  const save = async () => {
    const existing = model.overrides.players[row.id]
    const change: QBPlayerOverride = stripUndefined({
      role: role !== row.role ? role : existing?.role,
      practice: practice !== row.practice ? practice : existing?.practice,
      starterConf: starterConf !== row.starterConf ? starterConf : existing?.starterConf,
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
      <FormSection footer="Role sets the rushing priors: a dual-threat's rushing first downs give him a floor.">
        <Picker label="Role" value={role} options={QB_ROLES} optionLabel={(r) => QB_ROLE_LABEL[r]} onChange={setRole} />
        <Picker label="Status" value={practice} options={STREAM_PRACTICE} optionLabel={(p) => PRACTICE_STATUS_LABEL[p]} onChange={setPractice} />
      </FormSection>
      <FormSection>
        <Slider label="Starter confidence" value={starterConf} onChange={setStarterConf} min={0.2} max={1} step={0.05} />
        <p className="stream-form-row t-meta muted">
          Starter confidence {F.two(starterConf)} — the share of dropbacks he takes if active. Lower it for a benching risk or a two-QB plan.
        </p>
      </FormSection>
      <FormSection header="Notes"><NotesField value={notes} onChange={setNotes} /></FormSection>
      <FormSection>
        <DestructiveRow label="Clear edits" onClick={() => { void model.setPlayerOverride(undefined, row.id).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}
