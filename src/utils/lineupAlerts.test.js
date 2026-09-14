// node --test src/utils/lineupAlerts.test.js — week 7 of the real 2025 schedule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { buildLineupAlerts } from './lineupAlerts.js'
import { kickoffCalendar } from './gameClock.js'
import { byeWeeksFromSchedule } from './byeWeeks.js'

const schedule = JSON.parse(readFileSync(new URL('../../public/data/schedule-2025.json', import.meta.url)))
const kickoffs = kickoffCalendar(schedule)
const byeTeams = new Set(byeWeeksFromSchedule(schedule).byWeek[7]) // BAL, BUF

const playersById = {
  qb1: { name: 'Starter QB', team: 'BUF', position: 'QB' },          // bye
  rb1: { name: 'Eagles Back', team: 'PHI', position: 'RB' },         // 1pm
  wr1: { name: 'Vikings WR', team: 'MIN', position: 'WR', injuryStatus: 'Questionable' }, // 1pm
  wr2: { name: 'Cowboys WR', team: 'DAL', position: 'WR', injuryStatus: 'Out' },          // 4:25
  lb1: { name: 'Bears LB', team: 'CHI', position: 'LB' },            // 1pm
  dl1: { name: 'Ravens DL', team: 'BAL', position: 'DL' },           // bye — IDP
  te1: { name: 'Rams TE', team: 'LAR', position: 'TE' },             // London 9:30
}
const starters = ['qb1', 'rb1', 'wr1', 'wr2', '0', 'lb1', 'dl1', 'te1']

test('before kickoff: byes (IDP included), the empty slot and both injury tags', () => {
  const r = buildLineupAlerts({ starterIds: starters, playersById, byeTeams, kickoffs, week: 7, now: new Date('2025-10-15T12:00:00Z') })
  assert.deepEqual(r.onBye.map((p) => p.id), ['qb1', 'dl1'])
  assert.equal(r.emptySlots, 1)
  assert.deepEqual(r.injured.map((p) => [p.id, p.severity]), [['wr1', 'caution'], ['wr2', 'sit']])
  assert.equal(r.locked, 0)
  assert.equal(r.nextLock.toISOString(), '2025-10-19T13:30:00.000Z', 'the London game is first among these starters')
})

test('mid-Sunday: alerts about starters who already kicked off disappear', () => {
  const r = buildLineupAlerts({ starterIds: starters, playersById, byeTeams, kickoffs, week: 7, now: new Date('2025-10-19T18:30:00Z') })
  // The questionable MIN receiver's game started — nothing to do about him now.
  assert.deepEqual(r.injured.map((p) => p.id), ['wr2'])
  // Byes never lock, so they stay fixable.
  assert.deepEqual(r.onBye.map((p) => p.id), ['qb1', 'dl1'])
  assert.equal(r.locked, 4, 'PHI, MIN, CHI (1pm) and LAR (London)')
  assert.equal(r.nextLock.toISOString(), '2025-10-19T20:25:00.000Z', 'DAL at 4:25')
})

test('readiness counts every slot exactly once', () => {
  for (const now of [new Date('2025-10-15T12:00:00Z'), new Date('2025-10-19T18:30:00Z')]) {
    const { readiness: r } = buildLineupAlerts({ starterIds: starters, playersById, byeTeams, kickoffs, week: 7, now })
    assert.equal(r.ready + r.caution + r.problems + r.settled, r.slots)
  }
})

test('with no schedule, alerts still work without lock awareness', () => {
  const r = buildLineupAlerts({ starterIds: ['wr2', '0'], playersById, byeTeams: new Set(), kickoffs: null, week: 7 })
  assert.equal(r.emptySlots, 1)
  assert.equal(r.injured.length, 1)
  assert.equal(r.nextLock, null)
})

test('a suspended starter is a problem, not a game-time decision', () => {
  const r = buildLineupAlerts({
    starterIds: ['sus', 'na'],
    playersById: {
      sus: { name: 'Suspended', team: 'PHI', position: 'RB', injuryStatus: 'Sus' },
      na: { name: 'Unavailable', team: 'MIN', position: 'WR', injuryStatus: 'NA' },
    },
    byeTeams, kickoffs, week: 7, now: new Date('2025-10-15T12:00:00Z'),
  })
  assert.deepEqual(r.injured.map((p) => [p.id, p.severity]), [['sus', 'sit'], ['na', 'caution']])
  assert.deepEqual([r.readiness.problems, r.readiness.caution], [1, 1])
})
