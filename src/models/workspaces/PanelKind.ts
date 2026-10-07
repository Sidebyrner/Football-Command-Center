/**
 * What each panel kind is called, what it's for, its sizes and how it links —
 * a port of FCApp `PanelKind+Metadata.swift`.
 */
import type { Screen } from '../navigation/screens'
import type { GridSize, PanelKind } from './Workspace'

export function panelTitle(kind: PanelKind): string {
  switch (kind) {
    case 'lineupReadiness': return 'Lineup readiness'
    case 'sitStart': return 'Sit/Start'
    case 'matchupScore': return 'Matchup'
    case 'injuries': return 'Injuries'
    case 'waiverTargets': return 'Waiver targets'
    case 'tradePartners': return 'Trade partners'
    case 'byeWeeks': return 'Byes & short weeks'
    case 'idpStream': return 'IDP Stream'
    case 'wrStream': return 'WR Stream'
    case 'rbStream': return 'RB Stream'
    case 'qbStream': return 'QB Stream'
    case 'dstStream': return 'D/ST Stream'
    case 'kStream': return 'K Stream'
    case 'news': return 'News'
    case 'standings': return 'Standings'
    case 'playerCard': return 'Player Card'
    case 'discovery': return 'Discovery'
    case 'playerProfile': return 'Profile'
    case 'playerNews': return 'Player news'
    case 'gameLog': return 'Game log'
    case 'trendChart': return 'Trend'
    case 'schedule': return 'Schedule & SoS'
    case 'compare': return 'Compare'
    case 'metric': return 'Metric'
    case 'playerSearch': return 'Player search'
  }
}

/** The full screen this panel summarises — the panel's "Open" button. */
export function panelFullScreen(kind: PanelKind): Screen | undefined {
  switch (kind) {
    case 'lineupReadiness': case 'news': case 'standings': return 'dashboard'
    case 'sitStart': return 'sitStart'
    case 'matchupScore': return 'matchup'
    case 'injuries': return 'injuries'
    case 'waiverTargets': return 'waivers'
    case 'tradePartners': return 'trades'
    case 'byeWeeks': return 'planning'
    case 'discovery': return 'waivers'
    case 'playerProfile': case 'playerNews': case 'gameLog': case 'trendChart': case 'schedule': case 'compare':
    case 'metric': case 'playerSearch':
      return undefined
    case 'idpStream': return 'idpStream'
    case 'wrStream': return 'wrStream'
    case 'rbStream': return 'rbStream'
    case 'qbStream': return 'qbStream'
    case 'dstStream': return 'dstStream'
    case 'kStream': return 'kStream'
    case 'playerCard': return undefined
  }
}

/**
 * `RootView.Screen.systemImage` (apple/…/Views/RootView.swift) — not yet in
 * `navigation/screens.ts`, so kept here for the panels that borrow their
 * screen's symbol.
 */
export const SCREEN_SYSTEM_IMAGE: Readonly<Partial<Record<Screen, string>>> = {
  board: 'square.grid.2x2',
  planning: 'calendar.badge.exclamationmark',
  dashboard: 'person.crop.square',
  injuries: 'cross.case',
  discovery: 'binoculars',
  waivers: 'tray.and.arrow.down',
  trades: 'arrow.triangle.swap',
  idpStream: 'shield.lefthalf.filled',
  wrStream: 'figure.american.football',
  rbStream: 'figure.run',
  qbStream: 'football',
  dstStream: 'shield',
  kStream: 'figure.australian.football',
  matchup: 'person.2',
  sitStart: 'arrow.left.arrow.right',
  decide: 'scalemass',
  settings: 'gearshape',
}

/** An SF Symbol name, as the Swift app uses; the web maps these to its own icons. */
export function panelSystemImage(kind: PanelKind): string {
  switch (kind) {
    case 'lineupReadiness': return 'checkmark.seal'
    case 'news': return 'newspaper'
    case 'standings': return 'list.number'
    case 'byeWeeks': return 'calendar.badge.exclamationmark'
    case 'playerCard': return 'person.text.rectangle'
    case 'discovery': return 'binoculars'
    case 'playerProfile': return 'person.crop.rectangle'
    case 'playerNews': return 'newspaper.circle'
    case 'gameLog': return 'list.bullet.rectangle'
    case 'trendChart': return 'chart.xyaxis.line'
    case 'schedule': return 'calendar'
    case 'compare': return 'person.2.crop.square.stack'
    case 'metric': return 'chart.bar.xaxis'
    case 'playerSearch': return 'magnifyingglass'
    default: {
      const screen = panelFullScreen(kind)
      return (screen && SCREEN_SYSTEM_IMAGE[screen]) ?? 'square'
    }
  }
}

/** What it's for, one line — shown in the panel library. */
export function panelSummary(kind: PanelKind): string {
  switch (kind) {
    case 'lineupReadiness': return "Is every slot filled with someone who'll play, and when the next lock is."
    case 'sitStart': return 'The recommended lineup and the moves that get you there.'
    case 'matchupScore': return "This week's score, projected and live."
    case 'injuries': return 'Your injured players, their status and who covers them.'
    case 'waiverTargets': return 'The best free agents for your roster this week.'
    case 'tradePartners': return 'Teams whose surplus fits your need, with their grades.'
    case 'byeWeeks': return "Upcoming byes and the weeks you'll be short at a slot."
    case 'idpStream': return "This week's best defenders to stream."
    case 'wrStream': return "This week's best receivers to stream."
    case 'rbStream': return "This week's best running backs to stream."
    case 'qbStream': return 'Quarterbacks to stream, on this week and the rest of the season.'
    case 'dstStream': return 'Team defenses to stream, on this week and the rest of the season.'
    case 'kStream': return 'Kickers to stream, on this week and the rest of the season.'
    case 'news': return 'The latest on your players.'
    case 'standings': return 'The league table.'
    case 'playerCard': return 'Everything on one player. Link it to follow clicks in other panels.'
    case 'discovery': return 'Every free agent at the positions you start — search, sort, click to research.'
    case 'playerProfile': return 'Bio, status, depth chart and grade for the linked player.'
    case 'playerNews': return 'The latest on the linked player.'
    case 'gameLog': return "The linked player's last game and last few games."
    case 'trendChart': return "Weekly trend lines for everyone you're comparing plus the clicked player — any stat, raw or smoothed."
    case 'schedule': return "The linked player's remaining games, lines and how soft each defense is."
    case 'compare': return 'Two to four players side by side, with charts. ⌘-click players to add them.'
    case 'metric': return 'One stat — targets, snap share, xFP… — with its numbers and a chart, for one player or several.'
    case 'playerSearch': return 'A slim search: click to focus a player, ＋ to add him to the comparison.'
  }
}

/** The size it gets when added from the library. */
export function panelDefaultSize(kind: PanelKind): GridSize {
  switch (kind) {
    case 'lineupReadiness': case 'matchupScore': return { w: 6, h: 3 }
    case 'byeWeeks': return { w: 6, h: 2 }
    case 'sitStart': return { w: 6, h: 4 }
    case 'injuries': case 'standings': return { w: 4, h: 4 }
    case 'waiverTargets': case 'idpStream': case 'wrStream': case 'rbStream': case 'qbStream': case 'dstStream':
    case 'kStream': case 'playerCard':
      return { w: 4, h: 5 }
    case 'tradePartners': return { w: 5, h: 6 }
    case 'news': return { w: 3, h: 4 }
    case 'discovery': return { w: 4, h: 6 }
    case 'playerProfile': return { w: 4, h: 4 }
    case 'playerNews': return { w: 3, h: 4 }
    case 'gameLog': return { w: 5, h: 4 }
    case 'trendChart': return { w: 6, h: 4 }
    case 'schedule': return { w: 5, h: 5 }
    case 'compare': return { w: 8, h: 6 }
    case 'metric': return { w: 4, h: 3 }
    case 'playerSearch': return { w: 2, h: 7 }
  }
}

/** The smallest it can be resized to and still say something. */
export function panelMinSize(kind: PanelKind): GridSize {
  switch (kind) {
    case 'sitStart': case 'tradePartners': return { w: 4, h: 3 }
    case 'matchupScore': return { w: 4, h: 2 }
    case 'waiverTargets': case 'idpStream': case 'wrStream': case 'rbStream': case 'qbStream': case 'dstStream':
    case 'kStream': case 'playerCard':
      return { w: 3, h: 3 }
    case 'lineupReadiness': case 'injuries': case 'byeWeeks': case 'news': case 'standings': return { w: 3, h: 2 }
    case 'discovery': return { w: 3, h: 4 }
    case 'playerProfile': return { w: 3, h: 3 }
    case 'playerNews': return { w: 3, h: 2 }
    case 'gameLog': case 'trendChart': case 'schedule': return { w: 4, h: 3 }
    case 'compare': return { w: 6, h: 4 }
    case 'metric': return { w: 3, h: 2 }
    case 'playerSearch': return { w: 2, h: 3 }
  }
}

/** Panels that follow a linked selection. */
export function panelConsumesLink(kind: PanelKind): boolean {
  switch (kind) {
    case 'playerCard': case 'tradePartners': case 'playerProfile': case 'playerNews': case 'gameLog':
    case 'trendChart': case 'schedule': case 'compare': case 'metric': case 'playerSearch':
      return true
    default:
      return false
  }
}

/** Panels whose rows publish a player (or team) to their link group. */
export function panelPublishesLink(kind: PanelKind): boolean {
  switch (kind) {
    case 'sitStart': case 'injuries': case 'waiverTargets': case 'tradePartners': case 'idpStream': case 'wrStream':
    case 'rbStream': case 'qbStream': case 'dstStream': case 'kStream': case 'standings': case 'matchupScore':
    case 'discovery': case 'compare': case 'metric': case 'playerSearch':
      return true
    case 'lineupReadiness': case 'byeWeeks': case 'news': case 'playerCard': case 'playerProfile': case 'playerNews':
    case 'gameLog': case 'trendChart': case 'schedule':
      return false
  }
}
