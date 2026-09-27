// node --test src/utils/oddsHelpers.test.js — against the real 2026 schedule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { oddsForWeek, impliedTotalForTeam, withLiveLines } from './oddsHelpers.js'
import { weekView } from '../services/scheduleService.js'

const schedule = JSON.parse(readFileSync(new URL('../../public/data/schedule-2026.json', import.meta.url)))
const week1 = schedule.byWeek['1']

// An Odds API game: home spread `homeSpread` (negative = home favored).
function oddsGame(away, home, commence, homeSpread, total) {
  return {
    id: `${away}@${home}`,
    home_team: home,
    away_team: away,
    commence_time: commence,
    bookmakers: [{
      markets: [
        { key: 'spreads', outcomes: [{ name: home, point: homeSpread }, { name: away, point: -homeSpread }] },
        { key: 'totals', outcomes: [{ name: 'Over', point: total }, { name: 'Under', point: total }] },
      ],
    }],
  }
}

// Week 1 Sunday afternoon, 2026: the early games have kicked off and dropped
// out of the feed, and week 2 is already listed.
const feed = [
  oddsGame('Denver Broncos', 'Kansas City Chiefs', '2026-09-15T00:15:00Z', -2.5, 43.5), // wk 1 MNF
  oddsGame('Pittsburgh Steelers', 'New England Patriots', '2026-09-20T17:00:00Z', -4.5, 43.5), // wk 2
  oddsGame('Seattle Seahawks', 'Arizona Cardinals', '2026-09-20T20:25:00Z', 10, 44.5), // wk 2
  oddsGame('New York Giants', 'Los Angeles Rams', '2026-09-22T00:15:00Z', -9.5, 48.5), // wk 2
]

test('keeps week 1 games and drops next week’s', () => {
  const kept = oddsForWeek(feed, week1)
  assert.deepEqual(kept.map((g) => g.id), ['Denver Broncos@Kansas City Chiefs'])
})

test('a team whose week 1 game already kicked off gets no live line, not its week 2 one', () => {
  // The bug: SEA's week 1 game had left the feed, so SEA resolved to @ARI.
  assert.equal(impliedTotalForTeam(feed, 'SEA')?.opponent, 'ARI')
  assert.equal(impliedTotalForTeam(oddsForWeek(feed, week1), 'SEA'), null)
})

test('the Rams match in either team-code dialect', () => {
  const ramsWeek1 = [oddsGame('San Francisco 49ers', 'Los Angeles Rams', '2026-09-11T00:35:00Z', -3.5, 48.5)]
  const kept = oddsForWeek(ramsWeek1, week1)
  assert.equal(kept.length, 1)
  assert.equal(impliedTotalForTeam(kept, 'LAR')?.opponent, 'SF')
  assert.equal(impliedTotalForTeam(kept, 'LA')?.opponent, 'SF')
})

test('a neutral-site game listed the other way round still matches', () => {
  const flipped = [oddsGame('Los Angeles Rams', 'San Francisco 49ers', '2026-09-11T00:35:00Z', 3.5, 48.5)]
  assert.equal(oddsForWeek(flipped, week1).length, 1)
})

test('the same two teams weeks apart are not the same game', () => {
  // A division rematch has the right pairing and the wrong date.
  const rematch = [oddsGame('Denver Broncos', 'Kansas City Chiefs', '2026-12-20T18:00:00Z', -6, 45)]
  assert.equal(oddsForWeek(rematch, week1).length, 0)
})

test('no schedule loaded means no unchecked lines', () => {
  assert.deepEqual(oddsForWeek(feed, []), [])
})

test('a team’s spread, total and implied total come from the same game', () => {
  const kc = impliedTotalForTeam(oddsForWeek(feed, week1), 'KC')
  assert.equal(kc.opponent, 'DEN')
  assert.equal(kc.spread, -2.5)
  assert.equal(kc.total, 43.5)
  assert.equal(kc.implied, 23)
  assert.equal(impliedTotalForTeam(oddsForWeek(feed, week1), 'DEN').spread, 2.5)
})

test('live lines replace recorded ones per team; the rest stay recorded', () => {
  const { byTeam } = weekView(schedule, 1)
  const live = [oddsGame('Denver Broncos', 'Kansas City Chiefs', '2026-09-15T00:15:00Z', -4, 41)]
  const merged = withLiveLines(byTeam, oddsForWeek(live, week1))
  assert.equal(merged.KC.opponent, 'DEN')
  assert.equal(merged.KC.spreadLine, -4)
  assert.equal(merged.KC.totalLine, 41)
  assert.equal(merged.KC.impliedTotal, 22.5)
  assert.equal(merged.KC.lineSource, 'live')
  assert.equal(merged.DEN.spreadLine, 4)
  assert.equal(merged.SEA.opponent, 'NE')
  assert.equal(merged.SEA.lineSource, 'schedule')
  assert.equal(merged.SEA.spreadLine, byTeam.SEA.spreadLine)
})

test('every week 1 recorded line sits on the scheduled matchup, both sides', () => {
  const { byTeam } = weekView(schedule, 1)
  for (const g of week1) {
    assert.equal(byTeam[g.home].opponent, g.away)
    assert.equal(byTeam[g.away].opponent, g.home)
    assert.equal(byTeam[g.home].totalLine, byTeam[g.away].totalLine)
    assert.equal(byTeam[g.home].spreadLine, -byTeam[g.away].spreadLine)
    assert.equal(byTeam[g.home].impliedTotal + byTeam[g.away].impliedTotal, g.totalLine)
  }
})
