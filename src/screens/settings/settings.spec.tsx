import { describe, expect, it } from 'vitest'
import { renderScreen } from '../../../tests/renderScreen'
import { SettingsScreen } from './SettingsScreen'

describe('Settings screen', () => {
  it('renders in the demo league', async () => {
    const html = await renderScreen(SettingsScreen, '/settings')
    expect(html).toContain('You’re in the demo league')
    expect(html).toContain('Leave the demo')
  })
})
