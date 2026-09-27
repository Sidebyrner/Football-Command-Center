/**
 * Rounding that matches the JavaScript reference and the Swift port exactly:
 * ties go toward +∞ (`Math.round` semantics), to a given number of places.
 * Non-finite input is 0, as the reference coerces it.
 */
export function roundHalfUp(value: number, places: number): number {
  if (!Number.isFinite(value)) return 0
  const factor = places === 0 ? 1 : places === 1 ? 10 : places === 2 ? 100 : places === 3 ? 1000 : 10 ** places
  return Math.floor(value * factor + 0.5) / factor
}

/** A finite number or 0. */
export function finite(value: number | null | undefined): number {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : 0
}
