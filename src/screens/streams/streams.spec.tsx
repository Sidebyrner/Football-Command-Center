import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import { playersAt } from '@data/playerIndex'
import type { AppServices } from '@models/app/AppServices'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { demoServices, renderScreen } from '../../../tests/renderScreen'
import { DSTStreamScreen, IDPStreamScreen, KStreamScreen, QBStreamScreen, RBStreamScreen, WRStreamScreen } from './index'
import { qbSpec } from './QBStream'
import { rbSpec } from './RBStream'
import { StreamCompareView } from './StreamCompareView'
import { StreamPlayerPickerView } from './StreamPlayerPickerView'
import { StreamSnapshotsView } from './StreamSnapshotsView'

/** The rendered HTML as text: tags dropped, entities decoded. */
const textOf = (html: string) => html
  .replace(/<!-- -->/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')

const render = async (C: ComponentType, path: string) => textOf(await renderScreen(C, path))

interface Case {
  name: string
  Screen: ComponentType
  path: string
  model: (s: AppServices) => StreamScreenModel<StreamKindTypes>
  overline: string
  noun: string
  horizon: boolean
  incumbent: string
}

const cases: Case[] = [
  { name: 'QB', Screen: QBStreamScreen, path: '/streams/qb', model: (s) => s.qbStream as never, overline: 'Streams · QB · Week 7', noun: 'quarterback', horizon: true, incumbent: 'Josh Allen' },
  { name: 'RB', Screen: RBStreamScreen, path: '/streams/rb', model: (s) => s.rbStream as never, overline: 'Streams · RB · Week 7', noun: 'running back', horizon: false, incumbent: 'Saquon Barkley' },
  { name: 'WR', Screen: WRStreamScreen, path: '/streams/wr', model: (s) => s.wrStream as never, overline: 'Streams · WR · Week 7', noun: 'receiver', horizon: false, incumbent: 'Puka Nacua' },
  { name: 'K', Screen: KStreamScreen, path: '/streams/k', model: (s) => s.kStream as never, overline: 'Streams · K · Week 7', noun: 'kicker', horizon: true, incumbent: 'Chris Boswell' },
  { name: 'D/ST', Screen: DSTStreamScreen, path: '/streams/dst', model: (s) => s.dstStream as never, overline: 'Streams · D/ST · Week 7', noun: 'defense', horizon: true, incumbent: 'PHI D/ST' },
  { name: 'IDP', Screen: IDPStreamScreen, path: '/streams/idp', model: (s) => s.idpStream as never, overline: 'Streams · IDP · Week 7', noun: 'defender', horizon: false, incumbent: "D'Anthony Smith" },
]

/** Puts a model back the way the app loads it, so tests don't leak into each other. */
async function reset(model: StreamScreenModel<StreamKindTypes>) {
  model.risk = 'neutral'
  model.horizon = 'balanced'
  model.onlyAvailable = true
  model.positionFilter = undefined
  model.query = ''
  if (model.compareIDs.length > 0) model.clearCompare()
  if (!model.incumbentIsDefault) await model.setIncumbent(undefined)
}

describe.each(cases)('$name Stream screen', (c) => {
  afterEach(async () => { await reset(c.model(await demoServices())) })

  it('renders the hero, the starter to beat and the controls', async () => {
    const model = c.model(await demoServices())
    expect(model.context).toBeDefined()
    const text = await render(c.Screen, c.path)
    expect(text).toContain(c.overline)
    expect(text).toContain('Starter to beat')
    expect(text).toContain(c.incumbent)
    expect(text).toContain('weakest starter')
    expect(text).toContain('Tune')
    expect(text).toContain('Floor Neutral Ceiling')
    expect(text).toContain('Ranks on expected points.')
    expect(text).toContain('Free agents only')
    expect(text).toContain('Streamers')
    expect(text).toContain('Game context')
    expect(text).toContain('Projected in your scoring:')
    expect(text).toContain(`every ${c.noun} is projected from priors alone`)
    if (c.horizon) {
      expect(text).toContain('This week Balanced Rest of season')
      expect(text).toContain("A waiver claim you'll hold a few weeks")
    } else {
      expect(text).not.toContain('This week Balanced Rest of season')
    }
  })

  it('lists ranked candidates once rostered players are included', async () => {
    const model = c.model(await demoServices())
    model.onlyAvailable = false
    if (model.rows.length === 0) {
      // The demo has no weekly stat lines, so a stream may have only the
      // user's own player; anyone searched for is projected on the spot.
      const pool = model.kind.positions.flatMap((p) => playersAt(model.context!.players, p))
      const other = pool.find((p) => p.team !== undefined && p.id !== model.report?.incumbent?.playerID)
      expect(other).toBeDefined()
      expect(model.searchPlayers(other!.name).map((r) => r.id)).toContain(other!.id)
      model.toggleCompare(other!.id)
    }
    const best = model.rows[0]
    expect(best).toBeDefined()
    const text = await render(c.Screen, c.path)
    expect(text).toContain(best!.name)
    expect(text).toContain('est pts')
    expect(text).toMatch(/(Compare|In compare) Stats/)
  })

  it('re-ranks when the risk setting changes', async () => {
    const model = c.model(await demoServices())
    model.risk = 'ceiling'
    const text = await render(c.Screen, c.path)
    expect(text).toContain("Favours upside — for when you're the underdog.")
    model.risk = 'floor'
    expect(await render(c.Screen, c.path)).toContain("Favours a safe floor — for when you're favoured to win.")
    if (c.horizon) {
      model.horizon = 'week'
      expect(await render(c.Screen, c.path)).toContain("Sunday's lineup call — this week only.")
    }
  })
})

describe('shared stream pieces', () => {
  afterEach(async () => {
    const s = await demoServices()
    for (const c of cases) await reset(c.model(s))
  })

  it('shows the compare tray and a head-to-head once two players are compared', async () => {
    const services = await demoServices()
    const model = services.qbStream
    model.onlyAvailable = false
    const a = model.report!.incumbent!
    const b = model.rows[0]!
    model.toggleCompare(a.playerID!)
    model.toggleCompare(b.playerID!)
    expect(model.comparison?.verdict).toBeDefined()

    const screen = await render(QBStreamScreen, '/streams/qb')
    expect(screen).toContain('2 of 4 to compare')
    expect(screen).toContain('Compare side by side')
    expect(screen).toContain('In compare')

    const Compare = () => <StreamCompareView model={model} spec={qbSpec.compare} teamSpread={qbSpec.teamSpread} onClose={() => {}} />
    const text = await render(Compare, '/streams/qb')
    expect(text).toContain('Compare quarterbacks')
    expect(text).toMatch(/Start |Lean |Toss-up — /)
    expect(text).toContain('Range this week')
    expect(text).toContain('Expected stat line')
    expect(text).toContain('Points by stat, if he plays')
    expect(text).toContain('Rest of season')
    expect(text).toContain('Head to head')
    expect(text).toContain('Chance the row player outscores the column player this week.')
    expect(text).toContain('at the neutral risk setting')
  })

  it('says there is nobody to compare, and lists pickable players', async () => {
    const model = (await demoServices()).rbStream
    const Compare = () => <StreamCompareView model={model} spec={rbSpec.compare} teamSpread={rbSpec.teamSpread} onClose={() => {}} />
    expect(await render(Compare, '/streams/rb')).toContain('Add running backs from the list, or search for anyone.')

    const Picker = () => <StreamPlayerPickerView model={model} mode="incumbent" onClose={() => {}} />
    const picker = await render(Picker, '/streams/rb')
    expect(picker).toContain('Top projected running backs')
    expect(picker).toContain(model.searchPlayers('')[0]!.name)
  })

  it('renders the game-context editor and snapshots', async () => {
    const model = (await demoServices()).rbStream
    const Context = () => <rbSpec.ContextEditor model={model} onClose={() => {}} />
    const context = await render(Context, '/streams/rb')
    expect(context).toContain('Import context JSON…')
    expect(context).toContain('Teams playing')
    expect(context).toContain('fewer carries and a lower implied total')

    const Snapshots = () => <StreamSnapshotsView model={model} onClose={() => {}} />
    const snapshots = await render(Snapshots, '/streams/rb')
    expect(snapshots).toContain('Snapshots')
    expect(model.snapshots.length > 0 ? snapshots.includes('Week 7') : snapshots.includes('No snapshots yet.')).toBe(true)
  })

  it('opens a player editor with the Swift wording', async () => {
    const model = (await demoServices()).rbStream
    const row = model.report!.incumbent!
    const Editor = () => <rbSpec.PlayerEditor model={model} row={row} onClose={() => {}} />
    const text = await render(Editor, '/streams/rb')
    expect(text).toContain(row.name)
    expect(text).toContain('Role sets the carry-share, target-share and per-carry priors')
    expect(text).toContain('Clear edits')
  })
})
