import { useEffect, useState } from 'react'
import { create } from 'zustand'

export type ThemePreference = 'system' | 'light' | 'dark'
const KEY = 'fcc.theme'

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** One preference for the whole app, so Settings and the shell agree. */
const usePreference = create<{ preference: ThemePreference; set: (p: ThemePreference) => void }>((set) => ({
  preference: read(),
  set: (p) => {
    set({ preference: p })
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  },
}))

/** Light or dark: the system's choice unless the user picked one. */
export function useTheme(): { resolved: 'light' | 'dark'; preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const { preference, set } = usePreference()
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  return { resolved, preference, setPreference: set }
}
