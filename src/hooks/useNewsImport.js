// Imports a server-relayed news feed into the research store.
//
// Mirrors useLeagueScoring's shape (explicit action, loading/error state) —
// this is a deliberate user action, not something that runs automatically,
// so imported articles never appear in the feed without the user asking for
// them, the same principle behind removing auto-sync from Settings.

import { useState, useCallback } from 'react'
import { fetchRSSFeed } from '../utils/researchAdapters'
import { hasApiProxy } from '../utils/apiBase'
import useResearchStore from '../store/useResearchStore'

export function useNewsImport() {
  const items = useResearchStore((s) => s.items)
  const addItem = useResearchStore((s) => s.addItem)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const importFeed = useCallback(async (feedAlias) => {
    setLoading(true)
    setError(null)
    try {
      const fetched = await fetchRSSFeed(feedAlias)
      const known = new Set(
        items.filter((i) => i.source === 'rss').map((i) => i.sourceId)
      )
      const added = fetched.filter((i) => !known.has(i.sourceId))
      added.forEach((item) => addItem(item))
      if (fetched.length === 0) {
        setError(hasApiProxy ? 'Feed returned no items.' : 'No API proxy configured — see Settings.')
      }
      return added.length
    } catch (err) {
      setError(err.message)
      return 0
    } finally {
      setLoading(false)
    }
  }, [items, addItem])

  return { importFeed, loading, error, hasApiProxy }
}
