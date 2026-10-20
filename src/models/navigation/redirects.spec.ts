import { describe, expect, it } from 'vitest'
import { REDIRECTS } from './redirects'
import { screenForPath } from './screens'

describe('redirects', () => {
  it('short paths open the screen they name', () => {
    expect(REDIRECTS['/waivers']).toBe('/market/waivers')
    expect(REDIRECTS['/injuries']).toBe('/lineup/injuries')
    expect(REDIRECTS['/decide']).toBe('/lineup/decide')
    expect(REDIRECTS['/trades']).toBe('/market/trades')
    expect(REDIRECTS['/discover']).toBe('/market/discover')
  })

  it('every hub redirect lands on a real screen', () => {
    for (const to of Object.values(REDIRECTS)) {
      if (to.startsWith('/tools/')) continue
      expect(screenForPath(to), to).toBeDefined()
    }
  })

  it('no redirect shadows a screen of its own', () => {
    for (const from of Object.keys(REDIRECTS)) expect(screenForPath(from), from).toBeUndefined()
  })
})
