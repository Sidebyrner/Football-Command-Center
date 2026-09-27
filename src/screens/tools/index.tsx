/** The five web-only tools, each hosted by `ToolScreen`. */
import DraftDashboard from '../../pages/DraftDashboard'
import MockDraft from '../../pages/MockDraft'
import Odds from '../../pages/Odds'
import PowerRankings from '../../pages/PowerRankings'
import Research from '../../pages/Research'
import { ToolScreen } from './ToolScreen'

export const DraftScreen = () => <ToolScreen screen="draft" Tool={DraftDashboard} />
export const DraftPlanScreen = () => <ToolScreen screen="draftPlan" Tool={MockDraft} />
export const ResearchScreen = () => <ToolScreen screen="research" Tool={Research} />
export const PowerRankingsScreen = () => <ToolScreen screen="powerRankings" Tool={PowerRankings} />
export const OddsScreen = () => <ToolScreen screen="odds" Tool={Odds} />
