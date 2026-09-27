import { afterEach, describe, expect, it } from 'vitest'
import type { AppServices } from '@models/app/AppServices'
import { demoServices } from '../../../../tests/renderScreen'
import {
  DSTStreamPanel, IDPStreamPanel, KStreamPanel, PlayerCardPanel, QBStreamPanel, RBStreamPanel,
  TradePartnersPanel, WaiverTargetsPanel, WRStreamPanel,
} from './MarketPanels'
import { renderPanel } from './teamPanelsSpecKit'

/** Clears whatever a test published to the link bus. */
function clearLinks(services: AppServices) {
  services.linkBus.selections = new Map()
}

afterEach(async () => { clearLinks(await demoServices()) })

describe('Market panels on the demo league', () => {
  it('Waiver targets: the board’s top rows, in its sort', async () => {
    const services = await demoServices()
    const text = renderPanel(services, WaiverTargetsPanel)
    expect(text).toContain('Patrick Mahomes QB · KC · LV 37.7 pts/gm')
    expect(text).toContain('Josh Jacobs RB · GB · ARI 17.5 pts/gm')
    expect(text).toContain('Ranked by stats season pts/gm.')
  })

  it('Waiver targets: the panel’s own position filter', async () => {
    const services = await demoServices()
    const text = renderPanel(services, WaiverTargetsPanel, { settings: { positionFilter: 'RB' } })
    expect(text).not.toContain('Patrick Mahomes')
    expect(text).toContain('Javonte Williams RB · DAL · WAS')
    expect(text).toContain('Ranked by stats season pts/gm · RB only.')
    // A filter nobody matches.
    const none = renderPanel(services, WaiverTargetsPanel, { settings: { positionFilter: 'DEF' } })
    if (!services.waivers.rows.some((r) => r.position === 'DEF')) expect(none).toContain('Nobody matches on the Waiver Board right now.')
  })

  it('D/ST stream: the starter to beat, then ranked streamers with their range', async () => {
    const text = renderPanel(await demoServices(), DSTStreamPanel)
    expect(text).toContain('To beat PHI D/ST 7.1')
    expect(text).toContain('SEA D/ST D/ST · SEA vs HOU 7.4 +0.2')
    expect(text).toContain('4.3 floor 10.5 ceiling')
    expect(text).toContain("Using the D/ST Stream screen's filters and risk mode.")
  })

  it('the other streams say when nobody is on waivers to stream', async () => {
    const services = await demoServices()
    const cases = [
      [QBStreamPanel, services.qbStream, 'quarterback'], [RBStreamPanel, services.rbStream, 'running back'],
      [WRStreamPanel, services.wrStream, 'receiver'], [KStreamPanel, services.kStream, 'kicker'],
      [IDPStreamPanel, services.idpStream, 'defender'],
    ] as const
    for (const [Panel, model, noun] of cases) {
      const text = renderPanel(services, Panel)
      if (model.rows.length === 0) expect(text).toContain(`No ${noun}s to stream yet this week.`)
      else expect(text).toContain(model.rows[0]!.name)
    }
  })

  it('Trade partners: your needs, then teams with a spare that fits', async () => {
    const services = await demoServices()
    const text = renderPanel(services, TradePartnersPanel)
    expect(text).toContain('WR depth for week 8')
    expect(text).toContain('Upgrade RB')
    expect(text).toContain('Waiver Wire Warriors B Open deal A.J. Brown PHI 12.6')
    expect(text).not.toContain('Offer ')
  })

  it('Trade partners: linked, it offers the clicked player', async () => {
    const services = await demoServices()
    const allen = services.dashboard.context!.userTeam!.starterIDs.find((id) => services.dashboard.context!.playerName(id) === 'Josh Allen')!
    services.linkBus.publish({ kind: 'player', playerID: allen }, 1)
    const text = renderPanel(services, TradePartnersPanel, { linkGroup: 1 })
    expect(text).toContain('Offer Josh Allen Yours')
    // Another colour doesn't follow it.
    expect(renderPanel(services, TradePartnersPanel, { linkGroup: 2 })).not.toContain('Offer Josh Allen')
  })

  it('Player card: asks for a colour, waits for a click, then follows it', async () => {
    const services = await demoServices()
    expect(renderPanel(services, PlayerCardPanel)).toContain('Pick a link colour on this panel, then click a player in a panel of the same colour.')
    const waiting = renderPanel(services, PlayerCardPanel, { linkGroup: 1 })
    expect(waiting).toContain('Click a player in any blue panel')
    expect(waiting).toContain('This card follows your clicks.')
    const allen = services.dashboard.context!.userTeam!.starterIDs.find((id) => services.dashboard.context!.playerName(id) === 'Josh Allen')!
    services.linkBus.publish({ kind: 'player', playerID: allen }, 1)
    const card = renderPanel(services, PlayerCardPanel, { linkGroup: 1 })
    expect(card).toContain('Josh Allen')
    expect(card).toContain('Overview')
    expect(card).toContain('Projections')
  })
})
