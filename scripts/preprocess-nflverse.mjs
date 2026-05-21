#!/usr/bin/env node
// Preprocess nflverse player_stats into a compact frontend-friendly JSON.
//
// Usage:
//   npm run preprocess-nflverse
//   npm run preprocess-nflverse -- --seasons 2024,2023
//   npm run preprocess-nflverse -- --seasons 2024,2023,2022
//
// Output: public/data/nflverse-seasons.json
// Shape:  { [gsis_id]: { "2024": { ...aggregated stats }, "2023": { ... } } }
//
// Source: https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html
// Raw CSV: https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{year}.csv

import https from 'https'
import http from 'http'
import { createWriteStream, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import { createReadStream } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'public', 'data')
const OUT_FILE = join(OUT_DIR, 'nflverse-seasons.json')

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const seasonsArg = args.find((a) => a.startsWith('--seasons'))
const DEFAULT_SEASONS = [2024, 2023]
const SEASONS = seasonsArg
  ? seasonsArg.split('=')[1]?.split(',').map(Number) ?? DEFAULT_SEASONS
  : DEFAULT_SEASONS

// ── Positions to include ──────────────────────────────────────────────────────
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

// ── Counting stats to sum across weeks ───────────────────────────────────────
const SUM_FIELDS = [
  'completions', 'attempts', 'passing_yards', 'passing_tds', 'interceptions',
  'sacks', 'sack_yards', 'passing_air_yards', 'passing_yards_after_catch',
  'passing_first_downs', 'passing_2pt_conversions',
  'carries', 'rushing_yards', 'rushing_tds', 'rushing_fumbles',
  'rushing_fumbles_lost', 'rushing_first_downs', 'rushing_2pt_conversions',
  'receptions', 'targets', 'receiving_yards', 'receiving_tds',
  'receiving_fumbles', 'receiving_fumbles_lost', 'receiving_air_yards',
  'receiving_yards_after_catch', 'receiving_first_downs',
  'receiving_2pt_conversions', 'special_teams_tds',
  'fantasy_points', 'fantasy_points_ppr',
]

// ── Rate/share stats to average across weeks ─────────────────────────────────
const AVG_FIELDS = ['target_share', 'air_yards_share', 'wopr', 'racr', 'pacr']

// ── Download helpers ──────────────────────────────────────────────────────────
function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)
    const protocol = url.startsWith('https') ? https : http

    function request(u) {
      protocol.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          request(res.headers.location)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${u}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      }).on('error', reject)
    }

    request(url)
  })
}

// ── CSV parser (handles quoted fields with commas) ────────────────────────────
function parseCSVLine(line) {
  const fields = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      fields.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

function readCSV(filePath) {
  const text = require('fs').readFileSync(filePath, 'utf8') // sync for simplicity
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) return []
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map((line) => {
    const vals = parseCSVLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

// ── Aggregation ───────────────────────────────────────────────────────────────
function num(v) {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function aggregatePlayerSeason(rows) {
  if (!rows.length) return null

  const first = rows[0]
  const result = {
    gsis_id: first.player_id,
    name: first.player_display_name || first.player_name,
    position: first.position,
    team: rows[rows.length - 1].recent_team, // last known team
    season: num(first.season),
    games: rows.length,
  }

  // Sum counting stats
  for (const field of SUM_FIELDS) {
    result[field] = rows.reduce((acc, r) => acc + num(r[field]), 0)
  }

  // Average rate stats (weighted by games with non-zero values)
  for (const field of AVG_FIELDS) {
    const nonZero = rows.filter((r) => num(r[field]) > 0)
    if (nonZero.length > 0) {
      result[field] = nonZero.reduce((acc, r) => acc + num(r[field]), 0) / nonZero.length
    } else {
      result[field] = 0
    }
  }

  // Derived metrics
  if (result.attempts > 0) {
    result.completion_pct = result.completions / result.attempts
    result.yards_per_attempt = result.passing_yards / result.attempts
    result.td_rate = result.passing_tds / result.attempts
    result.int_rate = result.interceptions / result.attempts
    result.sack_rate = result.sacks / (result.attempts + result.sacks)
    result.adot_qb = result.passing_air_yards / result.attempts
  }

  if (result.targets > 0) {
    result.catch_rate = result.receptions / result.targets
    result.adot = result.receiving_air_yards / result.targets
    result.yards_per_target = result.receiving_yards / result.targets
  }

  if (result.carries > 0) {
    result.yards_per_carry = result.rushing_yards / result.carries
  }

  if (result.games > 0) {
    result.fantasy_points_per_game = result.fantasy_points / result.games
    result.fantasy_points_ppr_per_game = result.fantasy_points_ppr / result.games
    result.targets_per_game = result.targets / result.games
    result.carries_per_game = result.carries / result.games
  }

  return result
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Processing seasons: ${SEASONS.join(', ')}`)

  const allData = {}

  for (const season of SEASONS) {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${season}.csv`
    const tmpPath = join(tmpdir(), `nflverse-player-stats-${season}.csv`)

    console.log(`\nDownloading ${season} player stats...`)
    console.log(`  Source: ${url}`)

    try {
      await download(url, tmpPath)
      console.log(`  Downloaded → ${tmpPath}`)
    } catch (err) {
      console.error(`  Failed to download ${season}: ${err.message}`)
      continue
    }

    console.log(`  Parsing...`)
    const { createReadStream: crs } = await import('fs')
    const { readFileSync } = await import('fs')
    const text = readFileSync(tmpPath, 'utf8')
    const lines = text.split('\n').filter(Boolean)
    if (lines.length < 2) {
      console.error(`  Empty file for season ${season}`)
      continue
    }

    const headers = parseCSVLine(lines[0])
    const rows = lines.slice(1).map((line) => {
      const vals = parseCSVLine(line)
      const row = {}
      headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
      return row
    })

    // Filter: regular season, skill positions only
    const filtered = rows.filter(
      (r) => r.season_type === 'REG' && SKILL_POSITIONS.has(r.position)
    )

    // Group by player_id
    const byPlayer = {}
    for (const row of filtered) {
      const pid = row.player_id
      if (!pid) continue
      if (!byPlayer[pid]) byPlayer[pid] = []
      byPlayer[pid].push(row)
    }

    // Aggregate each player
    let count = 0
    for (const [gsisId, playerRows] of Object.entries(byPlayer)) {
      const agg = aggregatePlayerSeason(playerRows)
      if (!agg) continue

      if (!allData[gsisId]) allData[gsisId] = {}
      allData[gsisId][String(season)] = agg
      count++
    }

    console.log(`  Aggregated ${count} players for ${season}`)
  }

  const output = {
    _meta: {
      generated: new Date().toISOString(),
      seasons: SEASONS,
      source: 'nflverse/nflverse-data player_stats',
      playerCount: Object.keys(allData).length,
    },
    ...allData,
  }

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 0))
  const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024)
  console.log(`\nOutput: ${OUT_FILE} (${sizeKb} KB, ${Object.keys(allData).length} players)`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('preprocess-nflverse failed:', err.message)
  process.exit(1)
})
