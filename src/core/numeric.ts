/**
 * Numeric helpers the Swift side gets from libm and Foundation: `erf` and
 * printf-style fixed formatting. The stream parity tests compare to 1e-6, so
 * `erf` has to be accurate to double precision, not a textbook approximation.
 */

/**
 * The error function, W. J. Cody's rational Chebyshev approximations
 * (Math. Comp. 1969), accurate to ~1e-16 across the real line.
 */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN
  const ax = Math.abs(x)
  if (ax < 0.5) {
    const t = x * x
    const top = (((0.185777706184603153 * t + 3.16112374387056560) * t + 113.864154151050156) * t + 377.485237685302021) * t + 3209.37758913846947
    const bot = (((t + 23.6012909523441209) * t + 244.024637934444173) * t + 1282.61652607737228) * t + 2844.23683343917062
    return (x * top) / bot
  }
  return x < 0 ? -1 + erfcPositive(ax) : 1 - erfcPositive(ax)
}

/** erfc for x ≥ 0.5. */
function erfcPositive(x: number): number {
  let r: number
  if (x < 4) {
    const top = (((((((2.15311535474403846e-8 * x + 0.564188496988670089) * x + 8.88314979438837594) * x + 66.1191906371416295) * x + 298.635138197400131) * x + 881.952221241769090) * x + 1712.04761263407058) * x + 2051.07837782607147) * x + 1230.33935479799725
    const bot = (((((((x + 15.7449261107098347) * x + 117.693950891312499) * x + 537.181101862009858) * x + 1621.38957456669019) * x + 3290.79923573345963) * x + 4362.61909014324716) * x + 3439.36767414372164) * x + 1230.33935480374942
    r = top / bot
  } else {
    if (x >= 27) return 0
    const z = 1 / (x * x)
    const top = ((((0.0163153871373020978 * z + 0.305326634961232344) * z + 0.360344899949804439) * z + 0.125781726111229246) * z + 0.0160837851487422766) * z + 6.58749161529837803e-4
    const bot = ((((z + 2.56852019228982242) * z + 1.87295284992346725) * z + 0.527905102951428412) * z + 0.0605183413124413191) * z + 2.33520497626869185e-3
    r = (1 / Math.sqrt(Math.PI) - (z * top) / bot) / x
  }
  // exp(-x²) computed in two parts to keep precision, as Cody does.
  const xsq = Math.trunc(x * 16) / 16
  const del = (x - xsq) * (x + xsq)
  return Math.exp(-xsq * xsq) * Math.exp(-del) * r
}

/** Standard normal CDF. */
export const normalCDF = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))

/**
 * `String(format: "%.Nf")`, including printf's round-half-even on an exact
 * binary tie (JavaScript's `toFixed` rounds those up).
 */
export function formatFixed(value: number, digits: number, options: { sign?: boolean } = {}): string {
  let text: string
  const scaled = value * 10 ** digits
  const isTie = Number.isFinite(scaled) && !Number.isInteger(scaled) && Number.isInteger(scaled * 2) && Math.abs(scaled) < 2 ** 52
  if (isTie) {
    const lower = Math.floor(scaled)
    const even = lower % 2 === 0 ? lower : lower + 1
    text = (even / 10 ** digits).toFixed(digits)
    if (even === 0 && value < 0) text = `-${text}`
  } else {
    text = value.toFixed(digits)
  }
  if (options.sign && !text.startsWith('-')) text = `+${text}`
  return text
}
