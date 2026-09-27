/**
 * Small pieces the Team and Market panels share — the slot abbreviations
 * (Swift `SitStartPanel.slotLabel`) and `.panelPlayerTap` for content that
 * isn't a `PanelPlayerRow` (an alert line, a stream row with its range bar).
 */
import type { KeyboardEvent, MouseEvent } from 'react'
import type { LeagueContext } from '@models/league/LeagueContext'
import { panelPlayerTapHelp, panelPlayerTapOutcome } from '@models/workspaces/PanelEnvironment'
import { useApp } from '@ui/app/AppContext'
import { usePanelEnv } from './PanelEnv'
import './teamPanels.css'

/** The short slot names the lineup rows use. */
export function slotLabel(token: string): string {
  switch (token) {
    case 'SUPER_FLEX': return 'SF'
    case 'REC_FLEX': return 'RWT'
    case 'WRRB_FLEX': return 'W/R'
    case 'IDP_FLEX': return 'IDP'
    default: return token
  }
}

/**
 * Swift `.panelPlayerTap(id, context:)`: what a click on any player content
 * does — ⌘/Ctrl-click compares, a linked panel publishes, otherwise the
 * Player Card opens. Spread the result onto the clickable element; empty for
 * content with no player.
 */
export function usePanelPlayerTap(playerID: string | undefined, context: LeagueContext | undefined) {
  const env = usePanelEnv()
  const { openPlayerCard } = useApp()
  if (!playerID) return undefined
  const act = (commandHeld: boolean) => {
    switch (panelPlayerTapOutcome(env.linkPublish, env.compare, context !== undefined, commandHeld)) {
      case 'toggleCompare': env.compare.toggle(playerID); break
      case 'publish': env.linkPublish.handler({ kind: 'player', playerID }); break
      case 'openCard': if (context) openPlayerCard(playerID, context); break
      case 'none': break
    }
  }
  return {
    role: 'button' as const,
    tabIndex: 0,
    title: panelPlayerTapHelp(env.linkPublish, env.compare),
    onClick: (e: MouseEvent) => act(e.metaKey || e.ctrlKey),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e.metaKey || e.ctrlKey) }
    },
  }
}
