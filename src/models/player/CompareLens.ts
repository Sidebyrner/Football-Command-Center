/**
 * Which question a comparison answers — a port of FCApp `CompareLens.swift`.
 * The same players and the same grid, two different calls: who to start this
 * week, or who to keep and add for the rest of the season.
 */
export type CompareLens = 'thisWeek' | 'restOfSeason'

/** Swift's `CompareLens.allCases`. */
export const COMPARE_LENSES: readonly CompareLens[] = ['thisWeek', 'restOfSeason']

export const COMPARE_LENS_LABEL: Readonly<Record<CompareLens, string>> = {
  thisWeek: 'This week',
  restOfSeason: 'Rest of season',
}

export const COMPARE_LENS_QUESTION: Readonly<Record<CompareLens, string>> = {
  thisWeek: 'Who starts this week',
  restOfSeason: 'Who to keep, add or drop',
}
