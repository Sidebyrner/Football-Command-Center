// Live draft sync.
//
// Polls Sleeper for picks while a draft is in progress so the board can grey out
// players who are already gone. Without this the board happily shows drafted
// players as available — the single most costly failure mode on draft day.

import { useState, useEffect, useCallback, useRef } from 'react'
import { getLeagueDrafts, getDraftPicksLive, getDraft, getLeagueUsers } from '../services/sleeperService'

const POLL_MS = 10_000
// Slower cadence before the draft goes live — this is what catches Sleeper
// flipping pre_draft -> drafting without the user having to reload the page.
const PRE_DRAFT_POLL_MS = 30_000

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

/** Inverse of pickNumberFor: which slot is on the clock for a given overall pick. */
export function slotForPick(pickNo, teams, isSnake) {
  if (!teams) return null
  const round = Math.floor((pickNo - 1) / teams) + 1
  const posInRound = ((pickNo - 1) % teams) + 1
  return isSnake && round % 2 === 0 ? teams + 1 - posInRound : posInRound
}

/**
 * @param {string} leagueId
 * @param {string} userId
 * @param {{ draftIdOverride?: string }} [options] - draftIdOverride points
 *   the sync at an arbitrary Sleeper draft_id (e.g. a mock draft for
 *   practice) instead of deriving one from leagueId. Used for practice mode.
 */
export function useLiveDraft(leagueId, userId, options = {}) {
  const { draftIdOverride } = options
  const [draft, setDraft] = useState(null)
  const [picks, setPicks] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const refreshingRef = useRef(false)
  // Client-side proxy for "when did the current pick start" — Sleeper's picks
  // list has no timestamp for the in-progress pick, only completed ones. This
  // resets whenever the picks count changes, so it's accurate to within one
  // poll interval, not to the second. On a page load mid-draft it starts from
  // load time rather than the pick's true start, which is the one case this
  // approximation can't do better than.
  const picksLengthRef = useRef(0)
  const pickStartedAtRef = useRef(Date.now())

  // Resolve which draft to follow: an explicit override wins outright;
  // otherwise an in-progress league draft wins, else the newest.
  const findDraft = useCallback(async (force = false) => {
    if (draftIdOverride) return { draft_id: draftIdOverride }
    if (!leagueId) return null
    const drafts = await getLeagueDrafts(leagueId, force)
    if (!drafts?.length) return null
    return (
      drafts.find((d) => d.status === 'drafting') ??
      [...drafts].sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0))[0]
    )
  }, [leagueId, draftIdOverride])

  // force also bypasses the league-drafts cache (via findDraft) — used for
  // the slower pre-draft poll, where noticing a draft going live sooner than
  // the next natural cache expiry is the entire point of polling at all.
  const refresh = useCallback(async (force = false) => {
    if (!leagueId && !draftIdOverride) return
    // Guard against overlapping polls if a request runs long — a second
    // tick firing mid-request would otherwise race the first's state update.
    if (refreshingRef.current) return
    refreshingRef.current = true
    try {
      const d = await findDraft(force)
      if (!d) { setDraft(null); setPicks([]); return }
      // Re-read the draft itself so status flips (pre_draft -> drafting -> complete)
      // are picked up mid-session, not just at mount.
      const fresh = await getDraft(d.draft_id).catch(() => d)
      setDraft(fresh ?? d)
      const newPicks = (await getDraftPicksLive(d.draft_id)) ?? []
      if (newPicks.length !== picksLengthRef.current) {
        picksLengthRef.current = newPicks.length
        pickStartedAtRef.current = Date.now()
      }
      setPicks(newPicks)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      refreshingRef.current = false
    }
  }, [leagueId, draftIdOverride, findDraft])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh().finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  // League members, so a drafted player can name who took them. Skipped in
  // practice mode — a mock draft's picks come from Sleeper's bot pool, not
  // this league's roster, so there's nothing real to resolve names against.
  useEffect(() => {
    if (!leagueId || draftIdOverride) return
    let cancelled = false
    getLeagueUsers(leagueId)
      .then((u) => { if (!cancelled) setUsers(u ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [leagueId, draftIdOverride])

  const isLive = draft?.status === 'drafting'

  // Keep polling even before the draft is live, just slower — otherwise the
  // one-time mount fetch is the only chance to ever notice the draft start,
  // and the app sits on "Pre-draft" until the user manually reloads.
  useEffect(() => {
    clearInterval(timerRef.current)
    if (isLive) {
      timerRef.current = setInterval(() => refresh(false), POLL_MS)
    } else {
      timerRef.current = setInterval(() => refresh(true), PRE_DRAFT_POLL_MS)
    }
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

  // Who's on the clock right now, by name if we have it.
  const currentSlot = isLive ? slotForPick(currentPick, teams, isSnake) : null
  let onClockName = null
  if (currentSlot != null) {
    const slotToUserId = {}
    for (const [uid, slot] of Object.entries(draft?.draft_order ?? {})) slotToUserId[slot] = uid
    const onClockUserId = slotToUserId[currentSlot]
    onClockName = (onClockUserId && userNames[onClockUserId]) || `Slot ${currentSlot}`
  }

  const pickTimerSeconds = draft?.settings?.pick_timer || null

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
    currentSlot,
    onClockName,
    pickTimerSeconds,
    pickStartedAt: pickStartedAtRef.current,
    refresh,
  }
}
