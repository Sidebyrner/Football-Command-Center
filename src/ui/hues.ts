import { hubFor, type Hub, type Screen } from '@models/navigation/screens'

/** Each tab's hue — CSS variables from tokens.css; streams take their position's colour. */
const hubHue: Record<Hub, string> = {
  board: 'var(--hue-board)',
  team: 'var(--hue-team)',
  lineup: 'var(--hue-lineup)',
  market: 'var(--hue-market)',
  streams: 'var(--pos-wr)',
}

const streamHue: Partial<Record<Screen, string>> = {
  qbStream: 'var(--pos-qb)',
  rbStream: 'var(--pos-rb)',
  wrStream: 'var(--pos-wr)',
  kStream: 'var(--pos-k)',
  dstStream: 'var(--pos-def)',
  idpStream: 'var(--pos-lb)',
}

export function hueForHub(hub: Hub): string {
  return hubHue[hub]
}

export function hueForScreen(screen: Screen): string {
  return streamHue[screen] ?? hubHue[hubFor(screen)]
}
