// Imports server-relayed news feeds into the research store.
//
// Mirrors useLeagueScoring's shape (explicit action, loading/error state) —
// this is a deliberate user action, not something that runs automatically,
// so imported articles never appear in the feed without the user asking for
// them, the same principle behind removing auto-sync from Settings.

import { useState, useCallback } from 'react'
import { fetchRSSFeed, NEWS_SOURCES } from '../utils/researchAdapters'
import { hasApiProxy } from '../utils/apiBase'
import useResearchStore from '../store/useResearchStore'

export function useNewsImport() {
  const items = useResearchStore((s) => s.items)
  const addItem = useResearchStore((s) => s.addItem)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const importNews = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (!hasApiProxy) {
        setError('No API proxy configured. Set VITE_API_BASE_URL in your .env file, then restart npm run dev.')
        return 0
      }

      const known = new Set(items.filter((i) => i.source === 'rss').map((i) => i.sourceId))
      const results = await Promise.allSettled(NEWS_SOURCES.map((s) => fetchRSSFeed(s.alias)))

      let fetchedTotal = 0
      let addedTotal = 0
      const failed = []

      results.forEach((result, i) => {
        const { label } = NEWS_SOURCES[i]
        if (result.status === 'rejected') {
          failed.push(`${label} (${result.reason.message})`)
          return
        }
        const fetched = result.value
        fetchedTotal += fetched.length
        for (const item of fetched) {
          if (known.has(item.sourceId)) continue
          known.add(item.sourceId)
          addItem(item)
          addedTotal++
        }
      })

      if (failed.length === NEWS_SOURCES.length) {
        // Every source failed — this is the case that used to be
        // indistinguishable from "the feeds are just empty."
        setError(`Couldn't reach any news source — ${failed.join('; ')}. Check that the server container is running and reachable.`)
      } else if (failed.length > 0) {
        const addedNote = addedTotal > 0 ? `${addedTotal} new article${addedTotal === 1 ? '' : 's'} added` : 'nothing new'
        setNotice(`${addedNote}. ${failed.length} source${failed.length > 1 ? 's' : ''} unavailable — ${failed.join('; ')}.`)
      } else if (addedTotal === 0) {
        // The original bug this replaces: checking only fetchedTotal === 0
        // meant a feed full of already-imported articles looked identical
        // to "nothing happened," with no way to tell the difference.
        setNotice(`Checked ${fetchedTotal} article${fetchedTotal === 1 ? '' : 's'} across ${NEWS_SOURCES.length} sources — already up to date, nothing new.`)
      }
      return addedTotal
    } catch (err) {
      setError(err.message)
      return 0
    } finally {
      setLoading(false)
    }
  }, [items, addItem])

  return { importNews, loading, error, notice, hasApiProxy }
}
