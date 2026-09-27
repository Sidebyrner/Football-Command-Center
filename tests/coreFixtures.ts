import { WeeklyFile } from '@core/WeeklyStats'
import { decodeSchedule, type ScheduleFile } from '@core/Schedule'
import { readFixture } from './swiftFixtures'

/** Port of FCCoreTests `Fixtures`: shared, decoded once, read-only. */
let weekly: WeeklyFile | undefined
const schedules = new Map<number, ScheduleFile>()

export const weekly2025 = () => (weekly ??= new WeeklyFile(readFixture('FCCore', 'weekly-2025.json')))
export function schedule(season: 2025 | 2026): ScheduleFile {
  let s = schedules.get(season)
  if (!s) schedules.set(season, (s = decodeSchedule(readFixture('FCCore', `schedule-${season}.json`))))
  return s
}

export const LEAGUE_ROSTER_POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'IDP_FLEX', 'IDP_FLEX',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR',
]
export const LEAGUE_TEAM_COUNT = 8

export const Player = {
  aaronRodgers: '00-0023459',
  joshAllen: '00-0034857',
  bijanRobinson: '00-0038542',
} as const

export const gsisIDNamed = (name: string, file = weekly2025()) => file.playerIDs.find((id) => file.playerMeta(id)?.name === name)
