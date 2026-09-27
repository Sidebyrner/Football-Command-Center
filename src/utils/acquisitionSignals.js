// Positional baselines and acquisition signals — pure functions over scanned
// season lines, so they can be tested against the real data without React.
// Moved out of hooks/useAcquisitionBoard.js; that hook re-exports them.

export const FORM_WEEKS = 4
// Below this, a per-game average is an artifact of one hot afternoon and has no
// business setting a positional line.
export const MIN_GAMES_FOR_LINE = 3

/**
 * Dedicated starter slots per position.
 *
 * Flex slots are excluded on purpose. Flex demand is split across RB/WR/TE by
 * whatever each manager happens to start, so charging it fully to every
 * eligible position would count the same slot three times and push all three
 * lines too high. Leaving it out makes the lines mildly conservative — the true
 * last-startable player sits a little below them — which is the safer direction
 * for a page whose job is flagging players you don't already have.
 */
export function starterCountsFrom(template) {
  const counts = {}
  for (const s of template?.starters ?? []) {
    if (s.type === 'starter') counts[s.pos] = (counts[s.pos] ?? 0) + 1
  }
  return counts
}

/**
 * Where the startable and replacement lines sit, on a SEASON per-game basis,
 * built from the same season averages the players are ranked on.
 *
 * Lines are kept at full precision. They used to be rounded to one decimal
 * before the comparison, which pushes the line above the very player who set
 * it: a QB8 averaging 21.96 set a 22.0 line and then failed to clear it. Rounding
 * is a display concern and happens only in the detail strings. Same judgement
 * as the iOS app's Baselines.
 *
 * @param {Array<{position, perGame, games}>} players
 * @param {object} slotTemplate parseRosterPositions() output
 * @param {number} teamCount
 */
export function seasonPaceBaselines(players, slotTemplate, teamCount) {
  if (!slotTemplate || !teamCount || !players?.length) return {}
  const counts = starterCountsFrom(slotTemplate)
  const byPos = {}
  for (const p of players) {
    if (p.games < MIN_GAMES_FOR_LINE || p.perGame == null) continue
    ;(byPos[p.position] ??= []).push(p.perGame)
  }
  const out = {}
  for (const [pos, vals] of Object.entries(byPos)) {
    const starters = Math.round((counts[pos] ?? 0) * teamCount)
    if (!starters) continue
    const desc = vals.sort((a, b) => b - a)
    out[pos] = {
      starters,
      startLine: desc[starters - 1] ?? desc[desc.length - 1],
      replacementLine: desc[starters] ?? null,
    }
  }
  return out
}

const one = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1))

/**
 * Turns a scanned player into the named signals that might flag him. Separate
 * from the scan so it stays pure and testable, and so the UI can show WHICH
 * signal fired rather than a single blended number.
 */
export function signalsFor(p, baselines) {
  const base = baselines?.[p.position]
  const out = []
  if (!base) return out

  if (base.startLine != null && p.perGame >= base.startLine) {
    out.push({ key: 'startable', label: 'Startable production', detail: `${one(p.perGame)} pts/gm vs a ${one(base.startLine)} start line` })
  } else if (base.replacementLine != null && p.perGame >= base.replacementLine) {
    out.push({ key: 'above-replacement', label: 'Above replacement', detail: `${one(p.perGame)} pts/gm vs ${one(base.replacementLine)} replacement` })
  }

  // Usage running ahead of scoring: the buy-low, and the only forward-leaning
  // thing here that is still a fact rather than a forecast.
  if (p.recentTgtShare != null && p.recentTgtShare >= 0.20 && base.startLine != null && p.perGame < base.startLine) {
    out.push({
      key: 'opportunity',
      label: 'Opportunity ahead of production',
      detail: `${Math.round(p.recentTgtShare * 100)}% target share, still under the start line`,
    })
  }

  if (p.formPerGame != null && p.perGame != null && p.games >= FORM_WEEKS && p.formPerGame > p.perGame * 1.25) {
    out.push({ key: 'form', label: 'Heating up', detail: `${one(p.formPerGame)} over the last ${FORM_WEEKS} vs ${one(p.perGame)} on the season` })
  }

  return out
}

