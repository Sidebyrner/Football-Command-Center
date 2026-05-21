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

        set({ activeProfile: profile, profileHistory: history, uploading: false, uploadError: errors.length ? errors : null })
        return { success: true, errors, profile }
      },

      resetToDefault: () => {
        const prev = get().activeProfile
        const history = [prev, ...get().profileHistory].slice(0, 5)
        set({ activeProfile: DEFAULT_PROFILE, profileHistory: history, uploadError: null })
      },

      clearUploadError: () => set({ uploadError: null }),
    }),
    { name: 'fcc-scoring-profile' }
  )
)

export default useScoringProfileStore
