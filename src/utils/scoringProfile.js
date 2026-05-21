// Scoring profile management — parse, validate, persist, and expose league scoring rules.
// The DEFAULT_PROFILE reflects the non-standard league settings described in the prompt.
// Uploaded files replace it; the profile drives all evaluation formula weights.

export const DEFAULT_PROFILE = {
  id: 'default-2026',
  name: 'League Default (2026)',
  uploadedAt: null,
  // ── Passing ──────────────────────────────────────────────────────────────
  passingYardsPerPoint: 20,          // 1 pt per 20 yds  → 0.05 pts/yd
  passingTD: 6,
  passingFirstDown: 1,
  incompletion: -1,
  sackTaken: -1,
  interception: -5,
  pickSix: -10,
  passing300Bonus: 3,
  passing400Bonus: 6,
  completions25Bonus: 3,
  // ── Rushing ──────────────────────────────────────────────────────────────
  rushingYardsPerPoint: 10,          // 1 pt per 10 yds
  rushingTD: 6,
  rushingFirstDown: 1,
  rushing100Bonus: 3,
  rushing200Bonus: 6,
  // ── Receiving ────────────────────────────────────────────────────────────
  receptionPoints: 0,                // NOT PPR
  receivingYardsPerPoint: 10,
  receivingTD: 6,
  receivingFirstDown: 1,
  receiving100Bonus: 3,
  receiving200Bonus: 6,
  // ── Kicker ───────────────────────────────────────────────────────────────
  fg0to39: 3,
  fg40to49: 4,
  fg50to59: 5,
  fg60plus: 6,
  xp: 1,
  missedFG: -2,
  // ── Defense / Team DEF ────────────────────────────────────────────────────
  defSack: 1,
  defInterception: 3,
  defFumbleRecovery: 2,
  defTD: 6,
  defSafety: 2,
  defPointsAllowed0: 12,
  defPointsAllowed1to6: 9,
  defPointsAllowed7to13: 6,
  defPointsAllowed14to20: 3,
  defPointsAllowed21to27: 1,
  defPointsAllowed28to34: 0,
  defPointsAllowedOver35: -3,
  // ── IDP ──────────────────────────────────────────────────────────────────
  idpTackle: 1,
  idpSack: 3,
  idpInterception: 5,
  idpFumbleRecovery: 3,
  idpTD: 6,
  idpPassDefended: 1,
}

// ── Known scoring event name synonyms ────────────────────────────────────────
const EVENT_ALIASES = {
  'pass_yd': 'passingYardsPerPoint',
  'pass_td': 'passingTD',
  'pass_fd': 'passingFirstDown',
  'inc': 'incompletion',
  'pass_inc': 'incompletion',
  'sack': 'sackTaken',
  'int': 'interception',
  'pick_six': 'pickSix',
  'rush_yd': 'rushingYardsPerPoint',
  'rush_td': 'rushingTD',
  'rush_fd': 'rushingFirstDown',
  'rec': 'receptionPoints',
  'rec_yd': 'receivingYardsPerPoint',
  'rec_td': 'receivingTD',
  'rec_fd': 'receivingFirstDown',
  'fg_0_39': 'fg0to39',
  'fg_40_49': 'fg40to49',
  'fg_50_59': 'fg50to59',
  'fg_60_plus': 'fg60plus',
  'xp_made': 'xp',
  'fg_miss': 'missedFG',
  'def_sack': 'defSack',
  'def_int': 'defInterception',
  'def_fr': 'defFumbleRecovery',
  'def_td': 'defTD',
  'def_safety': 'defSafety',
}

// ── Parse a text/CSV scoring file ─────────────────────────────────────────────
// Expected format: one rule per line, "event_name,value" or "event_name: value"
export function parseScoringFile(text) {
  const errors = []
  const parsed = {}

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  for (const line of lines) {
    if (line.startsWith('#') || line.startsWith('//')) continue

    const match = line.match(/^([a-zA-Z0-9_]+)\s*[,:\s]\s*(-?[\d.]+)/)
    if (!match) {
      errors.push(`Unrecognized line: "${line}"`)
      continue
    }

    const rawKey = match[1].toLowerCase()
    const value = parseFloat(match[2])

    if (isNaN(value)) {
      errors.push(`Invalid value for "${rawKey}"`)
      continue
    }

    const fieldKey = EVENT_ALIASES[rawKey] || rawKey
    if (!(fieldKey in DEFAULT_PROFILE) && fieldKey !== rawKey) {
      errors.push(`Unknown scoring event "${rawKey}" — skipped`)
      continue
    }

    parsed[fieldKey] = value
  }

  return { parsed, errors }
}

// ── Build a full profile by merging parsed values onto the default ─────────────
export function buildProfile(parsed, name = 'Uploaded Profile') {
  return {
    ...DEFAULT_PROFILE,
    ...parsed,
    id: `uploaded-${Date.now()}`,
    name,
    uploadedAt: new Date().toISOString(),
  }
}

// ── Format boost classification helpers ──────────────────────────────────────
// Returns a qualitative label explaining whether a player type benefits from
// the current scoring profile versus a standard PPR league.
export function getFormatImpact(profile, position) {
  const impacts = []

  if (position === 'QB') {
    if (profile.passingFirstDown >= 1)
      impacts.push({ type: 'boost', text: `+${profile.passingFirstDown} per passing 1st down rewards volume passers` })
    if (profile.incompletion <= -1)
      impacts.push({ type: 'penalty', text: `${profile.incompletion} per incompletion punishes low-accuracy QBs` })
    if (profile.pickSix <= -8)
      impacts.push({ type: 'penalty', text: `${profile.pickSix} pick-six penalty elevates ball-security` })
    if (profile.passingTD >= 6)
      impacts.push({ type: 'boost', text: `${profile.passingTD}-pt passing TDs premium scoring` })
  }

  if (position === 'RB') {
    if (profile.rushingFirstDown >= 1)
      impacts.push({ type: 'boost', text: `+${profile.rushingFirstDown} per rushing 1st down rewards short-yardage runners` })
    if (profile.receptionPoints === 0)
      impacts.push({ type: 'penalty', text: 'Non-PPR format hurts pass-catching backs' })
  }

  if (position === 'WR' || position === 'TE') {
    if (profile.receptionPoints === 0)
      impacts.push({ type: 'penalty', text: 'Non-PPR: reception volume has no direct value' })
    if (profile.receivingFirstDown >= 1)
      impacts.push({ type: 'boost', text: `+${profile.receivingFirstDown} per receiving 1st down rewards chains-the-chains receivers` })
  }

  if (position === 'K') {
    if (profile.fg60plus >= 6)
      impacts.push({ type: 'boost', text: `${profile.fg60plus} pts for 60+ yd FGs — leg strength matters` })
    if (profile.fg50to59 >= 5)
      impacts.push({ type: 'boost', text: `${profile.fg50to59} pts for 50-59 yd FGs — high-upside kickers shine` })
  }

  if (position === 'DEF') {
    if (profile.defInterception >= 3)
      impacts.push({ type: 'boost', text: `Turnovers heavily rewarded (INT=${profile.defInterception}, FR=${profile.defFumbleRecovery})` })
    if (profile.defPointsAllowed0 >= 10)
      impacts.push({ type: 'boost', text: `Strong shutout bonus (${profile.defPointsAllowed0} pts for 0 PA)` })
  }

  return impacts
}
