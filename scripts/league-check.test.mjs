// node --test scripts/league-check.test.mjs
//
// A league shaped like the real ones Sleeper returns — IDP slots, an IR spot, a
// co-owner, an open team, a roster with a bad starters array — run through the
// real 2026 schedule, the 2025 weekly file and the shipped id crosswalk, at
// 2pm ET on week 1 Sunday (the 1pm games have kicked off).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkJoins, checkLeague } from './lib/leagueCheck.mjs'

const data = (file) => JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url)))
const scheduleFile = data('schedule-2026.json')
const weeklyManifest = data('weekly/index.json')
const weeklyFile = data('weekly/2025.json')
const idsBySleeper = data('player-ids.json').players

const playersById = {
  96: { name: 'Aaron Rodgers', position: 'QB', team: 'PIT', active: true },
  3198: { name: 'Derrick Henry', position: 'RB', team: 'BAL', active: true },
  4034: { name: 'Christian McCaffrey', position: 'RB', team: 'SF', active: true, injuryStatus: 'Questionable' },
  2133: { name: 'Davante Adams', position: 'WR', team: 'LAR', active: true },
  1479: { name: 'Keenan Allen', position: 'WR', team: 'IND', active: true },
  2449: { name: 'Stefon Diggs', position: 'WR', team: 'WAS', active: true },
  1466: { name: 'Travis Kelce', position: 'TE', team: 'KC', active: true, injuryStatus: 'Sus' },
  650: { name: 'Nick Folk', position: 'K', team: 'ATL', active: true },
  SEA: { name: 'Seattle Seahawks', position: 'DEF', team: 'SEA', active: true },
  125: { name: 'Calais Campbell', position: 'DE', team: 'BAL', active: true },
  871: { name: 'Von Miller', position: 'LB', fantasyPositions: ['DL', 'LB'], team: 'DAL', active: true },
  9001: { name: 'Test Corner', position: 'CB', team: 'SEA', active: true },
  19: { name: 'Joe Flacco', position: 'QB', team: 'CIN', active: true },
}

const league = {
  league_id: 'L1', name: 'Real Shape League', season: '2026', status: 'in_season',
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN', 'BN', 'BN', 'IR'],
  scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5 },
}
const myStarters = ['96', '3198', '4034', '2133', '1479', '1466', '2449', '650', 'SEA', '125', '871', '9001', '0']
const rosters = [
  { roster_id: 1, owner_id: 'owner', co_owners: ['me'], players: [...myStarters.filter((id) => id !== '0'), '19'], starters: myStarters, reserve: ['19'], settings: { wins: 0, losses: 0 } },
  { roster_id: 2, owner_id: 'rival', players: ['2449'], starters: ['2449', '0'], settings: {} },
  { roster_id: 3, owner_id: null, players: [], starters: [], settings: {} },
]
const users = [
  { user_id: 'owner', display_name: 'owner', metadata: { team_name: 'Shared Squad' } },
  { user_id: 'me', display_name: 'me' },
  { user_id: 'rival', display_name: 'rival' },
]
const matchups = [
  { roster_id: 1, matchup_id: 1, starters: myStarters },
  { roster_id: 2, matchup_id: 1, starters: ['2449', '0'] },
  { roster_id: 3, matchup_id: 2, starters: [] },
]

const report = checkLeague({
  league, rosters, users, matchups, state: { week: 1, season: '2026' }, userId: 'me',
  playersById, scheduleFile, weeklyManifest, weeklyFile, idsBySleeper,
  now: new Date('2026-09-13T18:00:00Z'),
})
const has = (level, area, text) => report.findings.some((f) => f.level === level && f.area === area && f.message.includes(text))

test('a co-owner finds their team, under its team name', () => {
  assert.equal(report.mine?.name, 'Shared Squad')
  assert.equal(report.mine.coOwner, true)
  assert.equal(report.mine.opponent, 'rival')
  assert.ok(has('info', 'you', 'co-own'))
})

test('a starters array that does not match the slots is an error', () => {
  assert.ok(has('error', 'lineup', 'rival: 2 starters for 13 slots'))
})

test('an open team is reported, not dropped', () => {
  assert.equal(report.league.teams, 3)
  assert.ok(has('info', 'league', 'Team 3'))
})

test('a CB, a DE and a DL/LB hybrid all fit IDP slots', () => {
  assert.ok(!report.findings.some((f) => f.message.includes('fit no starting slot')))
  assert.ok(!report.findings.some((f) => f.level === 'error' && f.area !== 'lineup'), JSON.stringify(report.findings))
})

test('week 1 at 2pm ET: 1pm and earlier games are locked, and the rest still alert', () => {
  const notes = Object.fromEntries(report.mine.lineup.filter((s) => s.id).map((s) => [s.name, s.note]))
  assert.equal(notes['Derrick Henry'], 'locked', 'BAL@IND 1pm')
  assert.equal(notes['Christian McCaffrey'], 'locked', 'SF@LA was Thursday — his tag no longer matters')
  assert.equal(notes['Travis Kelce'], 'Sus', 'KC plays Monday')
  assert.equal(notes['Stefon Diggs'], null, 'WAS@PHI 4:25 is still open')
  assert.deepEqual(report.mine.alerts.injured, ['Travis Kelce (Sus)'])
  assert.equal(report.mine.alerts.emptySlots, 1)
  assert.ok(report.mine.alerts.readiness.settled >= 7)
  assert.ok(report.mine.gameDay)
})

test('production comes from 2025 in league scoring, and DEF/IDP stay unranked', () => {
  assert.equal(report.mine.statsSeason, 2025)
  assert.match(report.mine.statsNote, /2025/)
  const rodgers = report.mine.lineup.find((s) => s.name === 'Aaron Rodgers')
  assert.ok(rodgers.perGame > 5, 'Rodgers joins the weekly file through the crosswalk')
  assert.equal(report.mine.lineup.find((s) => s.name === 'Calais Campbell').perGame, null)
  assert.ok(has('info', 'stats', 'DEF/IDP'))
})

test('an IR player is left out of lineup and bye math', () => {
  assert.ok(has('info', 'lineup', '1 IR'))
  assert.ok(!report.mine.optimizer.swaps.some((s) => s.in === 'Joe Flacco'))
})

test('scoring rules the app does not model are named', () => {
  assert.ok(has('info', 'scoring', 'bonus_rec_te'))
})

test('the joins check catches a team code the schedule has never heard of', () => {
  const clean = checkJoins({ playersById, scheduleFile })
  assert.deepEqual(clean.findings, [], 'LAR joins as LA')
  const broken = checkJoins({ playersById: { ...playersById, x: { team: 'XYZ', active: true } }, scheduleFile })
  assert.equal(broken.findings.length, 1)
  assert.match(broken.findings[0].message, /XYZ/)
})
