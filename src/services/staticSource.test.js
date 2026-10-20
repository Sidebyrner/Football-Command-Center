import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadStatic, setStaticLoader, StaticDataUnavailable } from './staticSource.js'
import { loadSchedule } from './scheduleService.js'

test('services read through the registered store, not the bundled copy', async () => {
  const asked = []
  setStaticLoader(async (name, season) => {
    asked.push([name, season])
    return { byWeek: { 7: [] }, season: Number(season) }
  })
  const file = await loadSchedule(2026)
  assert.equal(file.season, 2026)
  assert.deepEqual(asked, [['schedule', '2026']])
  setStaticLoader(null)
})

test('a file that can’t be had reads as unavailable, never as a setup step', async () => {
  setStaticLoader(async () => { throw new Error('HTTP 404') })
  await assert.rejects(loadStatic('cohorts', 'Position comparison data'), (err) => {
    assert.ok(err instanceof StaticDataUnavailable)
    assert.doesNotMatch(err.message, /npm|preprocess/)
    return true
  })
  setStaticLoader(null)
})
