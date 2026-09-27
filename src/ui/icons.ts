import {
  ArrowLeftRight, BarChart3, Binoculars, ClipboardList, Dices, NotebookPen, Trophy, CalendarClock, Cross, Footprints, Inbox, LayoutGrid, Repeat, Settings,
  Shield, ShieldHalf, SquareUser, Target, Users, Zap, Wind, type LucideIcon,
} from 'lucide-react'
import type { Hub, Screen } from '@models/navigation/screens'

export const hubIcon: Record<Hub, LucideIcon> = {
  board: LayoutGrid,
  team: SquareUser,
  lineup: ArrowLeftRight,
  market: Binoculars,
  streams: Footprints,
}

export const screenIcon: Record<Screen, LucideIcon> = {
  board: LayoutGrid,
  dashboard: SquareUser,
  sitStart: ArrowLeftRight,
  matchup: Users,
  injuries: Cross,
  discovery: Binoculars,
  waivers: Inbox,
  trades: Repeat,
  planning: CalendarClock,
  qbStream: Target,
  rbStream: Footprints,
  wrStream: Zap,
  kStream: Wind,
  dstStream: Shield,
  idpStream: ShieldHalf,
  settings: Settings,
  draft: ClipboardList,
  draftPlan: NotebookPen,
  research: BarChart3,
  powerRankings: Trophy,
  odds: Dices,
}
