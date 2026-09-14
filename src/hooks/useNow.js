// The current time, re-read on an interval, so anything computed from it —
// lineup locks, countdowns — updates without a reload.

import { useEffect, useState } from 'react'

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
