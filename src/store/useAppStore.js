import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useAppStore = create(
  persist(
    (set, get) => ({
      // User / league identity
      sleeperUsername: '',
      sleeperUserId: null,
      leagueId: null,
      leagueName: '',
      availableLeagues: [],

      // Season / week
      season: import.meta.env.VITE_DEFAULT_SEASON || '2026',
      currentWeek: Number(import.meta.env.VITE_DEFAULT_WEEK) || 1,

      // API keys
      oddsApiKey: import.meta.env.VITE_ODDS_API_KEY || '',

      // Setup state
      isConfigured: false,

      // Actions
      setSleeperUsername: (username) => set({ sleeperUsername: username }),
      setSleeperUserId: (id) => set({ sleeperUserId: id }),
      setLeagueId: (id) => set({ leagueId: id }),
      setLeagueName: (name) => set({ leagueName: name }),
      setAvailableLeagues: (leagues) => set({ availableLeagues: leagues }),
      setSeason: (season) => set({ season }),
      setCurrentWeek: (week) => set({ currentWeek: week }),
      setOddsApiKey: (key) => set({ oddsApiKey: key }),
      setIsConfigured: (val) => set({ isConfigured: val }),

      saveSettings: ({ sleeperUserId, leagueId, leagueName, currentWeek, oddsApiKey, season }) => {
        set({
          sleeperUserId,
          leagueId,
          leagueName,
          currentWeek,
          oddsApiKey,
          season,
          isConfigured: true,
        })
      },

      reset: () =>
        set({
          sleeperUsername: '',
          sleeperUserId: null,
          leagueId: null,
          leagueName: '',
          availableLeagues: [],
          isConfigured: false,
        }),
    }),
    {
      name: 'fcc-app-store',
    }
  )
)

export default useAppStore
