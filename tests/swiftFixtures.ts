import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The native app's test fixtures, read in place — the single source of truth
 * the web port is checked against. Read-only: the web work never writes under
 * apple/ (see .githooks/pre-commit).
 */
const root = fileURLToPath(new URL('../apple/Packages/', import.meta.url))

export type SwiftPackage = 'FCCore' | 'FCData' | 'FCApp'

export function fixturePath(pkg: SwiftPackage, name: string): string {
  return `${root}${pkg}/Tests/${pkg}Tests/Fixtures/${name}`
}

export function hasFixture(pkg: SwiftPackage, name: string): boolean {
  return existsSync(fixturePath(pkg, name))
}

export function readFixture<T = unknown>(pkg: SwiftPackage, name: string): T {
  return JSON.parse(readFileSync(fixturePath(pkg, name), 'utf8')) as T
}

/** The raw text of a fixture, for feeding a stub transport. */
export function fixtureText(pkg: SwiftPackage, name: string): string {
  return readFileSync(fixturePath(pkg, name), 'utf8')
}
