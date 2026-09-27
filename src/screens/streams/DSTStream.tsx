/**
 * D/ST Stream — team defenses ranked on this week and the rest of the season.
 * Port of `DSTStreamView`, `DSTTeamEditorView` and `DSTNotesView`.
 */
import { useState } from 'react'
import { dstTakeaways } from '@core/streams/DSTStream'
import { dstOpponentImplied, dstOpponentLabel, type DSTStreamTypes, type DSTTeamContext, type DSTTeamOverride } from '@models/streams/DSTStreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp } from '@ui/app/AppContext'
import { metric, num, pointsRows, rosCompareSection, rosPills, StreamFormat, weekLabel } from './format'
import { DestructiveRow, FormSection, NotesField, Sheet, Stepper } from './parts'
import type { StreamEditorProps, StreamPlayerEditorProps, StreamScreenSpec } from './spec'
import { StreamContextListView, TeamRow } from './StreamContextListView'
import { StreamScreenView } from './StreamScreenView'

type Model = StreamScreenModel<DSTStreamTypes>
const F = StreamFormat

export const dstSpec: StreamScreenSpec<DSTStreamTypes> = {
  title: 'D/ST Stream',
  screen: 'dstStream',
  filterPositions: [],
  scoringSummary: (s) => {
    const parts = [`sack ${num(s.sack)}`, `INT ${num(s.interception)}`, `fumble rec ${num(s.fumbleRecovery)}`, `TD ${num(s.touchdown)}`]
    const shutout = s.pointsAllowed[0]?.points
    const blowout = s.pointsAllowed[s.pointsAllowed.length - 1]?.points
    if (shutout !== undefined && blowout !== undefined) parts.push(`points allowed ${num(shutout)} to ${num(blowout)}`)
    if (s.yardsAllowed.some((t) => t.points !== 0)) parts.push('yards-allowed tiers')
    return parts.join(' · ')
  },
  usage: (p) => `opp implied ${F.one(p.impliedOpp)}`,
  rowPills: (p) => [
    { label: 'sacks', value: F.one(p.eSacks) },
    { label: 'takeaways', value: F.two(dstTakeaways(p)) },
    { label: 'TDs', value: F.two(p.eTd) },
    { label: 'points allowed pts', value: F.one(p.paPts) },
    { label: 'opp implied', value: F.one(p.impliedOpp) },
    ...rosPills(p.ros),
  ],
  starterPills: (p) => [
    { label: 'opp implied', value: F.one(p.impliedOpp) },
    { label: 'rest of season /g', value: F.one(p.ros.perGame) },
  ],
  teamSpread: (t) => t.spreadDef,
  compare: {
    sections: (_model, players) => [
      {
        title: 'Expected stat line',
        rows: [
          metric('Opponent dropbacks', players.map((p) => p.expDropbacks)),
          metric('Sacks', players.map((p) => p.eSacks)),
          metric('Interceptions', players.map((p) => p.eInt), F.two),
          metric('Fumble recoveries', players.map((p) => p.eFr), F.two),
          metric('Touchdowns', players.map((p) => p.eTd), F.two),
          metric('Opp implied points', players.map((p) => p.impliedOpp)),
          metric('Points allowed (est.)', players.map((p) => p.paMean)),
        ],
      },
      { title: 'Points by stat, if they play', rows: pointsRows(players.map((p) => p.breakdown)) },
      {
        title: 'Matchup',
        rows: [
          metric('Matchup ×', players.map((p) => p.dvpMult), F.three),
          metric('QB adj ×', players.map((p) => p.qbAdj), F.two),
          metric('Rest-of-season opp PPG', players.map((p) => p.rosAvgOppPpg)),
        ],
      },
      rosCompareSection(players),
    ],
    cardPills: (p) => [
      { label: 'takeaways', value: F.two(dstTakeaways(p)) },
      { label: 'ROS /g', value: F.one(p.ros.perGame) },
    ],
    breakdown: (_model, p) => p.breakdown,
    recentGames: (model, id) => model.recentGames(id).map((g) => {
      const parts = [weekLabel(g)]
      parts.push(`${F.whole(g.sacks)} sk`)
      if (g.takeaways > 0) parts.push(`${F.whole(g.takeaways)} TO`)
      if (g.touchdowns > 0) parts.push(`${F.whole(g.touchdowns)} TD`)
      parts.push(`${F.whole(g.pointsAllowed)} allowed`)
      return { title: `${F.one(g.points)} pts`, detail: parts.join(' · ') }
    }),
  },
  ContextEditor: DSTContextEditor,
  PlayerEditor: DSTNotesView,
}

export function DSTStreamScreen() {
  const { services } = useApp()
  return <StreamScreenView model={services.dstStream} spec={dstSpec} />
}

function DSTContextEditor({ model, onClose }: StreamEditorProps<DSTStreamTypes>) {
  return (
    <StreamContextListView
      model={model}
      onClose={onClose}
      footer="Spread is from each defense's side: positive means that team is the underdog, so its opponent is expected to score more."
      row={(team) => (
        <TeamRow
          team={team.team}
          opponent={dstOpponentLabel(team)}
          trailing={`opp implied ${F.one(dstOpponentImplied(team))}`}
          details={<>
            <span>matchup {team.dvpPct !== undefined ? F.signed(team.dvpPct, 0) + '%' : '–'}</span>
            <span>QB adj ×{F.two(team.oppQbAdj)}</span>
          </>}
          sources={[team.linesSource, team.dvpSource, team.qbSource]}
        />
      )}
      editor={(team, close) => <DSTTeamEditorView model={model} team={team} onClose={close} />}
    />
  )
}

function DSTTeamEditorView({ model, team, onClose }: { model: Model; team: DSTTeamContext; onClose: () => void }) {
  const [spread, setSpread] = useState(team.spreadDef)
  const [total, setTotal] = useState(team.total)
  const [qbAdj, setQbAdj] = useState(team.oppQbAdj)
  const [dvp, setDvp] = useState(team.dvpPct ?? 0)
  const [dvpGames, setDvpGames] = useState(Math.max(team.dvpGames, 1))
  const auto = model.autoTeams[team.team]

  const save = async () => {
    const change: DSTTeamOverride = { source: 'manual' }
    if (spread !== auto?.spreadDef) change.spreadDef = spread
    if (total !== auto?.total) change.total = total
    if (qbAdj !== auto?.oppQbAdj) change.oppQbAdj = qbAdj
    if (dvp !== (auto?.dvpPct ?? 0) || dvpGames !== auto?.dvpGames) { change.dvpPct = dvp; change.dvpGames = dvpGames }
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
        header={`${team.team} ${dstOpponentLabel(team)}`}
        footer={`${team.opponent} is expected to score ${F.one((total + spread) / 2)} — the points-allowed tiers are scored around that.`}
      >
        <Stepper label={`Spread ${F.signed(spread)}`} value={spread} onChange={setSpread} min={-25} max={25} step={0.5} />
        <Stepper label={`Total ${F.one(total)}`} value={total} onChange={setTotal} min={30} max={65} step={0.5} />
      </FormSection>
      <FormSection
        header={`${team.opponent} QB / O-line`}
        footer="1.00 is neutral. Raise it for a backup quarterback or O-line injuries — more sacks and turnovers."
      >
        <Stepper label={`×${F.two(qbAdj)}`} value={qbAdj} onChange={setQbAdj} min={0.7} max={1.6} step={0.05} />
      </FormSection>
      <FormSection header={`What ${team.opponent} gives up to defenses vs average`}>
        <Stepper label={`D/ST points ${F.signed(dvp, 0)}%`} value={dvp} onChange={setDvp} min={-80} max={150} step={5} />
        <Stepper label={`Based on ${dvpGames} games`} value={dvpGames} onChange={setDvpGames} min={1} max={17} />
      </FormSection>
      <FormSection>
        <DestructiveRow label="Reset to auto" onClick={() => { void model.setTeamOverride(undefined, team.team).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}

function DSTNotesView({ model, row, onClose }: StreamPlayerEditorProps<DSTStreamTypes>) {
  const [notes, setNotes] = useState(row.notes)
  const save = async () => {
    await model.setPlayerOverride(notes.length === 0 ? undefined : { notes }, row.id)
  }
  return (
    <Sheet
      title={row.name}
      onClose={onClose}
      leading={[{ label: 'Cancel', onClick: onClose }]}
      trailing={[{ label: 'Save', primary: true, onClick: () => { void save().then(onClose) } }]}
    >
      <FormSection>
        <p className="stream-form-row t-meta muted">A defense's inputs are its game's: edit the spread, total and the opponent's QB situation in Game context.</p>
      </FormSection>
      <FormSection header="Notes"><NotesField value={notes} onChange={setNotes} /></FormSection>
    </Sheet>
  )
}
