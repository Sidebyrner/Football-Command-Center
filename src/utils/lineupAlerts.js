// "Can I still fix something before kickoff" — the facts behind the Dashboard's
// lineup alerts, as a pure function so they can be tested against the real
// schedule. Same rules as the iOS app's lineup alerts and readiness counts.

import { INJURY_STATUS } from './playerHelpers.js'
import { toNflverseTeam } from './nflTeams.js'

/**
 * @param {object} args
 * @param {string[]} args.starterIds Sleeper's starters, "0" for an unset slot
 * @param {Record<string, {name?, team?, position?, injuryStatus?}>} args.playersById
 * @param {Set<string>} args.byeTeams nflverse team codes on bye this week
 * @param {object|null} args.kickoffs kickoffCalendar() for the season, or null
 * @param {number} args.week
 * @param {Date} [args.now]
 * @returns {{ onBye, emptySlots, injured, locked, nextLock, readiness }}
 *   Starters whose game has kicked off are excluded from every alert — nothing
 *   can be done about them any more — and counted in `locked` instead.
 *   `readiness` counts each slot once: ready, caution, problems, settled.
 */
export function buildLineupAlerts({ starterIds = [], playersById = {}, byeTeams = new Set(), kickoffs = null, week, now = new Date() }) {
  const onBye = []
  const injured = []
  let emptySlots = 0
  let locked = 0
  const readiness = { slots: starterIds.length, ready: 0, caution: 0, problems: 0, settled: 0 }

  for (const id of starterIds) {
    if (!id || id === '0') {
      emptySlots++
      readiness.problems++
      continue
    }
    const p = playersById[id] ?? {}
    const team = p.team ? toNflverseTeam(p.team) : null

    if (kickoffs?.isLocked(team, week, now)) {
      locked++
      readiness.settled++
      continue
    }
    // Byes come from the schedule by absence, which covers every position —
    // including IDP, which the ADP-matched `bye` field never reached.
    if (team && byeTeams.has(team)) {
      onBye.push({ id, name: p.name ?? id, team })
      readiness.problems++
      continue
    }
    const severity = INJURY_STATUS[p.injuryStatus] ?? (p.injuryStatus ? 'caution' : 'start')
    if (severity === 'sit') {
      injured.push({ id, name: p.name ?? id, status: p.injuryStatus, severity })
      readiness.problems++
    } else if (severity === 'caution') {
      injured.push({ id, name: p.name ?? id, status: p.injuryStatus, severity })
      readiness.caution++
    } else {
      readiness.ready++
    }
  }

  const nextLock = kickoffs
    ? kickoffs.nextLock(week, starterIds.filter((id) => id && id !== '0').map((id) => playersById[id]?.team), now)
    : null

  return { onBye, emptySlots, injured, locked, nextLock, readiness }
}
