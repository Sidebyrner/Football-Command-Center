import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

// New TypeScript code is tested with Vitest (*.spec.ts); the existing
// JavaScript suites stay on node:test (*.test.js), so neither runner picks
// up the other's files.
export default defineConfig({
  resolve: {
    alias: { '@core': src('core'), '@data': src('data'), '@models': src('models'), '@ui': src('ui') },
  },
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx', 'tests/**/*.spec.ts'],
    environment: 'node',
  },
})
