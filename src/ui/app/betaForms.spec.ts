import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { encodeForm, looksLikeEmail } from './betaForms'

describe('beta forms', () => {
  it('names the Netlify form in the post body', () => {
    const body = new URLSearchParams(encodeForm('beta-signup', { email: 'a@b.co', devices: 'iPhone, Mac' }))
    expect(body.get('form-name')).toBe('beta-signup')
    expect(body.get('devices')).toBe('iPhone, Mac')
  })

  it('checks emails loosely', () => {
    expect(looksLikeEmail(' fan@league.com ')).toBe(true)
    expect(looksLikeEmail('fan@league')).toBe(false)
    expect(looksLikeEmail('not an email')).toBe(false)
  })

  it('declares every posted field in index.html, so Netlify keeps it', () => {
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')
    const form = (name: string) => html.match(new RegExp(`<form name="${name}"[\\s\\S]*?</form>`))?.[0] ?? ''
    for (const field of ['email', 'name', 'devices', 'bot-field']) expect(form('beta-signup')).toContain(`name="${field}"`)
    for (const field of ['message', 'email', 'kind', 'context', 'bot-field']) expect(form('beta-feedback')).toContain(`name="${field}"`)
  })
})
