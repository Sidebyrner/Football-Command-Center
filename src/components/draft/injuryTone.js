import { INJURY_STATUS } from '../../utils/playerHelpers'

/** An injury tag's verdict colour as a design token (start / caution / sit). */
export function injuryTone(injuryStatus) {
  return `var(--${INJURY_STATUS[injuryStatus] ?? 'start'})`
}
