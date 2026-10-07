/**
 * Every screen of the app and the five hubs they live in — a port of
 * `RootView.Screen` and `PhoneHub` (apple/…/Views/RootView.swift,
 * Views/Shell/ShellLayout.swift). On the web each screen also has a URL.
 */
export type Screen =
  | 'board' | 'dashboard' | 'injuries' | 'discovery' | 'planning' | 'waivers' | 'trades'
  | 'idpStream' | 'wrStream' | 'rbStream' | 'qbStream' | 'dstStream' | 'kStream'
  | 'matchup' | 'sitStart' | 'decide' | 'settings'
  /** Web-only tools from the original web app: draft day, research, rankings, odds. */
  | 'draft' | 'draftPlan' | 'research' | 'powerRankings' | 'odds'

export const screenTitle: Record<Screen, string> = {
  board: 'Board', dashboard: 'My Team', injuries: 'Injuries', discovery: 'Discover',
  planning: 'Planning', waivers: 'Waivers', trades: 'Trades', idpStream: 'IDP Stream',
  wrStream: 'WR Stream', rbStream: 'RB Stream', qbStream: 'QB Stream', dstStream: 'D/ST Stream',
  kStream: 'K Stream', matchup: 'Matchup', sitStart: 'Sit/Start', decide: 'Decide', settings: 'Settings',
  draft: 'Draft', draftPlan: 'Draft Plan', research: 'Research', powerRankings: 'Power Rankings', odds: 'Odds',
}

/**
 * The web-only tools, in sidebar order. Not a phone tab: on a phone they open
 * from My Team, and live under the Team hub.
 */
export const toolScreens: readonly Screen[] = ['draft', 'draftPlan', 'research', 'powerRankings', 'odds']
export const isToolScreen = (s: Screen) => toolScreens.includes(s)

export type Hub = 'board' | 'team' | 'lineup' | 'market' | 'streams'

export const hubs: readonly Hub[] = ['board', 'team', 'lineup', 'market', 'streams']

export const hubTitle: Record<Hub, string> = {
  board: 'Board', team: 'Team', lineup: 'Lineup', market: 'Market', streams: 'Streams',
}

/** A hub's segments, in bar order; the first is where it opens. */
export const hubScreens: Record<Hub, readonly Screen[]> = {
  board: ['board'],
  team: ['dashboard'],
  lineup: ['sitStart', 'decide', 'matchup', 'injuries'],
  market: ['discovery', 'waivers', 'trades', 'planning'],
  streams: ['qbStream', 'rbStream', 'wrStream', 'kStream', 'dstStream', 'idpStream'],
}

/** Which hub a screen lives in. Settings sits behind Team's gear. */
export function hubFor(screen: Screen): Hub {
  if (screen === 'settings' || isToolScreen(screen)) return 'team'
  return hubs.find((hub) => hubScreens[hub].includes(screen)) ?? 'team'
}

/** Short names for the segment bar. */
export function segmentLabel(screen: Screen): string {
  switch (screen) {
    case 'idpStream': return 'IDP'
    case 'wrStream': return 'WR'
    case 'rbStream': return 'RB'
    case 'qbStream': return 'QB'
    case 'dstStream': return 'D/ST'
    case 'kStream': return 'K'
    default: return screenTitle[screen]
  }
}

/** Where the app opens: the Board on a phone, My Team everywhere else. */
export function launchScreen(isPhone: boolean): Screen {
  return isPhone ? 'board' : 'dashboard'
}

// MARK: - URLs

const paths: Record<Screen, string> = {
  board: '/board',
  dashboard: '/team',
  settings: '/settings',
  sitStart: '/lineup/sit-start',
  decide: '/lineup/decide',
  matchup: '/lineup/matchup',
  injuries: '/lineup/injuries',
  discovery: '/market/discover',
  waivers: '/market/waivers',
  trades: '/market/trades',
  planning: '/market/planning',
  qbStream: '/streams/qb',
  rbStream: '/streams/rb',
  wrStream: '/streams/wr',
  kStream: '/streams/k',
  dstStream: '/streams/dst',
  idpStream: '/streams/idp',
  draft: '/tools/draft',
  draftPlan: '/tools/draft-plan',
  research: '/tools/research',
  powerRankings: '/tools/power-rankings',
  odds: '/tools/odds',
}

export function pathFor(screen: Screen): string {
  return paths[screen]
}

/** The screen a path shows; a bare hub path opens the hub's first segment. */
export function screenForPath(pathname: string): Screen | undefined {
  const clean = pathname.replace(/\/+$/, '') || '/'
  const exact = (Object.keys(paths) as Screen[]).find((s) => paths[s] === clean)
  if (exact) return exact
  const hub = hubs.find((h) => clean === `/${h}`)
  return hub ? hubScreens[hub][0] : undefined
}
