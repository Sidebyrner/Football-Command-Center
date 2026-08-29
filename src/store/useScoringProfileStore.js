import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PROFILE, parseScoringFile, buildProfile } from '../utils/scoringProfile'

const useScoringProfileStore = create(
  persist(
    (set, get) => ({
      activeProfile: DEFAULT_PROFILE,
      profileHistory: [],
      uploadError: null,
      uploading: false,
      // Set when the profile came from the league itself rather than a guess.
      pprFormat: null,      // { value, label }
      unmappedRules: [],    // Sleeper rules this app does not model
      syncedAt: null,
      syncError: null,

      /**
       * Adopt the league's real scoring rules, pulled from Sleeper.
       * Preferred over the hardcoded default and over file upload — it is the
       * league's own configuration rather than an assumption about it.
       */
      applyLeagueScoring: ({ profile, ppr, unmapped }) => {
        if (!profile) {
          set({ syncError: 'League returned no scoring settings.' })
          return
        }
        const prev = get().activeProfile
        set({
          activeProfile: profile,
          profileHistory: [prev, ...get().profileHistory].slice(0, 5),
          pprFormat: ppr,
          unmappedRules: unmapped ?? [],
          syncedAt: new Date().toISOString(),
          syncError: null,
          uploadError: null,
        })
      },

      setSyncError: (msg) => set({ syncError: msg }),

      uploadScoringFile: (text, filename) => {
        set({ uploading: true, uploadError: null })
        const { parsed, errors } = parseScoringFile(text)

        if (errors.length && Object.keys(parsed).length === 0) {
          set({ uploadError: errors, uploading: false })
          return { success: false, errors }
        }

        const name = filename
          ? filename.replace(/\.[^.]+$/, '')
          : `Uploaded ${new Date().toLocaleString()}`

        const profile = buildProfile(parsed, name)
        const prev = get().activeProfile
        const history = [prev, ...get().profileHistory].slice(0, 5)

        set({
          activeProfile: profile, profileHistory: history, uploading: false,
          uploadError: errors.length ? errors : null,
          pprFormat: { value: profile.receptionPoints ?? 0, label: profile.receptionPoints ? `${profile.receptionPoints} PPR` : 'Non-PPR (standard)' },
          syncedAt: null,
        })
        return { success: true, errors, profile }
      },

      resetToDefault: () => {
        const prev = get().activeProfile
        const history = [prev, ...get().profileHistory].slice(0, 5)
        set({
          activeProfile: DEFAULT_PROFILE, profileHistory: history, uploadError: null,
          pprFormat: null, unmappedRules: [], syncedAt: null, syncError: null,
        })
      },

      clearUploadError: () => set({ uploadError: null }),
    }),
    { name: 'fcc-scoring-profile' }
  )
)

export default useScoringProfileStore
