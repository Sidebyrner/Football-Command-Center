// node --test src/utils/gameClock.test.js — against the real 2025 schedule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { kickoffDate, kickoffCalendar, isGameDay, playersMaxAge, LIVE_WINDOW_MS,
  GAME_DAY_PLAYERS_MAX_AGE_MS, ORDINARY_PLAYERS_MAX_AGE_MS } from './gameClock.js'

const schedule = JSON.parse(readFileSync(new URL('../../public/data/schedule-2025.json', import.meta.url)))
const cal = kickoffCalendar(schedule)
const at = (iso) => new Date(iso)

test('Thursday night kickoff is Eastern: DAL@PHI 20:20 ET is 00:20 UTC', () => {
  assert.equal(cal.kickoff('PHI', 1).toISOString(), '2025-09-05T00:20:00.000Z')
})

test('a September 1pm ET game is 17:00 UTC (EDT)', () => {
  assert.equal(cal.kickoff('ATL', 1).toISOString(), '2025-09-07T17:00:00.000Z')
})

test('after the clocks change on 2025-11-02, 1pm ET is 18:00 UTC (EST)', () => {
  assert.equal(cal.kickoff('CAR', 10).toISOString(), '2025-11-09T18:00:00.000Z')
})

test('result does not depend on the machine time zone', () => {
  // Same instant regardless of where the code runs.
  assert.equal(kickoffDate({ kickoff: '2025-10-19', time: '13:00' }).getTime(), Date.parse('2025-10-19T17:00:00Z'))
})

test('malformed or missing times are null, not midnight', () => {
  assert.equal(kickoffDate({ kickoff: '2025-09-04', time: 'TBD' }), null)
  assert.equal(kickoffDate({ kickoff: '2025-09-04' }), null)
})

test('Sleeper team codes are normalised (LAR → LA)', () => {
  assert.ok(cal.kickoff('LAR', 7))
  assert.equal(cal.kickoff('LAR', 7).getTime(), cal.kickoff('LA', 7).getTime())
})

test('mid-Sunday week 7: early games locked, late ones not, byes never', () => {
  const now = at('2025-10-19T18:30:00Z') // 2:30pm ET
  assert.ok(cal.isLocked('JAX', 7, now), 'London 9:30')
  assert.ok(cal.isLocked('CHI', 7, now), '1pm')
  assert.ok(cal.isLocked('CIN', 7, now), 'Thursday')
  assert.ok(!cal.isLocked('DAL', 7, now), '4:25')
  assert.ok(!cal.isLocked('BUF', 7, at('2025-10-21T00:00:00Z')), 'BUF is on bye')
})

test('the kickoff instant itself is locked', () => {
  const k = cal.kickoff('PHI', 1)
  assert.ok(!cal.isLocked('PHI', 1, new Date(k.getTime() - 1)))
  assert.ok(cal.isLocked('PHI', 1, k))
})

test('live window is kickoff to four hours after', () => {
  const k = cal.kickoff('PHI', 1).getTime()
  assert.ok(!cal.isLive('PHI', 1, new Date(k - 60000)))
  assert.ok(cal.isLive('PHI', 1, new Date(k + 60000)))
  assert.ok(!cal.isLive('PHI', 1, new Date(k + LIVE_WINDOW_MS + 60000)))
})

test('lock windows are distinct and ascending, Thursday first', () => {
  const w = cal.lockWindows(7).map((d) => d.getTime())
  assert.deepEqual(w, [...new Set(w)].sort((a, b) => a - b))
  assert.equal(new Date(w[0]).toISOString(), '2025-10-17T00:15:00.000Z')
})

test('next lock skips games already started', () => {
  const next = cal.nextLock(7, ['CHI', 'GB', null, 'BUF'], at('2025-10-19T18:30:00Z'))
  assert.equal(next.getTime(), cal.kickoff('GB', 7).getTime())
})

test('game-day window: opens 6h before a kickoff, closes 4h after', () => {
  assert.ok(isGameDay(cal, 7, at('2025-10-19T08:00:00Z')), '5.5h before London')
  assert.ok(!isGameDay(cal, 7, at('2025-10-19T07:00:00Z')), '6.5h before London')
  assert.ok(isGameDay(cal, 7, at('2025-10-17T04:00:00Z')), '3h45 after TNF')
  assert.ok(!isGameDay(cal, 7, at('2025-10-17T05:00:00Z')), '4h45 after TNF')
  assert.ok(!isGameDay(cal, 7, at('2025-10-15T16:00:00Z')), 'Wednesday')
})

test('player index max age is 3h on a game day and 24h otherwise', () => {
  assert.equal(playersMaxAge(cal, 7, at('2025-10-19T18:30:00Z')), GAME_DAY_PLAYERS_MAX_AGE_MS)
  assert.equal(playersMaxAge(cal, 7, at('2025-10-15T16:00:00Z')), ORDINARY_PLAYERS_MAX_AGE_MS)
  assert.equal(playersMaxAge(null, 7), ORDINARY_PLAYERS_MAX_AGE_MS)
})
