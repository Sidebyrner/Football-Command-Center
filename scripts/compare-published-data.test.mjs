// node --test scripts/compare-published-data.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { differs } from './compare-published-data.mjs'

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'fcc-data-'))
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  return dir
}

const weekly = (generated, yards) => ({
  _meta: { generated, season: 2026, weeks: [1, 2] },
  fields: ['week', 'pass_yd'],
  players: { x: [[1, yards]] },
})

test('identical data is unchanged', () => {
  const a = tree({ 'weekly/2026.json': weekly('2026-09-20T10:00Z', 250) })
  const b = tree({ 'weekly/2026.json': weekly('2026-09-20T10:00Z', 250) })
  assert.equal(differs(a, b), false)
})

test('a new generation timestamp alone is not a change', () => {
  const a = tree({ 'weekly/2026.json': weekly('2026-09-21T10:30Z', 250) })
  const b = tree({ 'weekly/2026.json': weekly('2026-09-20T10:30Z', 250) })
  assert.equal(differs(a, b), false)
})

test('key order alone is not a change', () => {
  const a = tree({ 'x.json': '{"a":1,"b":2}' })
  const b = tree({ 'x.json': '{"b":2,"a":1}' })
  assert.equal(differs(a, b), false)
})

test('a corrected stat is a change', () => {
  const a = tree({ 'weekly/2026.json': weekly('2026-09-21T10:30Z', 251) })
  const b = tree({ 'weekly/2026.json': weekly('2026-09-20T10:30Z', 250) })
  assert.equal(differs(a, b), true)
})

test('a new file is a change', () => {
  const a = tree({ 'weekly/2025.json': weekly('t', 1), 'weekly/2026.json': weekly('t', 1) })
  const b = tree({ 'weekly/2025.json': weekly('t', 1) })
  assert.equal(differs(a, b), true)
})

test('a removed file is a change', () => {
  const a = tree({ 'weekly/2025.json': weekly('t', 1) })
  const b = tree({ 'weekly/2025.json': weekly('t', 1), 'weekly/2026.json': weekly('t', 1) })
  assert.equal(differs(a, b), true)
})

test('nothing published yet is a change', () => {
  const a = tree({ 'weekly/2025.json': weekly('t', 1) })
  assert.equal(differs(a, join(tmpdir(), 'fcc-does-not-exist')), true)
})

test('the real public/data compares equal to itself', () => {
  assert.equal(differs('public/data', 'public/data'), false)
})
