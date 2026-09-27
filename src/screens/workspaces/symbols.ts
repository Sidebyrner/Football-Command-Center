/**
 * The SF Symbols the workspace models name (workspace icons, panel kinds,
 * metrics), drawn with the web's lucide icons.
 */
import {
  ArrowLeftRight, BadgeCheck, BarChart3, Binoculars, Calendar, CalendarClock, ChartLine, Contact, Cross, Crosshair,
  Flag, Flame, Footprints, Hand, LayoutGrid, List, ListOrdered, Newspaper, Repeat, Inbox, Search, Settings, Shield,
  ShieldHalf, Sparkles, SquareDashed, SquareUser, Star, Target, Timer, Trophy, Users, Wind, Zap, type LucideIcon,
} from 'lucide-react'

const SYMBOLS: Readonly<Record<string, LucideIcon>> = {
  'square.grid.2x2': LayoutGrid,
  'sportscourt': Trophy,
  'tray.and.arrow.down': Inbox,
  'arrow.triangle.swap': Repeat,
  'chart.bar.xaxis': BarChart3,
  'calendar': Calendar,
  'star': Star,
  'bolt': Zap,
  'flame': Flame,
  'shield.lefthalf.filled': ShieldHalf,
  'list.bullet.rectangle': List,
  'binoculars': Binoculars,
  'square.dashed': SquareDashed,
  // Panels
  'checkmark.seal': BadgeCheck,
  'newspaper': Newspaper,
  'newspaper.circle': Newspaper,
  'list.number': ListOrdered,
  'calendar.badge.exclamationmark': CalendarClock,
  'person.text.rectangle': Contact,
  'person.crop.rectangle': SquareUser,
  'person.crop.square': SquareUser,
  'chart.xyaxis.line': ChartLine,
  'person.2.crop.square.stack': Users,
  'person.2': Users,
  'magnifyingglass': Search,
  'cross.case': Cross,
  'figure.american.football': Zap,
  'figure.run': Footprints,
  'football': Target,
  'shield': Shield,
  'figure.australian.football': Wind,
  'arrow.left.arrow.right': ArrowLeftRight,
  'gearshape': Settings,
  // Metrics
  'stopwatch': Timer,
  'scope': Crosshair,
  'hand.raised': Hand,
  'flag.checkered': Flag,
  'sparkles': Sparkles,
}

export function symbolIcon(name: string): LucideIcon {
  return SYMBOLS[name] ?? LayoutGrid
}
