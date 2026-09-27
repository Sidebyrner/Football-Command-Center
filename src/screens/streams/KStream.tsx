/**
 * K Stream — kickers ranked on this week and the rest of the season. Port of
 * `KStreamView`, `KTeamEditorView` and `KPlayerOverrideView`.
 */
import { useState } from 'react'
import { PRACTICE_STATUS_LABEL, STREAM_PRACTICE, type StreamPractice } from '@core/Stream'
import { K_BUCKET_LABEL, K_BUCKETS, K_VENUE_LABEL, K_VENUES, kMake, kMiss, type KVenue } from '@core/streams/KStream'
import { kOpponentLabel, kTeamImplied, isKPlayerOverrideEmpty, type KPlayerOverride, type KStreamTypes, type KTeamContext, type KTeamOverride } from '@models/streams/KStreamKind'
import { stripUndefined } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp } from '@ui/app/AppContext'
import { metric, num, pointsRows, rosCompareSection, rosPills, StreamFormat, text, weekLabel } from './format'
import { DestructiveRow, FormSection, NotesField, Picker, Sheet, Stepper } from './parts'
import type { StreamEditorProps, StreamPlayerEditorProps, StreamScreenSpec } from './spec'
import { StreamContextListView, TeamRow } from './StreamContextListView'
import { StreamScreenView } from './StreamScreenView'

type Model = StreamScreenModel<KStreamTypes>
const F = StreamFormat

export const kSpec: StreamScreenSpec<KStreamTypes> = {
  title: 'K Stream',
  screen: 'kStream',
  filterPositions: [],
  scoringSummary: (s) => {
    const parts = K_BUCKETS.map((b) => `${K_BUCKET_LABEL[b]} ${num(kMake(s, b))}`)
    parts.push(`XP ${num(s.extraPoint)}`)
    const misses = new Set(K_BUCKETS.map((b) => kMiss(s, b)))
    const miss = [...misses][0]
    if (misses.size === 1 && miss !== undefined) parts.push(`miss ${num(miss)}`)
    else parts.push('misses by distance')
    return parts.join(' · ')
  },
  usage: (p) => `${K_VENUE_LABEL[p.venue]} · implied ${F.one(p.implied)}`,
  rowPills: (p) => [
    { label: 'FG attempts', value: F.two(p.eFga) },
    { label: 'FG made', value: F.two(p.eFgm) },
    { label: '50+ attempts', value: F.two(p.e50pAtt) },
    { label: 'extra points', value: F.two(p.eXpm) },
    { label: 'implied', value: F.one(p.implied) },
    ...rosPills(p.ros),
  ],
  starterPills: (p) => [
    { label: 'FG attempts', value: F.two(p.eFga) },
    { label: 'rest of season /g', value: F.one(p.ros.perGame) },
  ],
  teamSpread: (t) => t.spreadOff,
  compare: {
    sections: (_model, players) => [
      {
        title: 'Expected kicks',
        rows: [
          metric('FG attempts', players.map((p) => p.eFga), F.two),
          metric('FG made', players.map((p) => p.eFgm), F.two),
          metric('FG missed', players.map((p) => p.eMiss), F.two),
          metric('50+ yard attempts', players.map((p) => p.e50pAtt), F.two),
          metric('Extra points', players.map((p) => p.eXpm), F.two),
          metric('Implied team total', players.map((p) => p.implied)),
        ],
      },
      { title: 'Points by kick, if he plays', rows: pointsRows(players.map((p) => p.breakdown)) },
      {
        title: 'Conditions',
        rows: [
          text('Venue', players.map((p) => K_VENUE_LABEL[p.venue])),
          metric('Wind over 12 mph', players.map((p) => p.windOver), F.whole),
          metric('Stall ×', players.map((p) => p.stall), F.two),
          metric('Matchup ×', players.map((p) => p.dvpMult), F.three),
        ],
      },
      rosCompareSection(players),
    ],
    cardPills: (p) => [
      { label: 'FGA', value: F.two(p.eFga) },
      { label: 'ROS /g', value: F.one(p.ros.perGame) },
    ],
    breakdown: (_model, p) => p.breakdown,
    recentGames: (model, id) => model.recentGames(id).map((g) => {
      const parts = [weekLabel(g)]
      parts.push(`${F.whole(g.made)}/${F.whole(g.attempts)} FG`)
      if (g.longest !== undefined && g.longest > 0) parts.push(`long ${F.whole(g.longest)}`)
      parts.push(`${F.whole(g.extraPoints)} XP`)
      return { title: `${F.one(g.points)} pts`, detail: parts.join(' · ') }
    }),
  },
  ContextEditor: KContextEditor,
  PlayerEditor: KPlayerOverrideView,
}

export function KStreamScreen() {
  const { services } = useApp()
  return <StreamScreenView model={services.kStream} spec={kSpec} />
}

function KContextEditor({ model, onClose }: StreamEditorProps<KStreamTypes>) {
  return (
    <StreamContextListView
      model={model}
      onClose={onClose}
      footer="No weather feed yet: enter wind and rain for outdoor games. Wind over 12 mph cuts long attempts and make rates; a dome and Denver's altitude help."
      row={(team) => (
        <TeamRow
          team={team.team}
          opponent={kOpponentLabel(team)}
          trailing={`implied ${F.one(kTeamImplied(team))}`}
          details={<>
            <span>{K_VENUE_LABEL[team.venue]}</span>
            {team.venue !== 'dome' && <span>wind {F.whole(team.windMph)} mph · rain {F.whole(team.precipPct)}%</span>}
            {team.altitude && <span>altitude</span>}
          </>}
          sources={[team.linesSource, team.dvpSource, team.weatherSource]}
        />
      )}
      editor={(team, close) => <KTeamEditorView model={model} team={team} onClose={close} />}
    />
  )
}

function KTeamEditorView({ model, team, onClose }: { model: Model; team: KTeamContext; onClose: () => void }) {
  const [spread, setSpread] = useState(team.spreadOff)
  const [total, setTotal] = useState(team.total)
  const [venue, setVenue] = useState<KVenue>(team.venue)
  const [wind, setWind] = useState(team.windMph)
  const [rain, setRain] = useState(team.precipPct)
  const [dvp, setDvp] = useState(team.dvpPct ?? 0)
  const [dvpGames, setDvpGames] = useState(Math.max(team.dvpGames, 1))
  const auto = model.autoTeams[team.team]

  const save = async () => {
    const change: KTeamOverride = { source: 'manual' }
    if (spread !== auto?.spreadOff) change.spreadOff = spread
    if (total !== auto?.total) change.total = total
    if (venue !== auto?.venue) change.venue = venue
    if (wind !== (auto?.windMph ?? 0)) change.windMph = wind
    if (rain !== (auto?.precipPct ?? 0)) change.precipPct = rain
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
      <FormSection header={`${team.team} ${kOpponentLabel(team)}`} footer={`Implied ${F.one((total - spread) / 2)} — attempts follow the implied total.`}>
        <Stepper label={`Spread ${F.signed(spread)}`} value={spread} onChange={setSpread} min={-25} max={25} step={0.5} />
        <Stepper label={`Total ${F.one(total)}`} value={total} onChange={setTotal} min={30} max={65} step={0.5} />
      </FormSection>
      <FormSection
        header="Conditions"
        footer="From the forecast. Wind over 12 mph moves 50+ attempts to shorter kicks and cuts long make rates; rain trims every make rate."
      >
        <Picker label="Venue" value={venue} options={K_VENUES} optionLabel={(v) => K_VENUE_LABEL[v]} onChange={setVenue} />
        <Stepper label={`Wind ${F.whole(wind)} mph`} value={wind} onChange={setWind} min={0} max={40} step={1} disabled={venue === 'dome'} />
        <Stepper label={`Rain ${F.whole(rain)}%`} value={rain} onChange={setRain} min={0} max={100} step={10} disabled={venue === 'dome'} />
      </FormSection>
      <FormSection header={`What ${team.opponent} allows to kickers vs average`}>
        <Stepper label={`K points ${F.signed(dvp, 0)}%`} value={dvp} onChange={setDvp} min={-60} max={100} step={5} />
        <Stepper label={`Based on ${dvpGames} games`} value={dvpGames} onChange={setDvpGames} min={1} max={17} />
      </FormSection>
      <FormSection>
        <DestructiveRow label="Reset to auto" onClick={() => { void model.setTeamOverride(undefined, team.team).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}

function KPlayerOverrideView({ model, row, onClose }: StreamPlayerEditorProps<KStreamTypes>) {
  const [practice, setPractice] = useState<StreamPractice>(row.practice)
  const [notes, setNotes] = useState(row.notes)

  const save = async () => {
    const change: KPlayerOverride = stripUndefined({
      practice: practice !== row.practice ? practice : undefined,
      notes: notes.length === 0 ? undefined : notes,
    })
    await model.setPlayerOverride(isKPlayerOverrideEmpty(change) ? undefined : change, row.id)
  }

  return (
    <Sheet
      title={row.name}
      onClose={onClose}
      leading={[{ label: 'Cancel', onClick: onClose }]}
      trailing={[{ label: 'Save', primary: true, onClick: () => { void save().then(onClose) } }]}
    >
      <FormSection>
        <Picker label="Status" value={practice} options={STREAM_PRACTICE} optionLabel={(p) => PRACTICE_STATUS_LABEL[p]} onChange={setPractice} />
      </FormSection>
      <FormSection header="Notes"><NotesField value={notes} onChange={setNotes} /></FormSection>
      <FormSection>
        <DestructiveRow label="Clear edits" onClick={() => { void model.setPlayerOverride(undefined, row.id).then(onClose) }} />
      </FormSection>
    </Sheet>
  )
}
