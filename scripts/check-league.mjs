#!/usr/bin/env node
// Real-league check: runs the web app's lineup, bye, lock and stats logic
// against a live Sleeper league and prints what the pages would show, plus
// every place the real data doesn't fit the code.
//
//   npm run check-league -- <sleeper-username>          every league this season
//   npm run check-league -- <username> --league <id>    one league
//   npm run check-league -- --joins                     no league: Sleeper index vs schedule
//
// Options: --week <n> (default: Sleeper's current week), --now <ISO time>
// (default: now), --json. Sleeper's API is public and read-only; no login.
// Static data is read from public/data, so run `npm run preprocess-nflverse`
// first if that's stale. Exits 1 when any finding is an error.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { trimPlayerIndex } from '../src/services/sleeperService.js'
import { pickStatsSeason } from '../src/utils/statsSeason.js'
import { checkJoins, checkLeague } from './lib/leagueCheck.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'public/data')
const CACHE = path.join(ROOT, 'node_modules/.cache/fcc/sleeper-players-v3.json')
const PLAYERS_MAX_AGE_MS = 3 * 60 * 60 * 1000 // the game-day rule
const API = 'https://api.sleeper.app/v1'

function parseArgs(argv) {
  const opts = { username: null, league: null, week: null, now: null, json: false, joins: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--league') opts.league = argv[++i]
    else if (a === '--week') opts.week = Number(argv[++i])
    else if (a === '--now') opts.now = new Date(argv[++i])
    else if (a === '--json') opts.json = true
    else if (a === '--joins') opts.joins = true
    else if (!a.startsWith('--')) opts.username = a
  }
  opts.username ??= process.env.SLEEPER_USERNAME ?? null
  return opts
}

async function get(pathname) {
  const res = await fetch(`${API}${pathname}`)
  if (!res.ok) throw new Error(`Sleeper ${res.status} for ${pathname}`)
  return res.json()
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** Sleeper's ~5 MB player map, trimmed, cached for three hours. */
async function playerIndex() {
  try {
    const info = await stat(CACHE)
    if (Date.now() - info.mtimeMs < PLAYERS_MAX_AGE_MS) return readJson(CACHE)
  } catch { /* no cache yet */ }
  const index = trimPlayerIndex(await get('/players/nfl'))
  await mkdir(path.dirname(CACHE), { recursive: true })
  await writeFile(CACHE, JSON.stringify(index))
  return index
}

async function optionalJson(file) {
  try { return await readJson(file) } catch { return null }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.username && !opts.joins) {
    console.error('Usage: npm run check-league -- <sleeper-username> [--league <id>] [--week <n>] [--now <ISO>] [--json]\n       npm run check-league -- --joins')
    process.exit(2)
  }

  const now = opts.now ?? new Date()
  const state = await get('/state/nfl')
  if (opts.week) state.week = opts.week
  const season = String(state.season)
  const [playersById, scheduleFile, weeklyManifest, ids] = await Promise.all([
    playerIndex(),
    readJson(path.join(DATA, `schedule-${season}.json`)),
    optionalJson(path.join(DATA, 'weekly/index.json')),
    optionalJson(path.join(DATA, 'player-ids.json')),
  ])

  const joins = checkJoins({ playersById, scheduleFile })
  const reports = []

  if (opts.username) {
    const user = await get(`/user/${encodeURIComponent(opts.username)}`)
    if (!user?.user_id) throw new Error(`No Sleeper user named "${opts.username}".`)
    const leagues = opts.league
      ? [await get(`/league/${opts.league}`)]
      : await get(`/user/${user.user_id}/leagues/nfl/${season}`)
    if (!leagues?.length) console.error(`${opts.username} has no ${season} NFL leagues on Sleeper.`)

    const { statsSeason } = pickStatsSeason(weeklyManifest?.seasons, season)
    const weeklyFile = statsSeason ? await optionalJson(path.join(DATA, `weekly/${statsSeason}.json`)) : null

    for (const league of leagues ?? []) {
      const [rosters, users, matchups] = await Promise.all([
        get(`/league/${league.league_id}/rosters`),
        get(`/league/${league.league_id}/users`),
        get(`/league/${league.league_id}/matchups/${state.week}`),
      ])
      reports.push(checkLeague({
        league, rosters, users, matchups, state, userId: user.user_id, playersById,
        scheduleFile, weeklyManifest, weeklyFile, idsBySleeper: ids?.players ?? {}, now,
      }))
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ now: now.toISOString(), state, joins, reports }, null, 2))
  } else {
    print({ now, state, joins, reports })
  }
  const errors = [...joins.findings, ...reports.flatMap((r) => r.findings)].filter((f) => f.level === 'error')
  process.exit(errors.length ? 1 : 0)
}

const MARK = { error: '✗', warn: '!', info: '·' }

function print({ now, state, joins, reports }) {
  const out = []
  out.push(`Sleeper: ${state.season} week ${state.week} (${state.season_type}) · checked ${now.toLocaleString()}`)
  out.push('')
  out.push(`Data joins — ${joins.scheduleTeams} schedule teams, ${joins.byeWeeks} bye weeks`)
  out.push(...findingLines(joins.findings, '  ✓ every active Sleeper team code joins the schedule'))

  for (const r of reports) {
    out.push('')
    out.push(`━━ ${r.league.name} (${r.league.season}, ${r.league.teams} teams, ${r.league.status})`)
    out.push(`   Slots: ${r.league.slots.join(' ')} + ${r.league.bench} bench`)
    const m = r.mine
    if (m) {
      const rec = m.record
      out.push(`   You: ${m.name}${m.coOwner ? ' (co-owner)' : ''} · ${rec.wins}-${rec.losses}${rec.ties ? `-${rec.ties}` : ''} · week ${r.week} vs ${m.opponent ?? '—'}`)
      out.push('')
      out.push('   Lineup')
      for (const s of m.lineup) {
        const value = s.perGame != null ? `${s.perGame.toFixed(1)} ppg` : ''
        const who = s.name ? `${s.name} ${s.position ?? ''} ${s.team ?? 'FA'}` : '(empty)'
        out.push(`   ${String(s.slot ?? '?').padEnd(11)}${who.padEnd(32)}${value.padEnd(10)}${s.note ?? ''}`)
      }
      const a = m.alerts
      const rd = a.readiness
      out.push('')
      out.push(`   Readiness: ${rd.ready} ready · ${rd.caution} caution · ${rd.problems} problems · ${rd.settled} locked${m.gameDay ? ' · game day' : ''}`)
      if (a.onBye.length) out.push(`   On bye: ${a.onBye.join(', ')}`)
      if (a.injured.length) out.push(`   Injured: ${a.injured.join(', ')}`)
      if (a.emptySlots) out.push(`   Empty slots: ${a.emptySlots}`)
      if (a.nextLock) out.push(`   Next lock: ${new Date(a.nextLock).toLocaleString()}`)
      out.push('')
      const o = m.optimizer
      out.push(`   Best lineup on ${o.basis}: ${o.swaps.length ? `+${o.gain} ppg` : 'no changes'}${o.locked ? ` (${o.locked} locked)` : ''}`)
      for (const s of o.swaps) out.push(`     ${s.slot}: ${s.in} for ${s.out} (+${s.delta})`)
      if (o.unranked) out.push(`     ${o.unranked} player(s) unranked on this basis`)
      if (m.statsNote) out.push(`     ${m.statsNote}`)
      out.push('')
      out.push(m.crunch.length ? '   Bye crunch' : '   Bye crunch: no week leaves you short')
      for (const c of m.crunch) out.push(`     Week ${c.week}: ${c.shortfall} short (${c.positions.join('/')}) — out: ${c.onBye.join(', ')}`)
    }
    out.push('')
    out.push('   Findings')
    out.push(...findingLines(r.findings, '   ✓ nothing unexpected'))
  }
  console.log(out.join('\n'))
}

function findingLines(findings, clean) {
  if (!findings.length) return [clean]
  const order = { error: 0, warn: 1, info: 2 }
  return [...findings].sort((a, b) => order[a.level] - order[b.level])
    .map((f) => `   ${MARK[f.level]} [${f.area}] ${f.message}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
