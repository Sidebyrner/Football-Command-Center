#!/usr/bin/env node
// Decides whether freshly built data differs from what is already published.
//
//   node scripts/compare-published-data.mjs <built-dir> <published-dir>
//
// Prints `changed=true` or `changed=false` (GitHub Actions output format) and
// exits 0 either way.
//
// Why this exists: every preprocess run stamps `_meta.generated` with the current
// time, so a byte comparison says "changed" daily. Publishing identical data every
// day would give every file a new ETag, and every phone would re-download ~1.8 MB
// for nothing. Timestamps are ignored; any real change — a new week of stats, a
// corrected line, a file added or removed — counts.

import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'

function jsonFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.json')) out.push(relative(dir, path))
    }
  }
  walk(dir)
  return out.sort()
}

// Canonical form: generation timestamps removed, keys sorted.
function canonical(text) {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') {
      const out = {}
      for (const key of Object.keys(value).sort()) {
        if (key === 'generated') continue
        out[key] = strip(value[key])
      }
      return out
    }
    return value
  }
  try {
    return JSON.stringify(strip(JSON.parse(text)))
  } catch {
    return text // not valid JSON: compare raw so a broken file still counts as a change
  }
}

export function differs(builtDir, publishedDir) {
  const built = jsonFiles(builtDir)
  const published = jsonFiles(publishedDir)
  if (built.join('\n') !== published.join('\n')) return true
  return built.some((file) =>
    canonical(readFileSync(join(builtDir, file), 'utf8')) !==
    canonical(readFileSync(join(publishedDir, file), 'utf8'))
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [builtDir, publishedDir] = process.argv.slice(2)
  if (!builtDir || !publishedDir) {
    console.error('usage: compare-published-data.mjs <built-dir> <published-dir>')
    process.exit(2)
  }
  console.log(`changed=${differs(builtDir, publishedDir)}`)
}
