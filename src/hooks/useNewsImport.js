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
  const [notice, setNotice] = useState(null)

  const importFeed = useCallback(async (feedAlias) => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (!hasApiProxy) {
        setError('No API proxy configured. Set VITE_API_BASE_URL in your .env file, then restart npm run dev.')
        return 0
      }

      const fetched = await fetchRSSFeed(feedAlias)
      const known = new Set(
        items.filter((i) => i.source === 'rss').map((i) => i.sourceId)
      )
      const added = fetched.filter((i) => !known.has(i.sourceId))
      added.forEach((item) => addItem(item))

      if (fetched.length === 0) {
        // fetchRSSFeed degrades a network/server error to [] by design (a
        // dead proxy must never break this page) — so this could mean the
        // feed genuinely had nothing, OR the request to the proxy failed.
        // Those are different problems; say so rather than picking one.
        setError('No articles came back — either the feed is empty or the server request failed. Check that the container is running and reachable.')
      } else if (added.length === 0) {
        // The real bug this replaces: checking only fetched.length === 0
        // meant a feed full of already-imported articles looked identical
        // to "nothing happened," with no way to tell the difference.
        setNotice(`Checked ${fetched.length} article${fetched.length > 1 ? 's' : ''} — already up to date, nothing new.`)
      }
      return added.length
    } catch (err) {
      setError(err.message)
      return 0
    } finally {
      setLoading(false)
    }
  }, [items, addItem])

  return { importFeed, loading, error, notice, hasApiProxy }
}
