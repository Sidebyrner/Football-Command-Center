#!/usr/bin/env node
// Preprocess nflverse + fantasy market data into compact frontend-friendly JSON.
//
// Usage:
//   npm run preprocess-nflverse
//   npm run preprocess-nflverse -- --seasons=2025,2024
//
// Outputs (all under public/data/):
//   nflverse-seasons.json  { _meta, players: { [gsis_id]: { "2025": {...} } } }
//   cohorts.json           { _meta, cohorts: { [position]: { [metric]: number[] } } }
//   player-ids.json        { _meta, players: { [sleeper_id]: { gsisId, fantasyprosId, ... } } }
//   adp.json               { _meta, players: { [fantasypros_id]: { ecr, sd, bye, ... } } }
//
// Sources:
//   Weekly stats  https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{year}.csv
//   ID crosswalk  https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv
//   ECR / ADP     https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv
//
// NOTE ON SCHEMA: nflverse moved from the `player_stats` release to `stats_player`
// and renamed several columns. `readField()` below accepts both spellings so the
// legacy 2024-and-earlier files still parse. Do not "simplify" it away.

import https from 'https'
import { mkdirSync, writeFileSync, createWriteStream, readFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'public', 'data')

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const DEFAULT_SEASONS = [2025, 2024]
const seasonsArg = args.find((a) => a.startsWith('--seasons'))
const SEASONS = seasonsArg
  ? (seasonsArg.includes('=') ? seasonsArg.split('=')[1] : args[args.indexOf(seasonsArg) + 1])
      ?.split(',').map(Number).filter((n) => !isNaN(n)) ?? DEFAULT_SEASONS
  : DEFAULT_SEASONS

const STATS_URL = (y) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${y}.csv`
const IDS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv'
const ECR_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv'

// Positions we keep. The unified stats file also carries IDP and returners;
// we only need fantasy-relevant offense + kickers.
const KEEP_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

// ── Download ──────────────────────────────────────────────────────────────────
// Follows redirects (GitHub release assets always redirect to objects.githubusercontent.com)
// and only opens the output stream once a 200 is in hand.
function download(url, destPath, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects: ${url}`))

    https.get(url, (res) => {
      const { statusCode, headers } = res

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume() // drain so the socket can be reused
        return resolve(download(headers.location, destPath, redirects + 1))
      }
      if (statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${statusCode}: ${url}`))
      }

      const file = createWriteStream(destPath)
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve(destPath)))
      file.on('error', reject)
    }).on('error', reject)
  })
}

// ── CSV ───────────────────────────────────────────────────────────────────────
// Quote-aware: the stats file has list columns (fg_made_list = "23,45,51") whose
// embedded commas would shred a naive split(',').
function parseCSVLine(line) {
  const fields = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === ',' && !inQuote) { fields.push(cur); cur = '' }
    else cur += ch
  }
  fields.push(cur)
  return fields
}

function readCSV(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0)
  if (!lines.length) return []
  const headers = parseCSVLine(lines[0].replace(/\r$/, ''))
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i].replace(/\r$/, ''))
    if (vals.length !== headers.length) continue
    const row = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j]
    out.push(row)
  }
  return out
}

// ── Field access ──────────────────────────────────────────────────────────────
function num(v) {
  if (v == null || v === '' || v === 'NA') return 0
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function str(v) {
  return v == null || v === '' || v === 'NA' ? null : v
}

// Reads the first spelling that exists on the row. Order matters: new name first.
function readField(row, ...names) {
  for (const n of names) if (row[n] !== undefined) return row[n]
  return undefined
}

// Canonical output name -> source column spellings (new, then legacy).
const SUM_FIELDS = {
  completions:                 ['completions'],
  attempts:                    ['attempts'],
  passing_yards:               ['passing_yards'],
  passing_tds:                 ['passing_tds'],
  interceptions:               ['passing_interceptions', 'interceptions'],
  sacks:                       ['sacks_suffered', 'sacks'],
  sack_yards:                  ['sack_yards_lost', 'sack_yards'],
  passing_air_yards:           ['passing_air_yards'],
  passing_yards_after_catch:   ['passing_yards_after_catch'],
  passing_first_downs:         ['passing_first_downs'],
  passing_2pt_conversions:     ['passing_2pt_conversions'],
  carries:                     ['carries'],
  rushing_yards:               ['rushing_yards'],
  rushing_tds:                 ['rushing_tds'],
  rushing_fumbles:             ['rushing_fumbles'],
  rushing_fumbles_lost:        ['rushing_fumbles_lost'],
  rushing_first_downs:         ['rushing_first_downs'],
  rushing_2pt_conversions:     ['rushing_2pt_conversions'],
  receptions:                  ['receptions'],
  targets:                     ['targets'],
  receiving_yards:             ['receiving_yards'],
  receiving_tds:               ['receiving_tds'],
  receiving_fumbles:           ['receiving_fumbles'],
  receiving_fumbles_lost:      ['receiving_fumbles_lost'],
  receiving_air_yards:         ['receiving_air_yards'],
  receiving_yards_after_catch: ['receiving_yards_after_catch'],
  receiving_first_downs:       ['receiving_first_downs'],
  receiving_2pt_conversions:   ['receiving_2pt_conversions'],
  special_teams_tds:           ['special_teams_tds'],
  fantasy_points:              ['fantasy_points'],
  fantasy_points_ppr:          ['fantasy_points_ppr'],
  // Kicking (only present in the new unified file)
  fg_made:                     ['fg_made'],
  fg_att:                      ['fg_att'],
  fg_missed:                   ['fg_missed'],
  fg_made_0_19:                ['fg_made_0_19'],
  fg_made_20_29:               ['fg_made_20_29'],
  fg_made_30_39:               ['fg_made_30_39'],
  fg_made_40_49:               ['fg_made_40_49'],
  fg_made_50_59:               ['fg_made_50_59'],
  fg_made_60_:                 ['fg_made_60_'],
  pat_made:                    ['pat_made'],
  pat_att:                     ['pat_att'],
}

// Rate stats: averaged over weeks where the player actually recorded a value.
const AVG_FIELDS = {
  target_share:    ['target_share'],
  air_yards_share: ['air_yards_share'],
  wopr:            ['wopr'],
  racr:            ['racr'],
  pacr:            ['pacr'],
}

// ── NFL passer rating from components ────────────────────────────────────────
function passerRating({ completions, attempts, passing_yards, passing_tds, interceptions }) {
  if (!attempts) return null
  const cl = (x) => Math.max(0, Math.min(2.375, x))
  const a = cl((completions / attempts - 0.3) * 5)
  const b = cl((passing_yards / attempts - 3) * 0.25)
  const c = cl((passing_tds / attempts) * 20)
  const d = cl(2.375 - (interceptions / attempts) * 25)
  return ((a + b + c + d) / 6) * 100
}

// ── Aggregate one player's season ────────────────────────────────────────────
function aggregate(rows) {
  if (!rows.length) return null
  const first = rows[0]
  const last = rows[rows.length - 1]

  const r = {
    gsis_id: readField(first, 'player_id'),
    name: str(readField(first, 'player_display_name', 'player_name')),
    position: str(readField(first, 'position')),
    team: str(readField(last, 'team', 'recent_team')),
    season: num(readField(first, 'season')),
    games: rows.length,
  }

  for (const [out, sources] of Object.entries(SUM_FIELDS)) {
    r[out] = rows.reduce((acc, row) => acc + num(readField(row, ...sources)), 0)
  }

  for (const [out, sources] of Object.entries(AVG_FIELDS)) {
    const vals = rows.map((row) => num(readField(row, ...sources))).filter((v) => v > 0)
    r[out] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }

  const g = Math.max(r.games, 1)

  if (r.attempts > 0) {
    r.completion_pct = r.completions / r.attempts
    r.yards_per_attempt = r.passing_yards / r.attempts
    r.td_rate = r.passing_tds / r.attempts
    r.int_rate = r.interceptions / r.attempts
    r.sack_rate = r.sacks / (r.attempts + r.sacks)
    r.adot_qb = r.passing_air_yards / r.attempts
    r.passer_rating = passerRating(r)
  }
  if (r.targets > 0) {
    r.catch_rate = r.receptions / r.targets
    r.adot = r.receiving_air_yards / r.targets
    r.yards_per_target = r.receiving_yards / r.targets
  }
  if (r.carries > 0) r.yards_per_carry = r.rushing_yards / r.carries
  if (r.fg_att > 0) r.fg_pct = r.fg_made / r.fg_att

  r.fantasy_points_per_game = r.fantasy_points / g
  r.fantasy_points_ppr_per_game = r.fantasy_points_ppr / g
  r.targets_per_game = r.targets / g
  r.carries_per_game = r.carries / g
  r.touches_per_game = (r.carries + r.receptions) / g
  r.rushing_first_downs_per_game = r.rushing_first_downs / g
  r.receiving_first_downs_per_game = r.receiving_first_downs / g

  return r
}

// ── Cohorts ───────────────────────────────────────────────────────────────────
// Sorted arrays of real values per position/metric. percentileRank() ranks a
// player against these instead of against a fabricated distribution.
//
// Qualifiers keep replacement-level noise out of the distribution: a WR with 2
// targets in 1 game would otherwise drag every percentile upward.
const COHORT_METRICS = {
  targetShare:        (s) => s.target_share,
  airYardsShare:      (s) => s.air_yards_share,
  wopr:               (s) => s.wopr,
  racr:               (s) => s.racr,
  adot:               (s) => s.adot,
  trueCatchRate:      (s) => s.catch_rate,
  yardsPerTarget:     (s) => s.yards_per_target,
  targetsPerGame:     (s) => s.targets_per_game,
  receivingFirstDowns:(s) => s.receiving_first_downs_per_game,
  completionPct:      (s) => s.completion_pct,
  intRate:            (s) => s.int_rate,
  sackRate:           (s) => s.sack_rate,
  qbRating:           (s) => s.passer_rating,
  yardsPerAttempt:    (s) => s.yards_per_attempt,
  adotQb:             (s) => s.adot_qb,
  rushingAttempts:    (s) => s.carries_per_game,
  seasonRushYards:    (s) => s.rushing_yards,
  yardsPerCarry:      (s) => s.yards_per_carry,
  touchesPerGame:     (s) => s.touches_per_game,
  rushingFirstDowns:  (s) => s.rushing_first_downs_per_game,
  fantasyPointsPerGame: (s) => s.fantasy_points_per_game,
  fgPct:              (s) => s.fg_pct,
}

const MIN_GAMES = 6
const MIN_TARGETS = 25
const MIN_ATTEMPTS = 100
const MIN_CARRIES = 40

// Which metrics need which qualifier before a player counts toward the cohort.
function qualifies(metric, s) {
  if (s.games < MIN_GAMES) return false
  const receiving = ['targetShare','airYardsShare','wopr','racr','adot','trueCatchRate',
                     'yardsPerTarget','targetsPerGame','receivingFirstDowns']
  const passing   = ['completionPct','intRate','sackRate','qbRating','yardsPerAttempt','adotQb']
  const rushing   = ['seasonRushYards','yardsPerCarry','rushingFirstDowns','rushingAttempts']
  if (receiving.includes(metric)) return s.targets >= MIN_TARGETS
  if (passing.includes(metric)) return s.attempts >= MIN_ATTEMPTS
  if (rushing.includes(metric)) return s.carries >= MIN_CARRIES
  return true
}

function buildCohorts(seasonIndex, season) {
  const cohorts = {}
  for (const perSeason of Object.values(seasonIndex)) {
    const s = perSeason[String(season)]
    if (!s || !KEEP_POSITIONS.has(s.position)) continue
    const pos = s.position
    cohorts[pos] ??= {}
    for (const [metric, get] of Object.entries(COHORT_METRICS)) {
      const v = get(s)
      if (v == null || isNaN(v) || !qualifies(metric, s)) continue
      ;(cohorts[pos][metric] ??= []).push(v)
    }
  }
  for (const pos of Object.keys(cohorts)) {
    for (const metric of Object.keys(cohorts[pos])) {
      const arr = cohorts[pos][metric]
      // Drop thin cohorts — a percentile against 4 players is not a percentile.
      if (arr.length < 12) { delete cohorts[pos][metric]; continue }
      arr.sort((a, b) => a - b)
      cohorts[pos][metric] = arr.map((v) => Math.round(v * 1e4) / 1e4)
    }
  }
  return cohorts
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function fetchCsv(url, label) {
  const tmp = join(tmpdir(), `fcc-${label}-${Date.now()}.csv`)
  console.log(`  ↓ ${url}`)
  await download(url, tmp)
  const rows = readCSV(tmp)
  try { unlinkSync(tmp) } catch {}
  return rows
}

function writeOut(filename, payload) {
  const path = join(OUT_DIR, filename)
  const json = JSON.stringify(payload)
  writeFileSync(path, json)
  console.log(`  ✓ ${filename} (${Math.round(Buffer.byteLength(json) / 1024)} KB)`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const generated = new Date().toISOString()

  // ── 1. Weekly stats → season aggregates ────────────────────────────────────
  console.log(`\n[1/3] nflverse player stats — seasons ${SEASONS.join(', ')}`)
  const seasonIndex = {}
  const loaded = []

  for (const season of SEASONS) {
    let rows
    try {
      rows = await fetchCsv(STATS_URL(season), `stats-${season}`)
    } catch (err) {
      console.error(`  ✗ ${season} failed: ${err.message}`)
      continue
    }

    const reg = rows.filter(
      (r) => r.season_type === 'REG' && KEEP_POSITIONS.has(readField(r, 'position'))
    )
    const byPlayer = {}
    for (const row of reg) {
      const pid = readField(row, 'player_id')
      if (!pid) continue
      ;(byPlayer[pid] ??= []).push(row)
    }

    let n = 0
    for (const [gsisId, playerRows] of Object.entries(byPlayer)) {
      playerRows.sort((a, b) => num(a.week) - num(b.week))
      const agg = aggregate(playerRows)
      if (!agg) continue
      ;(seasonIndex[gsisId] ??= {})[String(season)] = agg
      n++
    }
    console.log(`  ✓ ${season}: ${n} players from ${reg.length} weekly rows`)
    loaded.push(season)
  }

  if (!loaded.length) throw new Error('No seasons loaded — aborting rather than writing empty data.')

  writeOut('nflverse-seasons.json', {
    _meta: { generated, seasons: loaded, source: 'nflverse/nflverse-data stats_player',
             playerCount: Object.keys(seasonIndex).length },
    players: seasonIndex,
  })

  // ── 2. Cohorts from the most recent loaded season ──────────────────────────
  const cohortSeason = Math.max(...loaded)
  console.log(`\n[2/3] percentile cohorts — ${cohortSeason}`)
  const cohorts = buildCohorts(seasonIndex, cohortSeason)
  for (const [pos, metrics] of Object.entries(cohorts)) {
    const sizes = Object.values(metrics).map((a) => a.length)
    console.log(`  ✓ ${pos}: ${Object.keys(metrics).length} metrics, n=${Math.min(...sizes)}–${Math.max(...sizes)}`)
  }
  writeOut('cohorts.json', {
    _meta: { generated, season: cohortSeason, minGames: MIN_GAMES },
    cohorts,
  })

  // ── 3. ID crosswalk + ADP ──────────────────────────────────────────────────
  console.log('\n[3/3] ID crosswalk + ADP')

  const idRows = await fetchCsv(IDS_URL, 'ids')
  const bySleeper = {}
  for (const row of idRows) {
    const sleeperId = str(row.sleeper_id)
    if (!sleeperId) continue
    bySleeper[sleeperId] = {
      gsisId: str(row.gsis_id),
      fantasyprosId: str(row.fantasypros_id),
      name: str(row.name),
      position: str(row.position),
      team: str(row.team),
    }
  }
  const withBoth = Object.values(bySleeper).filter((p) => p.gsisId && p.fantasyprosId).length
  console.log(`  ✓ ${Object.keys(bySleeper).length} sleeper ids (${withBoth} with gsis + fantasypros)`)
  writeOut('player-ids.json', {
    _meta: { generated, source: 'dynastyprocess/data db_playerids' },
    players: bySleeper,
  })

  const ecrRows = await fetchCsv(ECR_URL, 'ecr')
  const adp = {}
  let scrapeDate = null
  for (const row of ecrRows) {
    // Redraft rankings only — dynasty/best-ball use different value curves.
    if (!row.page_type?.startsWith('redraft-')) continue
    const fpId = str(row.id)
    if (!fpId) continue
    scrapeDate ??= str(row.scrape_date)

    const ecr = num(row.ecr)
    if (!ecr) continue
    // Prefer the overall board; positional pages fill in anyone it misses.
    const isOverall = row.page_type === 'redraft-overall'
    if (adp[fpId] && !isOverall) continue

    adp[fpId] = {
      ecr,
      sd: num(row.sd) || null,
      best: num(row.best) || null,
      worst: num(row.worst) || null,
      bye: num(row.bye) || null,
      pos: str(row.pos),
      team: str(row.tm) ?? str(row.team),
      name: str(row.player),
      overall: isOverall,
    }
  }
  const withBye = Object.values(adp).filter((p) => p.bye).length
  console.log(`  ✓ ${Object.keys(adp).length} ranked players (${withBye} with bye), scraped ${scrapeDate}`)
  writeOut('adp.json', {
    _meta: { generated, scrapeDate, source: 'dynastyprocess/data db_fpecr_latest' },
    players: adp,
  })

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('\npreprocess-nflverse failed:', err.message)
  process.exit(1)
})
