// node --test src/utils/byeWeeks.test.js
//
// Ported from the iOS app's ByeWeeksTests and ByeCrunchTests. Bye derivation is
// checked against the real shipped schedule, not a mock.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { byeWeeksFromSchedule, crunchForWeek } from './byeWeeks.js'
import { parseRosterPositions } from './rosterSlots.js'
import { toNflverseTeam } from './nflTeams.js'

const schedule2025 = JSON.parse(readFileSync(new URL('../../public/data/schedule-2025.json', import.meta.url)))

// ── Bye derivation ─────────────────────────────────────────────────────────

test('finds all 32 teams, each with exactly one bye', () => {
  const byes = byeWeeksFromSchedule(schedule2025)
  assert.equal(byes.teams.length, 32)
  const counts = {}
  for (const teams of Object.values(byes.byWeek)) for (const t of teams) counts[t] = (counts[t] ?? 0) + 1
  assert.equal(Object.keys(counts).length, 32)
  assert.ok(Object.values(counts).every((n) => n === 1))
})

test("week 8 of 2025's byes reproduce exactly", () => {
  const byes = byeWeeksFromSchedule(schedule2025)
  assert.deepEqual(byes.byWeek[8], ['ARI', 'DET', 'JAX', 'LA', 'LV', 'SEA'])
})

test('a week with no games yields no byes rather than 32', () => {
  const byes = byeWeeksFromSchedule({ byWeek: { 1: [{ home: 'PHI', away: 'DAL' }], 2: [] } })
  assert.equal(byes.byWeek[2], undefined)
})

// ── Crunch ─────────────────────────────────────────────────────────────────

const template = parseRosterPositions([
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'IDP_FLEX', 'IDP_FLEX', 'BN', 'BN',
])

const fullRoster = {
  qb1: { position: 'QB', team: 'BUF' }, rb1: { position: 'RB', team: 'PHI' },
  rb2: { position: 'RB', team: 'DET' }, rb3: { position: 'RB', team: 'ATL' },
  wr1: { position: 'WR', team: 'CIN' }, wr2: { position: 'WR', team: 'MIN' },
  te1: { position: 'TE', team: 'KC' }, k1: { position: 'K', team: 'BAL' },
  PHI: { position: 'DEF', team: 'PHI' }, lb1: { position: 'LB', team: 'CHI' },
  dl1: { position: 'DL', team: 'GB' },
}

const crunch = (roster, byeTeams = new Set(), tmpl = template) =>
  crunchForWeek(Object.keys(roster), { playersById: roster, byeTeams, template: tmpl, normalizeTeam: toNflverseTeam })

test('a full roster is short of nothing', () => {
  const r = crunch(fullRoster)
  assert.equal(r.totalShortfall, 0)
  assert.deepEqual(r.neededPositions, [])
})

test('a position flags short only when non-bye players genuinely cannot fill it', () => {
  const r = crunch(fullRoster, new Set(['PHI']))
  // rb1 (PHI) is out: rb3 moves from flex into the RB slot, so RB is covered
  // and it's the flex that goes short — along with the PHI defense.
  assert.equal(r.byPosition.RB.shortfall, 0)
  assert.equal(r.flex.shortfall, 1)
  assert.equal(r.byPosition.DEF.shortfall, 1)
})

test('a position with no rostered players reports its full shortfall', () => {
  const { k1, ...noKicker } = fullRoster
  const r = crunch(noKicker)
  assert.deepEqual(r.byPosition.K, { required: 1, available: 0, shortfall: 1 })
})

test('an offensive surplus cannot cover an IDP flex slot', () => {
  // The bug this fixes: pooling FLEX and IDP_FLEX let a spare receiver "cover" a
  // missing linebacker, so a broken week looked fillable.
  const { lb1, ...noLinebacker } = fullRoster
  const roster = { ...noLinebacker, wr4: { position: 'WR', team: 'SEA' }, wr5: { position: 'WR', team: 'TB' } }
  const r = crunch(roster)
  assert.equal(r.flex.required, 3)
  assert.equal(r.flex.available, 2, 'two receivers cannot fill an IDP slot')
  assert.equal(r.totalShortfall, 1)
  const idp = r.flexGroups.find((g) => g.eligible.includes('LB'))
  assert.deepEqual([idp.required, idp.filled, idp.shortfall], [2, 1, 1])
  assert.deepEqual(r.neededPositions, ['DB', 'DL', 'LB'])
})

test('overlapping flex eligibility fills optimally', () => {
  const r = crunch(
    { wr1: { position: 'WR', team: 'PHI' }, rb1: { position: 'RB', team: 'DAL' } },
    new Set(),
    parseRosterPositions(['WRRB_FLEX', 'WRTE_FLEX']),
  )
  assert.equal(r.flex.available, 2)
  assert.equal(r.totalShortfall, 0)
})

test('bye matching normalises the team code (LAR is LA in the schedule)', () => {
  const roster = { ...fullRoster, rb1: { position: 'RB', team: 'LAR' } }
  const r = crunch(roster, new Set(byeWeeksFromSchedule(schedule2025).byWeek[8]))
  assert.ok(r.onBye.some((p) => p.id === 'rb1'), 'a Rams player is on bye in week 8')
})
