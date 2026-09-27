// In-season context transforms: injuries, depth charts, usage and team context
// for the current season (docs/IN_SEASON_DATA.md is the contract; the Swift
// decoders are written against that document, so a change here is a change
// there).
//
// Pure: every builder takes parsed CSV rows and returns the payload object the
// main script writes. Nothing here touches the network or the filesystem, which
// is what lets scripts/in-season-context.test.mjs exercise the real transforms
// on ten-row fixtures.
//
// Builders return `_meta` WITHOUT `generated`; the caller stamps that in so the
// timestamp is shared across the four files. Diagnostics that should be logged
// but not published (team codes that failed to normalize) go into the optional
// `diag` argument; join rates and row counts are provenance and stay in `_meta`.

// ── Team codes ────────────────────────────────────────────────────────────────
// nflverse spelling is the house dialect. PFR, ESPN and older nflverse files
// each have a few of their own; these are the ones seen in the wild.
export const TEAM_ALIASES = {
  LAR: 'LA', STL: 'LA', RAM: 'LA',
  SD: 'LAC', SDG: 'LAC',
  OAK: 'LV', LVR: 'LV',
  JAC: 'JAX',
  WSH: 'WAS',
  GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB',
  HTX: 'HOU', RAV: 'BAL', CLT: 'IND', OTI: 'TEN', CRD: 'ARI',
}

export const NFLVERSE_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
])

/**
 * Normalizes a team code to nflverse spelling. Unknown codes pass through
 * unchanged and are recorded in `diag.unknownTeams` so the run can log them.
 * @param {string} code
 * @param {{ unknownTeams?: Set<string>, teams?: Set<string> }} [diag]
 */
export function normalizeTeam(code, diag) {
  const raw = str(code)
  if (!raw) return null
  const up = raw.toUpperCase()
  const out = TEAM_ALIASES[up] ?? up
  const known = diag?.teams ?? NFLVERSE_TEAMS
  if (!known.has(out) && diag?.unknownTeams) diag.unknownTeams.add(raw)
  return out
}

// ── Positions ─────────────────────────────────────────────────────────────────
// Sleeper's dialect (QB RB WR TE K LB DL DB), plus OL/P/LS so an injury report
// for a tackle is still a row. Depth-chart slots (LDE, RILB, NB…) map the same
// way; special-teams slots (H, PR, KR) map to null and are dropped.
const POSITION_GROUP = {
  QB: 'QB',
  RB: 'RB', HB: 'RB', FB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K', PK: 'K',
  LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB', WLB: 'LB', SLB: 'LB',
  RILB: 'LB', LILB: 'LB', LOLB: 'LB', ROLB: 'LB',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', LDE: 'DL', RDE: 'DL', LDT: 'DL', RDT: 'DL', EDGE: 'DL',
  DB: 'DB', CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', NB: 'DB', LCB: 'DB', RCB: 'DB', SAF: 'DB',
  OL: 'OL', G: 'OL', T: 'OL', C: 'OL', OT: 'OL', OG: 'OL', LT: 'OL', RT: 'OL', LG: 'OL', RG: 'OL',
  P: 'P',
  LS: 'LS',
}

/** nflverse/PFR/ESPN position or depth slot → Sleeper dialect, or null. */
export function toPositionGroup(pos) {
  const p = str(pos)
  if (!p) return null
  return POSITION_GROUP[p.toUpperCase()] ?? null
}

// Groups the app rosters. Depth-chart slots, injury rows and usage rows outside
// these are dropped: OL/P/LS have snap counts and injury reports but nothing to
// do with a lineup, and the doc promises decoders exactly this vocabulary. A
// null position (crosswalk miss) is kept rather than guessed.
export const DEPTH_GROUPS = ['QB', 'RB', 'WR', 'TE', 'K', 'LB', 'DL', 'DB']
const ROSTER_GROUPS = new Set(DEPTH_GROUPS)

// ── Field helpers ─────────────────────────────────────────────────────────────
export function str(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' || s === 'NA' ? null : s
}

/** Number, or null when the cell is empty — never 0 for "absent". */
export function numOrNull(v) {
  const s = str(v)
  if (s == null) return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function num(v) {
  return numOrNull(v) ?? 0
}

function field(row, ...names) {
  for (const n of names) if (row[n] !== undefined) return row[n]
  return undefined
}

const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

export function passerRating({ completions, attempts, passing_yards, passing_tds, interceptions }) {
  if (!attempts) return null
  const cl = (x) => Math.max(0, Math.min(2.375, x))
  const a = cl((completions / attempts - 0.3) * 5)
  const b = cl((passing_yards / attempts - 3) * 0.25)
  const c = cl((passing_tds / attempts) * 20)
  const d = cl(2.375 - (interceptions / attempts) * 25)
  return ((a + b + c + d) / 6) * 100
}

const sortedWeeks = (iter) => [...new Set(iter)].filter((w) => w > 0).sort((a, b) => a - b)

// ── Injuries ──────────────────────────────────────────────────────────────────
export const INJURY_FIELDS = ['gsis', 'team', 'pos', 'status', 'practice', 'primary']

const GAME_STATUS = { out: 'Out', doubtful: 'Doubtful', questionable: 'Questionable' }

export function injuryStatus(v) {
  const s = str(v)
  return s ? GAME_STATUS[s.toLowerCase()] ?? null : null
}

export function practiceStatus(v) {
  const s = str(v)?.toLowerCase()
  if (!s) return null
  if (s.startsWith('did not')) return 'DNP'
  if (s.startsWith('limited')) return 'LTD'
  if (s.startsWith('full')) return 'FULL'
  return null
}

/**
 * @param {object[]} rows injuries_{season}.csv
 * @param {number} season
 * @param {{ unknownTeams?: Set<string>, teams?: Set<string> }} [diag]
 */
export function buildInjuries(rows, season, diag) {
  const byWeek = {}
  let kept = 0
  let dropped = 0
  const csvWeeks = new Set()
  for (const r of rows) {
    if (num(r.season) !== season) continue
    if (str(r.season_type) && r.season_type !== 'REG') continue
    const week = num(r.week)
    if (!week) continue
    csvWeeks.add(week)
    const gsis = str(r.gsis_id)
    if (!gsis) continue
    const pos = toPositionGroup(r.position)
    if (!pos || !ROSTER_GROUPS.has(pos)) { dropped++; continue }
    ;(byWeek[week] ??= []).push([
      gsis,
      normalizeTeam(r.team, diag),
      pos,
      injuryStatus(r.report_status),
      practiceStatus(r.practice_status),
      str(r.report_primary_injury) ?? str(r.practice_primary_injury),
    ])
    kept++
  }
  const weeks = sortedWeeks(Object.keys(byWeek).map(Number))
  const latestCsvWeek = csvWeeks.size ? Math.max(...csvWeeks) : null
  return {
    _meta: {
      season,
      source: 'nflverse/nflverse-data injuries',
      weeks,
      rowCount: kept,
      droppedRows: dropped,
      latestCsvWeek,
      latestWeekRows: latestCsvWeek ? (byWeek[latestCsvWeek]?.length ?? 0) : 0,
    },
    fields: INJURY_FIELDS,
    byWeek,
  }
}

// ── Depth charts ──────────────────────────────────────────────────────────────
/**
 * Keeps only the rows at the newest `dt` per team. Feed rows one at a time
 * (`add`) from a streaming reader, or hand the whole array to
 * `latestDepthRows`. The 52 MB season file is ~550k rows; only the ~2k rows of
 * the newest snapshot per team ever live in memory.
 */
export function createLatestDtCollector() {
  const latest = new Map() // team -> { dt, rows }
  return {
    add(row) {
      const team = str(row.team)
      const dt = str(row.dt)
      if (!team || !dt) return
      const cur = latest.get(team)
      if (!cur || dt > cur.dt) latest.set(team, { dt, rows: [row] })
      else if (dt === cur.dt) cur.rows.push(row)
    },
    rows() {
      return [...latest.values()].flatMap((v) => v.rows)
    },
  }
}

export function latestDepthRows(rows) {
  const c = createLatestDtCollector()
  for (const r of rows) c.add(r)
  return c.rows()
}

/**
 * @param {object[]} rows depth_charts_{season}.csv rows (any dt mix; only the
 *   newest snapshot per team is used)
 * @param {number} season
 * @param {{ unknownTeams?: Set<string>, teams?: Set<string> }} [diag]
 */
export function buildDepthCharts(rows, season, diag) {
  const latest = latestDepthRows(rows)
  // team -> group -> gsis -> { rank, slot, name }; the best (lowest) rank wins
  // when a player is listed in more than one slot of the same group.
  const chart = {}
  let asOf = null
  let dropped = 0
  for (const r of latest) {
    const gsis = str(r.gsis_id)
    const group = toPositionGroup(r.pos_abb)
    if (!gsis || !group || !DEPTH_GROUPS.includes(group)) { dropped++; continue }
    const team = normalizeTeam(r.team, diag)
    const dt = str(r.dt)
    if (dt && (!asOf || dt > asOf)) asOf = dt
    const rank = num(r.pos_rank) || 99
    const slot = num(r.pos_slot) || 99
    const entries = ((chart[team] ??= {})[group] ??= new Map())
    const cur = entries.get(gsis)
    if (!cur || rank < cur.rank || (rank === cur.rank && slot < cur.slot)) {
      entries.set(gsis, { rank, slot, name: str(r.player_name) ?? '' })
    }
  }

  const teams = {}
  for (const team of Object.keys(chart).sort()) {
    teams[team] = {}
    for (const group of DEPTH_GROUPS) {
      const entries = chart[team][group]
      if (!entries) continue
      teams[team][group] = [...entries.entries()]
        .sort(([, a], [, b]) => a.rank - b.rank || a.slot - b.slot || a.name.localeCompare(b.name))
        .map(([gsis]) => gsis)
    }
  }
  return {
    _meta: {
      season,
      asOf,
      source: 'nflverse/nflverse-data depth_charts',
      teams: Object.keys(teams).length,
      rowCount: latest.length - dropped,
    },
    teams,
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────────
export const USAGE_FIELDS = [
  'week', 'off_snp', 'off_pct', 'def_snp', 'def_pct',
  'xfp', 'xfp_rush', 'xfp_rec', 'rush_att', 'tgt',
  'ybc_avg', 'yac_avg', 'broken_tackles', 'drops',
]

const isReg = (r) => !str(r.game_type) || r.game_type === 'REG'

/**
 * @param {object} src
 * @param {object[]} src.snapRows  snap_counts_{season}.csv (pfr ids)
 * @param {object[]} src.epRows    ffopportunity ep_weekly_{season}.csv (gsis ids)
 * @param {object[]} src.pfrRushRows advstats_week_rush_{season}.csv (pfr ids)
 * @param {object[]} src.pfrRecRows  advstats_week_rec_{season}.csv (pfr ids)
 * @param {Record<string,string>|Map<string,string>} src.pfrToGsis crosswalk
 * @param {Record<string,{name?:string,position?:string}>} [src.gsisInfo]
 *   crosswalk by gsis id, for names/positions of players only the snap file
 *   knows, and for the "in the crosswalk" join rate
 * @param {number} season
 * @param {{ unknownTeams?: Set<string>, teams?: Set<string> }} [diag]
 */
export function buildUsage({ snapRows = [], epRows = [], pfrRushRows = [], pfrRecRows = [], pfrToGsis, gsisInfo = {} }, season, diag) {
  const toGsis = (pfr) => {
    const id = str(pfr)
    if (!id) return null
    return (pfrToGsis instanceof Map ? pfrToGsis.get(id) : pfrToGsis?.[id]) ?? null
  }
  const players = new Map() // gsis -> Map(week -> record)
  const meta = new Map()    // gsis -> { n, p, t, week }
  const touch = (gsis, week) => {
    const byWeek = players.get(gsis) ?? new Map()
    players.set(gsis, byWeek)
    const rec = byWeek.get(week) ?? { week }
    byWeek.set(week, rec)
    return rec
  }
  const note = (gsis, week, { name, position, team }) => {
    const m = meta.get(gsis) ?? { n: null, p: null, t: null, week: -1 }
    if (name && (!m.n || week >= m.week)) m.n = name
    if (position && (!m.p || week >= m.week)) m.p = position
    if (team && (!m.t || week >= m.week)) m.t = team
    m.week = Math.max(m.week, week)
    meta.set(gsis, m)
  }

  const counts = { ep: [0, 0], snap: [0, 0], pfrRush: [0, 0], pfrRec: [0, 0] }
  // With no crosswalk supplied there is nothing to join against, so every
  // ep row counts as joined rather than every row counting as a miss.
  const hasCrosswalk = Object.keys(gsisInfo).length > 0
  const inCrosswalk = (gsis) => !hasCrosswalk || gsis in gsisInfo

  for (const r of epRows) {
    if (num(r.season) !== season) continue
    const week = num(r.week)
    const gsis = str(r.player_id)
    if (!week || !gsis) continue
    counts.ep[1]++
    if (inCrosswalk(gsis)) counts.ep[0]++
    const rec = touch(gsis, week)
    rec.xfp = round(numOrNull(r.total_fantasy_points_exp), 2)
    rec.xfp_rush = round(numOrNull(r.rush_fantasy_points_exp), 2)
    rec.xfp_rec = round(numOrNull(r.rec_fantasy_points_exp), 2)
    rec.rush_att = numOrNull(r.rush_attempt)
    rec.tgt = numOrNull(r.rec_attempt)
    note(gsis, week, {
      name: str(r.full_name),
      position: toPositionGroup(r.position),
      team: normalizeTeam(r.posteam, diag),
    })
  }

  for (const r of snapRows) {
    if (num(r.season) !== season || !isReg(r)) continue
    const week = num(r.week)
    if (!week) continue
    counts.snap[1]++
    const gsis = toGsis(r.pfr_player_id)
    if (!gsis) continue
    counts.snap[0]++
    const rec = touch(gsis, week)
    rec.off_snp = numOrNull(r.offense_snaps)
    rec.off_pct = round(numOrNull(r.offense_pct), 3)
    rec.def_snp = numOrNull(r.defense_snaps)
    rec.def_pct = round(numOrNull(r.defense_pct), 3)
    note(gsis, week, {
      name: str(r.player),
      position: toPositionGroup(r.position),
      team: normalizeTeam(r.team, diag),
    })
  }

  for (const r of pfrRushRows) {
    if (num(r.season) !== season || !isReg(r)) continue
    const week = num(r.week)
    if (!week) continue
    counts.pfrRush[1]++
    const gsis = toGsis(r.pfr_player_id)
    if (!gsis) continue
    counts.pfrRush[0]++
    const rec = touch(gsis, week)
    rec.ybc_avg = round(numOrNull(r.rushing_yards_before_contact_avg), 2)
    rec.yac_avg = round(numOrNull(r.rushing_yards_after_contact_avg), 2)
    rec.bt_rush ??= numOrNull(r.rushing_broken_tackles)
    rec.bt_rec ??= numOrNull(r.receiving_broken_tackles)
    note(gsis, week, { name: str(r.pfr_player_name), team: normalizeTeam(r.team, diag) })
  }

  for (const r of pfrRecRows) {
    if (num(r.season) !== season || !isReg(r)) continue
    const week = num(r.week)
    if (!week) continue
    counts.pfrRec[1]++
    const gsis = toGsis(r.pfr_player_id)
    if (!gsis) continue
    counts.pfrRec[0]++
    const rec = touch(gsis, week)
    rec.drops = numOrNull(r.receiving_drop)
    if (rec.bt_rec == null) rec.bt_rec = numOrNull(r.receiving_broken_tackles)
    if (rec.bt_rush == null) rec.bt_rush = numOrNull(r.rushing_broken_tackles)
    note(gsis, week, { name: str(r.pfr_player_name), team: normalizeTeam(r.team, diag) })
  }

  const outPlayers = {}
  const outMeta = {}
  const weeks = new Set()
  for (const gsis of [...players.keys()].sort()) {
    const m = meta.get(gsis) ?? {}
    const info = gsisInfo[gsis] ?? {}
    const position = m.p ?? toPositionGroup(info.position)
    if (position && !ROSTER_GROUPS.has(position)) continue
    const tuples = [...players.get(gsis).values()]
      .sort((a, b) => a.week - b.week)
      .map((rec) => {
        weeks.add(rec.week)
        const bt = rec.bt_rush == null && rec.bt_rec == null ? null : (rec.bt_rush ?? 0) + (rec.bt_rec ?? 0)
        return [
          rec.week,
          rec.off_snp ?? null, rec.off_pct ?? null, rec.def_snp ?? null, rec.def_pct ?? null,
          rec.xfp ?? null, rec.xfp_rush ?? null, rec.xfp_rec ?? null,
          rec.rush_att ?? null, rec.tgt ?? null,
          rec.ybc_avg ?? null, rec.yac_avg ?? null, bt, rec.drops ?? null,
        ]
      })
    outPlayers[gsis] = tuples
    outMeta[gsis] = { n: m.n ?? str(info.name), p: position, t: m.t ?? null }
  }

  const rate = ([hit, total]) => (total ? round(hit / total, 4) : null)
  return {
    _meta: {
      season,
      weeks: sortedWeeks(weeks),
      source: 'nflverse snap_counts + pfr_advstats, ffverse ffopportunity',
      playerCount: Object.keys(outPlayers).length,
      rowCounts: { ep: counts.ep[1], snap: counts.snap[1], pfrRush: counts.pfrRush[1], pfrRec: counts.pfrRec[1] },
      joinRates: { ep: rate(counts.ep), snap: rate(counts.snap), pfrRush: rate(counts.pfrRush), pfrRec: rate(counts.pfrRec) },
    },
    fields: USAGE_FIELDS,
    meta: outMeta,
    players: outPlayers,
  }
}

// ── Team context ──────────────────────────────────────────────────────────────
export const CONTEXT_FIELDS = [
  'week', 'opp', 'plays', 'pass_att', 'rush_att', 'pressure_pct', 'sacks',
  'ybc_avg', 'qbr', 'pass_rtg', 'top_tgt_share', 'top2_tgt_share',
]

/**
 * @param {object} src
 * @param {object[]} src.statRows  stats_player_week_{season}.csv, ALL positions
 * @param {object[]} src.pfrPassRows advstats_week_pass_{season}.csv
 * @param {object[]} src.pfrRushRows advstats_week_rush_{season}.csv
 * @param {object[]} src.qbrRows   espn qbr_week_level.csv (all seasons; filtered here)
 * @param {Record<string,string>|Map<string,string>} src.pfrToGsis
 * @param {Record<string,string>|Map<string,string>} src.espnToGsis
 * @param {number} season
 * @param {{ unknownTeams?: Set<string>, teams?: Set<string> }} [diag]
 */
export function buildContext({ statRows = [], pfrPassRows = [], pfrRushRows = [], qbrRows = [], pfrToGsis, espnToGsis }, season, diag) {
  const lookup = (map, key) => {
    const k = str(key)
    if (!k) return null
    return (map instanceof Map ? map.get(k) : map?.[k]) ?? null
  }
  const key = (team, week) => `${team}|${week}`

  // Team-week totals from every player row on that team.
  const tw = new Map()
  for (const r of statRows) {
    if (num(r.season) !== season) continue
    if (str(r.season_type) && r.season_type !== 'REG') continue
    const week = num(r.week)
    const team = normalizeTeam(field(r, 'team', 'recent_team'), diag)
    if (!week || !team) continue
    const k = key(team, week)
    const t = tw.get(k) ?? {
      team, week, opp: null, completions: 0, attempts: 0, passing_yards: 0, passing_tds: 0,
      interceptions: 0, sacks: 0, carries: 0, targets: new Map(), passers: new Map(),
    }
    tw.set(k, t)
    t.opp ??= normalizeTeam(field(r, 'opponent_team', 'opponent'), diag)
    const att = num(field(r, 'attempts'))
    t.completions += num(field(r, 'completions'))
    t.attempts += att
    t.passing_yards += num(field(r, 'passing_yards'))
    t.passing_tds += num(field(r, 'passing_tds'))
    t.interceptions += num(field(r, 'passing_interceptions', 'interceptions'))
    t.sacks += num(field(r, 'sacks_suffered', 'sacks'))
    t.carries += num(field(r, 'carries'))
    const gsis = str(field(r, 'player_id'))
    const tgt = num(field(r, 'targets'))
    if (gsis && tgt) t.targets.set(gsis, (t.targets.get(gsis) ?? 0) + tgt)
    if (gsis && att) t.passers.set(gsis, (t.passers.get(gsis) ?? 0) + att)
  }

  // PFR passing rows per team-week.
  const passRows = new Map()
  for (const r of pfrPassRows) {
    if (num(r.season) !== season || !isReg(r)) continue
    const k = key(normalizeTeam(r.team, diag), num(r.week))
    ;(passRows.get(k) ?? passRows.set(k, []).get(k)).push(r)
  }
  const rushAgg = new Map()
  for (const r of pfrRushRows) {
    if (num(r.season) !== season || !isReg(r)) continue
    const k = key(normalizeTeam(r.team, diag), num(r.week))
    const a = rushAgg.get(k) ?? { carries: 0, ybc: 0 }
    a.carries += num(r.carries)
    a.ybc += num(r.rushing_yards_before_contact)
    rushAgg.set(k, a)
  }
  const qbrByTeamWeek = new Map()
  for (const r of qbrRows) {
    if (num(r.season) !== season) continue
    if (str(r.season_type) && !/^reg/i.test(r.season_type)) continue
    const k = key(normalizeTeam(r.team_abb, diag), num(field(r, 'game_week', 'week_num', 'week')))
    ;(qbrByTeamWeek.get(k) ?? qbrByTeamWeek.set(k, []).get(k)).push(r)
  }

  const teams = {}
  const weeks = new Set()
  const sorted = [...tw.values()].sort((a, b) => a.team.localeCompare(b.team) || a.week - b.week)
  for (const t of sorted) {
    weeks.add(t.week)
    const k = key(t.team, t.week)
    const primaryPasser = [...t.passers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    let pressure = null, sacks = null
    const prs = passRows.get(k)
    if (prs?.length) {
      const match = prs.find((r) => lookup(pfrToGsis, r.pfr_player_id) === primaryPasser)
      const row = match ?? [...prs].sort((a, b) => num(b.times_pressured) + num(b.times_sacked) - num(a.times_pressured) - num(a.times_sacked))[0]
      pressure = round(numOrNull(row.times_pressured_pct), 3)
      sacks = numOrNull(row.times_sacked)
    }

    const ra = rushAgg.get(k)
    const ybc = ra && ra.carries > 0 ? round(ra.ybc / ra.carries, 2) : null

    let qbr = null
    const qrs = qbrByTeamWeek.get(k)
    if (qrs?.length) {
      const match = qrs.find((r) => lookup(espnToGsis, r.player_id) === primaryPasser)
      const row = match
        ?? qrs.find((r) => /^true$/i.test(str(r.qualified) ?? ''))
        ?? [...qrs].sort((a, b) => num(b.qb_plays) - num(a.qb_plays))[0]
      qbr = round(numOrNull(row.qbr_total), 1)
    }

    const rtg = round(passerRating(t), 1)
    const tgtTotal = [...t.targets.values()].reduce((a, b) => a + b, 0)
    const top = [...t.targets.values()].sort((a, b) => b - a)
    const top1 = tgtTotal ? round(top[0] / tgtTotal, 3) : null
    const top2 = tgtTotal ? round(((top[0] ?? 0) + (top[1] ?? 0)) / tgtTotal, 3) : null

    ;(teams[t.team] ??= []).push([
      t.week, t.opp,
      t.attempts + t.carries + t.sacks, t.attempts, t.carries,
      pressure, sacks, ybc, qbr, rtg, top1, top2,
    ])
  }

  return {
    _meta: {
      season,
      weeks: sortedWeeks(weeks),
      source: 'nflverse stats_player_week + pfr_advstats + espn qbr',
      teams: Object.keys(teams).length,
      teamWeeks: sorted.length,
      pfrPassTeamWeeks: [...passRows.keys()].filter((k) => tw.has(k)).length,
      qbrTeamWeeks: [...qbrByTeamWeek.keys()].filter((k) => tw.has(k)).length,
    },
    fields: CONTEXT_FIELDS,
    teams,
  }
}

// ── Crosswalk maps ────────────────────────────────────────────────────────────
/**
 * @param {object[]} idRows dynastyprocess db_playerids.csv
 * @returns {{ pfrToGsis: Map, espnToGsis: Map, gsisInfo: Record<string,{name,position,sleeperId}> }}
 */
export function crosswalkMaps(idRows) {
  const pfrToGsis = new Map()
  const espnToGsis = new Map()
  const gsisInfo = {}
  for (const r of idRows) {
    const gsis = str(r.gsis_id)
    if (!gsis) continue
    const pfr = str(r.pfr_id)
    const espn = str(r.espn_id)
    if (pfr && !pfrToGsis.has(pfr)) pfrToGsis.set(pfr, gsis)
    if (espn && !espnToGsis.has(espn)) espnToGsis.set(espn, gsis)
    gsisInfo[gsis] ??= { name: str(r.name), position: str(r.position), sleeperId: str(r.sleeper_id) }
  }
  return { pfrToGsis, espnToGsis, gsisInfo }
}
