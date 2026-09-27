/**
 * The web-only tools, reachable from My Team — on a phone there's no sidebar,
 * so this is where Draft, Research, Power Rankings and Odds live.
 */
import { ChevronRight } from 'lucide-react'
import { screenTitle, toolScreens } from '@models/navigation/screens'
import { useApp } from '@ui/app/AppContext'
import { ScreenSection } from '@ui/components/Screen'
import { screenIcon } from '@ui/icons'

const blurb: Record<string, string> = {
  draft: 'Your live draft board, picks and grades',
  draftPlan: 'Plan your draft targets round by round',
  research: 'Notes, news and defense matchups',
  powerRankings: 'Every team graded, with weekly odds',
  odds: 'Game lines, implied totals and your players’ games',
}

export function ToolsCard() {
  const { openScreen } = useApp()
  return (
    <ScreenSection title="Tools" subtitle="Web-only tools from the original web app." hue="var(--hue-team)">
      <div className="card tools-card">
        {toolScreens.map((s) => {
          const Icon = screenIcon[s]
          return (
            <button key={s} type="button" className="tools-row" onClick={() => openScreen(s)}>
              <Icon size={18} color="var(--hue-team)" aria-hidden />
              <span className="tools-row-text">
                <span className="t-body" style={{ fontWeight: 600 }}>{screenTitle[s]}</span>
                <span className="t-meta muted">{blurb[s]}</span>
              </span>
              <ChevronRight size={16} color="var(--text-3)" aria-hidden />
            </button>
          )
        })}
      </div>
    </ScreenSection>
  )
}
