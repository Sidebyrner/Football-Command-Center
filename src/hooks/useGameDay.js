// Whether now is inside the game-day window, and what that means for how fresh
// the player pool — and so every injury tag — has to be.

import { useMemo } from 'react'
import useAppStore from '../store/useAppStore'
import { useSchedule } from './useSchedule'
import { useNow } from './useNow'
import { useNflState } from './useNflState'
import { kickoffCalendar, isGameDay, playersMaxAge, ORDINARY_PLAYERS_MAX_AGE_MS } from '../utils/gameClock'

export function useGameDay() {
  const season = useAppStore((s) => s.season)
  // Sleeper's week, not the hand-typed Settings value, which goes stale.
  const settingsWeek = useAppStore((s) => s.currentWeek)
  const { week: liveWeek } = useNflState(settingsWeek)
  const currentWeek = liveWeek ?? settingsWeek
  const { file } = useSchedule(season, currentWeek)
  const now = useNow(5 * 60 * 1000)

  return useMemo(() => {
    if (!file || !currentWeek) {
      return { kickoffs: null, gameDay: false, playersMaxAgeMs: ORDINARY_PLAYERS_MAX_AGE_MS }
    }
    const kickoffs = kickoffCalendar(file)
    const week = Number(currentWeek)
    return {
      kickoffs,
      gameDay: isGameDay(kickoffs, week, now),
      playersMaxAgeMs: playersMaxAge(kickoffs, week, now),
    }
  }, [file, currentWeek, now])
}
