import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ArrowLeftRight, TrendingUp } from 'lucide-react'
import { GRADE_COLOR, findTradeOpportunities } from '../../utils/teamGrades'
import { impliedTotalForLineup } from '../../utils/oddsHelpers'
import { useOdds } from '../../hooks/useOdds'
import useAppStore from '../../store/useAppStore'

function LinkCard({ to, icon: Icon, label, value, valueColor }) {
  return (
    <Link
      to={to}
      className="flex-1 min-w-0 flex items-center gap-2.5 border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-3 py-2.5 hover:bg-[var(--color-surface-2)] transition-colors"
    >
      <Icon size={14} className="text-[var(--color-text-faint)] flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</p>
        <p className="text-sm font-bold truncate" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </p>
      </div>
    </Link>
  )
}

/**
 * Thin launchpad into the rest of the app — quick-glance numbers, each
 * linking to the page that actually explains them. Deliberately stays a
 * single row, not a content section.
 */
export default function QuickLinksStrip({ teams, myTeam, playersById }) {
  const oddsApiKey = useAppStore((s) => s.oddsApiKey)
  const { odds, fetchOdds } = useOdds(oddsApiKey)

  useEffect(() => {
    if (oddsApiKey && odds.length === 0) fetchOdds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddsApiKey])

  const opportunities = useMemo(
    () => (myTeam ? findTradeOpportunities(myTeam, teams) : []),
    [myTeam, teams]
  )

  const vegas = useMemo(
    () => (myTeam ? impliedTotalForLineup(odds, myTeam.starterIds, playersById) : null),
    [myTeam, odds, playersById]
  )

  if (!myTeam) return null

  const gradeColor = myTeam.grade ? GRADE_COLOR[myTeam.grade] : 'var(--color-text-faint)'

  return (
    <div className="flex-shrink-0 flex gap-3 px-6 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <LinkCard
        to="/power-rankings"
        icon={BarChart3}
        label="Your grade"
        value={myTeam.grade ?? '—'}
        valueColor={gradeColor}
      />
      <LinkCard
        to="/trade"
        icon={ArrowLeftRight}
        label="Trade opportunities"
        value={opportunities.length}
      />
      <LinkCard
        to="/odds"
        icon={TrendingUp}
        label="Vegas total (starters)"
        value={vegas?.total != null ? vegas.total.toFixed(1) : oddsApiKey ? '—' : 'no key'}
      />
    </div>
  )
}
