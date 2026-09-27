// Sleeper's /rosters and /users joined into the app's team shape — pure, so the
// real-league check script (scripts/check-league.mjs) runs exactly what the
// pages run.
//
// Three things real leagues do that the first version of this join ignored:
//  - Co-owners. A roster lists them in `co_owners`; matching on `owner_id` alone
//    meant a co-manager connected to the app found no team of their own.
//  - Open teams. An orphaned roster has no `owner_id`. Dropping it removed a
//    team from matchups (joined by roster_id) and from the team count that sets
//    positional lines.
//  - Team names. Sleeper shows `metadata.team_name` when the manager set one;
//    the display name is only the fallback.

/**
 * @param {Array<object>} rosters Sleeper /league/:id/rosters
 * @param {Array<object>} users Sleeper /league/:id/users
 * @returns {Array<{id, rosterId, name, ownerName, memberIds, isOpen, playerIds,
 *   startableIds, starterIds, reserveIds, taxiIds, record, pointsFor, pointsAgainst}>}
 *   `id` is the owner's user id, or `roster-<n>` for an open team so React keys
 *   and lookups stay unique without ever matching a real user.
 *   `playerIds` is everyone on the roster, IR and taxi included — right for
 *   ownership and grading. `startableIds` drops IR and taxi players, whom
 *   Sleeper won't let into a lineup: lineup and bye-week math must use it, or a
 *   player stashed on IR reads as cover for a bye.
 */
export function joinLeagueTeams(rosters, users) {
  const userById = new Map((users ?? []).map((u) => [u.user_id, u]))

  return (rosters ?? []).map((r) => {
    const owner = r.owner_id ? userById.get(r.owner_id) : null
    const ownerName = owner ? owner.display_name || owner.username || null : null
    const teamName = owner?.metadata?.team_name?.trim() || null
    const memberIds = [r.owner_id, ...(r.co_owners ?? [])].filter(Boolean)
    const s = r.settings ?? {}
    const unavailable = new Set([...(r.reserve ?? []), ...(r.taxi ?? [])])

    return {
      id: r.owner_id || `roster-${r.roster_id}`,
      rosterId: r.roster_id,
      name: teamName ?? ownerName ?? `Team ${r.roster_id}`,
      ownerName,
      memberIds,
      isOpen: !r.owner_id,
      playerIds: r.players ?? [],
      startableIds: (r.players ?? []).filter((id) => !unavailable.has(id)),
      starterIds: r.starters ?? [],
      reserveIds: r.reserve ?? [],
      taxiIds: r.taxi ?? [],
      record: { wins: s.wins ?? 0, losses: s.losses ?? 0, ties: s.ties ?? 0 },
      pointsFor: (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
      pointsAgainst: (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100,
    }
  })
}

/** Whether this user owns or co-owns the team. */
export function isMyTeam(team, userId) {
  if (!team || !userId) return false
  return team.id === userId || (team.memberIds ?? []).includes(userId)
}

/** The user's team, preferring one they own over one they co-own. */
export function findMyTeam(teams, userId) {
  if (!userId) return null
  return (teams ?? []).find((t) => t.id === userId) ?? (teams ?? []).find((t) => isMyTeam(t, userId)) ?? null
}
