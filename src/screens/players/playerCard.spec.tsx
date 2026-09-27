import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { StaticAppProvider } from '@ui/app/AppContext'
import type { PlayerCardModel } from '@models/player/PlayerCardModel'
import { demoServices } from '../../../tests/renderScreen'
import { PlayerCardView, type PlayerCardTab } from './PlayerCardView'

async function loadedCard(): Promise<{ model: PlayerCardModel; render: (tab: PlayerCardTab) => string }> {
  const services = await demoServices()
  const context = services.dashboard.context
  if (!context) throw new Error('demo league did not load')
  const team = context.userTeam
  if (!team) throw new Error('no user team')
  // A rostered skill player with a game log: the first starter who isn't a kicker or defense.
  const id = team.starterIDs.find((p) => !['K', 'DEF'].includes(context.position(p) ?? '')) ?? team.starterIDs[0]!
  const model = services.playerCard(id, context)
  await model.load()
  // React marks text-node boundaries with <!-- -->; drop them so assertions read as the page does.
  const render = (tab: PlayerCardTab) => renderToString(
    <MemoryRouter initialEntries={['/board']}>
      <StaticAppProvider services={services}>
        <div className="fcc"><PlayerCardView model={model} initialTab={tab} /></div>
      </StaticAppProvider>
    </MemoryRouter>,
  ).replaceAll('<!-- -->', '')
  return { model, render }
}

// renderToString escapes apostrophes; compare against the escaped form.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

describe('Player Card', () => {
  it('renders the overview with header, status, news and schedule', async () => {
    const { model, render } = await loadedCard()
    const html = render('overview')
    expect(html).toContain(esc(model.name))
    expect(html).toContain('Status')
    expect(html).toContain('News')
    expect(html).toContain('Schedule')
    expect(html).toContain('News could not be loaded.')
    // Status row numbers from the demo league.
    if (model.status?.byeWeek !== undefined) expect(html).toContain(`Week ${model.status.byeWeek}`)
    expect(html).toContain('Offer in trade')
    expect(html).toContain('Yours')
  })

  it('renders the log: the demo league has no weekly stat lines, so it says so', async () => {
    const { model, render } = await loadedCard()
    const html = render('log')
    expect(html).toContain('This season')
    if (model.log.length === 0) expect(html).toContain('No games recorded this season.')
  })

  it('draws the game log chart and rows with a text summary', async () => {
    const { model, render } = await loadedCard()
    const saved = model.log
    model.log = [
      { week: 2, opponent: 'MIN', played: true, points: 18.4, snapShare: 0.71, targets: 5, expectedPoints: 14.2, projected: 15.1 },
      { week: 1, opponent: 'DAL', played: true, points: 9.6, rushAttempts: 14, projected: 13.0 },
    ]
    try {
      const html = render('log')
      expect(html).toContain('Points by week: week 1 9.6 (projected 13.0), week 2 18.4 (projected 15.1).')
      expect(html).toContain('W2')
      expect(html).toContain('vs MIN')
      expect(html).toContain('71%')
      expect(html).toContain('xFP')
    } finally {
      model.log = saved
    }
  })

  it('renders both projections side by side', async () => {
    const { model, render } = await loadedCard()
    const html = render('projections')
    expect(html).toContain('Two separate projections. Neither is blended into the other.')
    expect(html).toContain('Command Center projection')
    expect(html).toContain('How each has done')
    if (model.rotowireThisWeek !== undefined) expect(html).toContain(model.rotowireThisWeek.toFixed(1))
  })

  it('renders the grade, situation and weighted view', async () => {
    const { model, render } = await loadedCard()
    const html = render('grade')
    expect(html).toContain('Cohort grade')
    expect(html).toContain('Situation')
    expect(html).toContain('Weighted view')
    if (model.grade?.score !== undefined) expect(html).toContain(`Grade ${model.grade.score}`)
    model.showWeighted = true
    const weighted = render('grade')
    expect(weighted).toContain('of your weight had a number behind it')
    expect(weighted).toContain('OL pass protection')
    model.showWeighted = false
  })
})
