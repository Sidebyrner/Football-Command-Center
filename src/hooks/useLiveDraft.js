// Live draft sync.
//
// Polls Sleeper for picks while a draft is in progress so the board can grey out
// players who are already gone. Without this the board happily shows drafted
// players as available — the single most costly failure mode on draft day.

import { useState, useEffect, useCallback, useRef } from 'react'
import { getLeagueDrafts, getDraftPicksLive, getDraft, getLeagueUsers } from '../services/sleeperService'

const POLL_MS = 10_000

/**
 * Overall pick number for a draft slot in a given round.
 * Snake drafts reverse the order every even round; linear drafts never do.
 */
export function pickNumberFor(slot, round, teams, isSnake) {
  const posInRound = isSnake && round % 2 === 0 ? teams + 1 - slot : slot
  return (round - 1) * teams + posInRound
}

/** Next overall pick at or after `fromPick` belonging to `slot`. */
export function nextPickFor(slot, fromPick, teams, rounds, isSnake) {
  if (!slot || !teams) return null
  for (let round = 1; round <= rounds; round++) {
    const n = pickNumberFor(slot, round, teams, isSnake)
    if (n >= fromPick) return n
  }
  return null
}

export function useLiveDraft(leagueId, userId) {
  const [draft, setDraft] = useState(null)
  const [picks, setPicks] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  // Resolve which draft to follow: an in-progress one wins, else the newest.
  const findDraft = useCallback(async () => {
    if (!leagueId) return null
    const drafts = await getLeagueDrafts(leagueId)
    if (!drafts?.length) return null
    return (
      drafts.find((d) => d.status === 'drafting') ??
      [...drafts].sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0))[0]
    )
  }, [leagueId])

  const refresh = useCallback(async () => {
    if (!leagueId) return
    try {
      const d = await findDraft()
      if (!d) { setDraft(null); setPicks([]); return }
      // Re-read the draft itself so status flips (pre_draft -> drafting -> complete)
      // are picked up mid-session, not just at mount.
      const fresh = await getDraft(d.draft_id).catch(() => d)
      setDraft(fresh ?? d)
      setPicks((await getDraftPicksLive(d.draft_id)) ?? [])
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [leagueId, findDraft])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  // League members, so a drafted player can name who took them.
  useEffect(() => {
    if (!leagueId) return
    let cancelled = false
    getLeagueUsers(leagueId)
      .then((u) => { if (!cancelled) setUsers(u ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [leagueId])

  const isLive = draft?.status === 'drafting'

  // Only poll while the draft is actually running.
  useEffect(() => {
    clearInterval(timerRef.current)
    if (!isLive) return
    timerRef.current = setInterval(refresh, POLL_MS)
    return () => clearInterval(timerRef.current)
  }, [isLive, refresh])

  const userNames = {}
  for (const u of users) userNames[u.user_id] = u.display_name || u.username

  const draftedIds = new Set(picks.map((p) => p.player_id).filter(Boolean))
  const pickByPlayer = {}
  for (const p of picks) {
    if (!p.player_id) continue
    pickByPlayer[p.player_id] = {
      pickNo: p.pick_no ?? null,
      round: p.round ?? null,
      by: userNames[p.picked_by] ?? (p.roster_id ? `Team ${p.roster_id}` : 'Unknown'),
      isMine: !!userId && p.picked_by === userId,
    }
  }

  const teams = draft?.settings?.teams ?? 0
  const rounds = draft?.settings?.rounds ?? 0
  const isSnake = draft?.type !== 'linear'
  const currentPick = picks.length + 1
  const userSlot = userId ? draft?.draft_order?.[userId] ?? null : null
  const myNextPick = nextPickFor(userSlot, currentPick, teams, rounds, isSnake)

  return {
    draft,
    picks,
    draftedIds,
    pickByPlayer,
    isLive,
    loading,
    error,
    teams,
    rounds,
    currentPick,
    currentRound: teams ? Math.floor((currentPick - 1) / teams) + 1 : null,
    userSlot,
    myNextPick,
    picksUntilMyTurn: myNextPick != null ? myNextPick - currentPick : null,
    refresh,
  }
}
