import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenMatches, requireRelayToken } from '../src/lib/relayAuth.js'
import { buildTradePitchPrompt } from '../src/lib/prompts.js'
import { validateTradePitchBody, LIMITS } from '../src/lib/tradePitch.js'

function fakeReply() {
  return {
    statusCode: 200,
    body: undefined,
    code(n) { this.statusCode = n; return this },
    send(b) { this.body = b; return this },
  }
}

test('the right bearer token matches', () => {
  assert.equal(tokenMatches('abc123', 'Bearer abc123'), true)
})

test('a wrong, missing or malformed token does not', () => {
  assert.equal(tokenMatches('abc123', 'Bearer abc124'), false)
  assert.equal(tokenMatches('abc123', 'Bearer abc'), false)
  assert.equal(tokenMatches('abc123', 'abc123'), false)
  assert.equal(tokenMatches('abc123', undefined), false)
})

test('with no RELAY_TOKEN configured the route is disabled, not open', async () => {
  const reply = fakeReply()
  await requireRelayToken('')({ headers: { authorization: 'Bearer anything' } }, reply)
  assert.equal(reply.statusCode, 503)
})

test('a wrong token is 401', async () => {
  const reply = fakeReply()
  await requireRelayToken('abc123')({ headers: { authorization: 'Bearer nope' } }, reply)
  assert.equal(reply.statusCode, 401)
})

test('the right token lets the request through untouched', async () => {
  const reply = fakeReply()
  await requireRelayToken('abc123')({ headers: { authorization: 'Bearer abc123' } }, reply)
  assert.equal(reply.statusCode, 200)
  assert.equal(reply.body, undefined)
})

test('the pitch prompt carries every fact, the draft and the grounding rule', () => {
  const messages = buildTradePitchPrompt(['You are short at WR in week 9', 'I can send Jaxon Smith-Njigba'], 'Draft text')
  const all = messages.map((m) => m.content).join('\n')
  assert.match(all, /You are short at WR in week 9/)
  assert.match(all, /Jaxon Smith-Njigba/)
  assert.match(all, /Draft text/)
  assert.match(all, /Only use the information provided below/)
  assert.match(all, /Do not invent statistics/)
})

test('a valid body is accepted and trimmed', () => {
  const result = validateTradePitchBody({ facts: ['  a fact  ', ''], draft: '  hi  ' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.facts, ['a fact'])
  assert.equal(result.draft, 'hi')
})

test('bodies outside the limits are refused', () => {
  assert.equal(validateTradePitchBody({ facts: [], draft: 'x' }).ok, false)
  assert.equal(validateTradePitchBody({ facts: ['x'], draft: '' }).ok, false)
  assert.equal(validateTradePitchBody({ facts: Array(LIMITS.facts + 1).fill('x'), draft: 'x' }).ok, false)
  assert.equal(validateTradePitchBody({ facts: ['x'.repeat(LIMITS.factLength + 1)], draft: 'x' }).ok, false)
  assert.equal(validateTradePitchBody({ facts: [42], draft: 'x' }).ok, false)
})
