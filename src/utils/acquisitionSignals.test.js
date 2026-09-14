// node --test src/utils/acquisitionSignals.test.js — against the real 2025 file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { scoreWeeks } from './weeklyScoring.js'
import { DEFAULT_PROFILE } from './scoringProfile.js'
import { parseRosterPositions } from './rosterSlots.js'
import { seasonPaceBaselines, signalsFor, MIN_GAMES_FOR_LINE } from './acquisitionSignals.js'

const file = JSON.parse(readFileSync(new URL('../../public/data/weekly/2025.json', import.meta.url)))
const decode = (tuple) => Object.fromEntries(file.fields.map((f, i) => [f, tuple[i]]))

const players = Object.entries(file.players).map(([gsis, tuples]) => {
  const position = file.meta[gsis]?.p
  const season = scoreWeeks(tuples.map(decode).sort((a, b) => a.week - b.week), DEFAULT_PROFILE, position)
  return { gsis, position, perGame: season.perGame, games: season.games }
}).filter((p) => p.position && p.games)

const template = parseRosterPositions(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'])
const baselines = seasonPaceBaselines(players, template, 12)

test('exactly N players clear the start line at a position with N starters', () => {
  for (const [pos, starters] of [['QB', 12], ['RB', 24], ['WR', 24], ['TE', 12]]) {
    const eligible = players.filter((p) => p.position === pos && p.games >= MIN_GAMES_FOR_LINE)
    const clearing = eligible.filter((p) => p.perGame >= baselines[pos].startLine)
    assert.equal(clearing.length, starters, `${pos}: ${clearing.length} clear a ${starters}-starter line`)
  }
})

test('the player who sets the line clears it', () => {
  // The bug: rounding the line to one decimal put it above him.
  const qb = players.filter((p) => p.position === 'QB' && p.games >= MIN_GAMES_FOR_LINE)
    .sort((a, b) => b.perGame - a.perGame)[11]
  assert.ok(qb.perGame >= baselines.QB.startLine)
  assert.equal(signalsFor(qb, baselines)[0]?.key, 'startable')
})

test('the start line sits above the replacement line', () => {
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    assert.ok(baselines[pos].startLine >= baselines[pos].replacementLine, pos)
  }
})

test('no baseline is invented for a position with no weekly data', () => {
  assert.equal(baselines.DEF, undefined)
  assert.equal(baselines.LB, undefined)
})

test('startable and above-replacement are mutually exclusive', () => {
  for (const p of players) {
    const keys = signalsFor(p, baselines).map((s) => s.key)
    assert.ok(!(keys.includes('startable') && keys.includes('above-replacement')))
  }
})

test('detail strings round for display only', () => {
  const p = { position: 'QB', perGame: 21.96, games: 10 }
  const detail = signalsFor(p, { QB: { startLine: 21.96, replacementLine: 18 } })[0].detail
  assert.equal(detail, '22.0 pts/gm vs a 22.0 start line')
})
