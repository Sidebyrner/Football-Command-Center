// Write-through sync of the draft plan to the server (B3).
//
// localStorage remains the source of truth by design — this hook only ever
// reads from useMockDraftStore and pushes outward. It never writes back into
// the store, so a server outage, a bad response, or the container simply
// being off can never cost the user their local plan. The phone view reads
// this copy; if it goes stale, that's the entire blast radius.

import { useEffect, useRef } from 'react'
import useMockDraftStore from '../store/useMockDraftStore'
import { API_BASE, hasApiProxy } from '../utils/apiBase'

const DEBOUNCE_MS = 1500

export function usePlanSync() {
  const targets = useMockDraftStore((s) => s.targets)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!hasApiProxy) return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      fetch(`${API_BASE}/api/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets }),
      }).catch(() => {
        // Best-effort. Never surfaced as an error to the user — see the
        // module comment. A failed sync is a stale phone view, nothing more.
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timerRef.current)
  }, [targets])
}
