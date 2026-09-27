// node --test src/services/sleeperService.test.js
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Minimal browser globals: a localStorage with the real ~5 MB quota behaviour,
// and a fetch that counts downloads of the player file.
const QUOTA = 5 * 1024 * 1024
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    const used = [...store.entries()].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0)
    if (used + k.length + v.length > QUOTA) {
      const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err
    }
    store.set(k, v)
  },
  removeItem: (k) => store.delete(k),
}

let downloads = 0
// Roughly Sleeper's shape and size: ~11,000 players with many unused fields.
function rawPlayers() {
  const out = {}
  for (let i = 0; i < 11000; i++) {
    out[String(i)] = {
      player_id: String(i), full_name: `Player ${i}`, first_name: 'Player', last_name: String(i),
      position: i % 5 === 0 ? 'LB' : 'WR', team: 'PHI', active: i % 3 !== 0,
      injury_status: i === 7 ? 'Questionable' : null,
      fantasy_positions: ['WR'], college: 'Some University', height: '72', weight: '200',
      birth_date: '1999-01-01', espn_id: 1234567, yahoo_id: 7654321, rotowire_id: 11111, sportradar_id: 'abcdef-1234-5678-9012-abcdefabcdef',
      search_full_name: `player${i}`, hashtag: `#player${i}-nfl-phi-00`, metadata: { channel_id: '1234567890123456789' },
    }
  }
  return out
}
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/players/nfl')) downloads++
  await new Promise((r) => setTimeout(r, 5))
  return { ok: true, json: async () => rawPlayers() }
}

const { getPlayerIndex, getPlayerMeta, trimPlayerIndex } = await import('./sleeperService.js')

beforeEach(() => { store.clear(); downloads = 0 })

test('the raw player file would not fit in localStorage — that was the bug', () => {
  const size = JSON.stringify(rawPlayers()).length
  assert.ok(size > QUOTA, `raw payload is ${(size / 1e6).toFixed(1)} MB`)
})

test('the trimmed index keeps identity and injury tags and fits', () => {
  const index = trimPlayerIndex(rawPlayers())
  assert.deepEqual(index['7'], { name: 'Player 7', position: 'WR', team: 'PHI', injuryStatus: 'Questionable', active: true })
  assert.ok(JSON.stringify(index).length < QUOTA / 4)
})

test('the index is cached after one download', async () => {
  await getPlayerIndex()
  await getPlayerIndex()
  assert.equal(downloads, 1)
  assert.ok(store.has('sleeper-player-index-v3'), 'the write succeeded')
})

test('concurrent callers share one download', async () => {
  // useMissingPlayerMeta looks up several IDP players at once.
  await Promise.all(['0', '5', '10', '15'].map((id) => getPlayerMeta(id)))
  assert.equal(downloads, 1)
})

test('getPlayerMeta returns Sleeper field names for existing callers', async () => {
  const p = await getPlayerMeta('5')
  assert.equal(p.full_name, 'Player 5')
  assert.equal(p.position, 'LB')
  assert.equal(await getPlayerMeta('does-not-exist'), null)
})

test('a max age younger than the cached copy forces a refetch', async () => {
  await getPlayerIndex()
  // Backdate the cache entry by four hours.
  const entry = JSON.parse(store.get('sleeper-player-index-v3'))
  entry.storedAt -= 4 * 60 * 60 * 1000
  store.set('sleeper-player-index-v3', JSON.stringify(entry))

  await getPlayerIndex() // ordinary day: 24h allowed
  assert.equal(downloads, 1)
  await getPlayerIndex({ maxAgeMs: 3 * 60 * 60 * 1000 }) // game day: 3h
  assert.equal(downloads, 2)
})
