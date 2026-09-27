// node --test src/utils/leagueTeams.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinLeagueTeams, isMyTeam, findMyTeam } from './leagueTeams.js'
import { slotPositions, fitsSlot, distinctFantasyPositions } from './slotEligibility.js'

const users = [
  { user_id: 'u1', display_name: 'connor', metadata: { team_name: 'Fourth and Long' } },
  { user_id: 'u2', display_name: 'sam', metadata: {} },
  { user_id: 'u3', display_name: 'alex' },
]
const rosters = [
  { roster_id: 1, owner_id: 'u1', co_owners: null, players: ['a', 'b', 'c', 'd'], starters: ['a'], reserve: ['c'], taxi: ['d'], settings: { wins: 1, fpts: 120, fpts_decimal: 55 } },
  { roster_id: 2, owner_id: 'u2', co_owners: ['u3'], players: ['e'], starters: ['e'], reserve: null, taxi: null, settings: {} },
  { roster_id: 3, owner_id: null, players: [], starters: [], settings: {} },
]
const teams = joinLeagueTeams(rosters, users)

test("a manager's team name wins over their display name", () => {
  assert.equal(teams[0].name, 'Fourth and Long')
  assert.equal(teams[0].ownerName, 'connor')
  assert.equal(teams[1].name, 'sam')
})

test('an open team is kept, named, and matches nobody', () => {
  assert.equal(teams.length, 3, 'dropping it broke matchups joined by roster_id')
  assert.deepEqual([teams[2].id, teams[2].name, teams[2].isOpen], ['roster-3', 'Team 3', true])
  assert.equal(findMyTeam(teams, 'roster-3')?.isOpen ?? false, true, 'only its synthetic id reaches it')
  assert.equal(teams.filter((t) => isMyTeam(t, 'u9')).length, 0)
})

test('a co-owner finds the team they co-manage', () => {
  assert.equal(findMyTeam(teams, 'u3')?.rosterId, 2)
  assert.equal(isMyTeam(teams[1], 'u2'), true)
  assert.equal(findMyTeam(teams, null), null)
})

test('IR and taxi players are on the roster but not startable', () => {
  assert.deepEqual(teams[0].playerIds, ['a', 'b', 'c', 'd'])
  assert.deepEqual(teams[0].startableIds, ['a', 'b'])
  assert.equal(teams[0].pointsFor, 120.55)
})

test("slot eligibility prefers Sleeper's fantasy_positions and falls back by position", () => {
  assert.deepEqual(slotPositions({ position: 'LB', fantasy_positions: ['DL', 'LB'] }), ['DL', 'LB'])
  assert.deepEqual(slotPositions({ position: 'CB' }), ['DB'])
  assert.deepEqual(slotPositions({ position: 'FB' }), ['RB'])
  assert.deepEqual(slotPositions(undefined), [])
  assert.equal(fitsSlot({ type: 'flex', pos: 'IDP_FLEX', eligible: ['LB', 'DL', 'DB'] }, ['DB']), true)
  assert.equal(fitsSlot({ type: 'starter', pos: 'DL' }, ['DB']), false)
})

test('fantasy_positions is kept only when it adds something', () => {
  assert.equal(distinctFantasyPositions('WR', ['WR']), null)
  assert.equal(distinctFantasyPositions('CB', ['DB']), null)
  assert.deepEqual(distinctFantasyPositions('LB', ['DL', 'LB']), ['DL', 'LB'])
  assert.deepEqual(distinctFantasyPositions('TE', ['QB']), ['QB'])
  assert.equal(distinctFantasyPositions('G', null), null)
})
