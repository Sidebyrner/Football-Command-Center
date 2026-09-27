/**
 * Forgiving player-name search — a port of FCCore `FuzzyNameMatch`. Every word
 * typed must land on some word of the name or team, in any order, by prefix,
 * containment or a small typo.
 */

/** Higher is better; `undefined` when any typed word matches nothing. */
export function fuzzyScore(query: string, name: string, extra: readonly string[] = []): number | undefined {
  const wanted = nameWords(query)
  if (wanted.length === 0) return undefined
  const targets = [...nameWords(name), ...extra.flatMap(nameWords)]
  if (targets.length === 0) return undefined
  let total = 0
  for (const word of wanted) {
    const scores = targets.map((t) => wordScore(word, t)).filter((s): s is number => s !== undefined)
    if (scores.length === 0) return undefined
    total += Math.max(...scores)
  }
  return total
}

/** Apostrophes and hyphens join, dots drop, then split on anything else. */
export function nameWords(text: string): string[] {
  return text.toLowerCase().replace(/['’.-]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** 4 exact, 3 prefix, 2 contained, 1 within typo distance. */
export function wordScore(typed: string, target: string): number | undefined {
  if (typed === target) return 4
  if (target.startsWith(typed)) return 3
  const typedChars = [...typed]
  if (typedChars.length >= 3 && target.includes(typed)) return 2
  const allowed = typedChars.length >= 8 ? 2 : typedChars.length >= 4 ? 1 : 0
  if (allowed === 0) return undefined
  const prefix = [...target].slice(0, typedChars.length).join('')
  if (editDistance(typed, target, allowed) <= allowed) return 1
  if ([...prefix].length === typedChars.length && editDistance(typed, prefix, allowed) <= allowed) return 1
  return undefined
}

/** Damerau–Levenshtein, stopping once every path exceeds `limit`. */
export function editDistance(aText: string, bText: string, limit: number): number {
  const a = [...aText]
  const b = [...bText]
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous2 = new Array<number>(b.length + 1).fill(0)
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    let rowMin = current[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, previous2[j - 2]! + 1)
      current[j] = value
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > limit) return limit + 1
    ;[previous2, previous, current] = [previous, current, previous2]
  }
  return previous[b.length]!
}
