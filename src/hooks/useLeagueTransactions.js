// This league's real waiver-wire activity. Sleeper reports every add/drop/
// trade per week via getTransactions (already in sleeperApi.js, now wrapped
// with caching in sleeperService.js); this hook filters to waivers and
// resolves player identity, falling back to Sleeper's raw player index for
// anyone (e.g. IDP) missing from the caller's main player pool.

import { useState, useEffect, useMemo } from 'react'
import { getLeagueTransactions } from '../services/sleeperService'
import { useMissingPlayerMeta } from './useMissingPlayerMeta'

/**
 * @param {Record<string, {id, name, position, team}>} playersById
 * @returns {{ transactions: Array<{id, created, rosterId, adds, drops}>, loading, error }}
 *   `adds`/`drops` are arrays of resolved player objects.
 */
export function useLeagueTransactions(leagueId, week, playersById) {
  const [raw, setRaw] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!leagueId || !week) { setLoading(false); return }
    let cancelled = false
    setLoading(true)

    getLeagueTransactions(leagueId, week)
      .then((data) => {
        if (cancelled) return
        setRaw((data ?? []).filter((t) => t.type === 'waiver' && t.status === 'complete'))
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [leagueId, week])

  const missingIds = useMemo(() => {
    const ids = new Set()
    for (const t of raw) {
      for (const id of Object.keys(t.adds ?? {})) if (!playersById[id]) ids.add(id)
      for (const id of Object.keys(t.drops ?? {})) if (!playersById[id]) ids.add(id)
    }
    return [...ids]
  }, [raw, playersById])
  const idpMeta = useMissingPlayerMeta(missingIds)

  const transactions = useMemo(() => {
    const resolve = (id) => playersById[id] ?? idpMeta[id] ?? null
    return raw
      .map((t) => ({
        id: t.transaction_id,
        created: t.created,
        rosterId: t.roster_ids?.[0] ?? null,
        adds: Object.keys(t.adds ?? {}).map(resolve).filter(Boolean),
        drops: Object.keys(t.drops ?? {}).map(resolve).filter(Boolean),
      }))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
  }, [raw, playersById, idpMeta])

  return { transactions, loading, error }
}
