import { describe, expect, it } from 'vitest'
import type { Position } from '@core/Position'
import { crunchForWeek, crunchOutlook, isFeasible, type CrunchReport, type RosterEntry } from '@core/ByeCrunch'
import { parseSlots } from '@core/RosterSlots'
import { ByeCalendar } from '@core/ByeWeeks'
import { nflverseTeam } from '@core/NFLTeams'
import { LEAGUE_ROSTER_POSITIONS, schedule } from '../../../tests/coreFixtures'

/** Port of ByeCrunchTests. */
const template = parseSlots(LEAGUE_ROSTER_POSITIONS)
const entry = (id: string, position: Position, team: string): RosterEntry => ({ id, position, team })
const none = new Set<string>()

/** A full, legal roster with nobody on bye is short of nothing. */
function fullRoster(teams: Partial<Record<Position, string>> = {}): RosterEntry[] {
  const team = (p: Position, fallback: string) => teams[p] ?? fallback
  return [
    entry('qb1', 'QB', team('QB', 'BUF')),
    entry('rb1', 'RB', team('RB', 'ATL')),
    entry('rb2', 'RB', team('RB', 'DET')),
    entry('wr1', 'WR', team('WR', 'MIN')),
    entry('wr2', 'WR', team('WR', 'CIN')),
    entry('wr3', 'WR', team('WR', 'PHI')), // covers FLEX
    entry('te1', 'TE', team('TE', 'KC')),
    entry('k1', 'K', team('K', 'BAL')),
    entry('def1', 'DEF', team('DEF', 'PIT')),
    entry('lb1', 'LB', team('LB', 'SF')), // covers IDP_FLEX
    entry('db1', 'DB', team('DB', 'NYJ')), // covers IDP_FLEX
  ]
}

const sameSet = (a: ReadonlySet<Position>, b: readonly Position[]) => a.size === b.length && b.every((p) => a.has(p))
const group = (r: CrunchReport, eligible: Position[]) => r.flexGroups.find((g) => sameSet(g.eligible, eligible))

describe('ByeCrunch', () => {
  it('finds a full roster short of nothing', () => {
    const report = crunchForWeek(fullRoster(), template, none)
    expect(report.totalShortfall).toBe(0)
    expect(isFeasible(report)).toBe(true)
    expect(report.onBye).toEqual([])
    expect(report.flexFilled).toBe(3)
  })

  /** A position flags short only when the non-bye players genuinely cannot fill its slots. */
  it('flags a position short only when it actually is', () => {
    // Both running backs are off in the same week.
    const report = crunchForWeek(fullRoster({ RB: 'GB' }), template, new Set(['GB']))
    const rb = report.byPosition['RB']
    expect(rb).toBeDefined()
    expect(rb!.required).toBe(2)
    expect(rb!.available).toBe(0)
    expect(rb!.shortfall).toBe(2)
    expect(report.onBye.map((e) => e.id).sort()).toEqual(['rb1', 'rb2'])
    // Nothing else moved.
    expect(report.byPosition['WR']?.shortfall).toBe(0)
    expect(report.byPosition['QB']?.shortfall).toBe(0)
  })

  /** "RB: 1 available for 2 slots" is what the user acts on; a boolean isn't (§5.5). */
  it('reports shortfall per position, not as a boolean', () => {
    const roster = fullRoster().filter((e) => e.id !== 'rb2')
    const report = crunchForWeek(roster, template, none)
    expect(report.byPosition['RB']?.required).toBe(2)
    expect(report.byPosition['RB']?.available).toBe(1)
    expect(report.byPosition['RB']?.shortfall).toBe(1)
    expect(report.totalShortfall).toBe(1)
  })

  /** A position with no rostered players reports its full shortfall rather than disappearing. */
  it('reports the full shortfall for a position with no players', () => {
    const roster = fullRoster().filter((e) => e.position !== 'WR')
    const report = crunchForWeek(roster, template, none)
    expect(report.byPosition['WR']?.required).toBe(2)
    expect(report.byPosition['WR']?.available).toBe(0)
    expect(report.byPosition['WR']?.shortfall).toBe(2)
    // The FLEX slot the third receiver was covering is now empty too.
    expect(report.flexShortfall).toBe(1)
    expect(report.totalShortfall).toBe(3)
  })

  /**
   * The deviation from the old web app: pooled flex let a spare receiver cover
   * a missing linebacker. Each flex slot is matched only against positions it accepts.
   */
  it('does not let an offensive surplus cover an IDP flex slot', () => {
    const roster = [...fullRoster().filter((e) => e.id !== 'lb1'), entry('wr4', 'WR', 'SEA'), entry('wr5', 'WR', 'TB')]
    const report = crunchForWeek(roster, template, none)
    expect(report.flexRequired).toBe(3)
    expect(report.flexFilled, 'two receivers cannot fill an IDP slot').toBe(2)
    expect(report.flexShortfall).toBe(1)
    expect(report.totalShortfall).toBe(1)

    const idp = group(report, ['LB', 'DL', 'DB'])
    expect(idp?.required).toBe(2)
    expect(idp?.filled).toBe(1)
    expect(idp?.shortfall).toBe(1)
    expect(group(report, ['RB', 'WR', 'TE'])?.shortfall).toBe(0)
  })

  /** Overlapping eligibility sets still fill optimally (WRRB_FLEX + WRTE_FLEX). */
  it('fills overlapping flex eligibility optimally', () => {
    const report = crunchForWeek([entry('wr1', 'WR', 'PHI'), entry('rb1', 'RB', 'DAL')], parseSlots(['WRRB_FLEX', 'WRTE_FLEX']), none)
    // Naively seating the receiver in WRTE_FLEX would strand the back.
    expect(report.flexFilled).toBe(2)
    expect(report.totalShortfall).toBe(0)
  })

  /** Flex draws on surplus — a third receiver beyond the two dedicated slots. */
  it('draws flex from surplus, not from dedicated starters', () => {
    const report = crunchForWeek(fullRoster().filter((e) => e.id !== 'wr3'), template, none)
    expect(report.byPosition['WR']?.shortfall, 'the two dedicated slots are covered').toBe(0)
    expect(group(report, ['RB', 'WR', 'TE'])?.shortfall, 'but nothing is left over for FLEX').toBe(1)
  })

  /** Bye membership is checked after normalisation: a Sleeper `LAR` player is caught by an nflverse `LA` bye. */
  it('normalises the team code for bye matching', () => {
    const roster = [...fullRoster().filter((e) => e.id !== 'qb1'), entry('qb1', 'QB', 'LAR')]
    const report = crunchForWeek(roster, template, new Set(['LA']))
    expect(report.onBye.map((e) => e.id)).toEqual(['qb1'])
    expect(report.byPosition['QB']?.shortfall).toBe(1)
  })

  /** Unset slots and unknown players are surfaced, never counted as coverage. */
  it('does not count unset slots or unknown positions as coverage', () => {
    const roster = [...fullRoster(), { id: '0' }, { id: 'mystery', team: 'PHI' }]
    const report = crunchForWeek(roster, template, none)
    expect(report.unknownPosition).toEqual(['mystery'])
    expect(report.totalShortfall).toBe(0)
  })

  /** End to end against the real schedule. */
  it('builds the outlook against the real schedule', () => {
    const calendar = new ByeCalendar(schedule(2025))
    // Both backs and all three receivers are Rams, so they share a bye.
    const roster = fullRoster({ RB: 'LAR', WR: 'LAR' })
    const weeks = Array.from({ length: 18 }, (_, i) => i + 1)
    const outlook = crunchOutlook(roster, template, calendar, weeks)
    expect(outlook.size).toBe(18)

    const ramsBye = calendar.byTeam['LA']
    expect(ramsBye).toBe(8)
    const crunchWeek = outlook.get(ramsBye!)
    expect(crunchWeek).toBeDefined()
    expect(crunchWeek!.onBye).toHaveLength(5)
    expect(crunchWeek!.byPosition['RB']?.shortfall).toBe(2)
    expect(crunchWeek!.byPosition['WR']?.shortfall).toBe(2)
    // Two RB slots, two WR slots and the offensive FLEX behind them.
    expect(crunchWeek!.totalShortfall).toBe(5)
    expect(group(crunchWeek!, ['LB', 'DL', 'DB'])?.shortfall).toBe(0)

    // Every other week: short exactly when one of the roster's teams is off.
    const rosterTeams = new Set(roster.map((e) => nflverseTeam(e.team)).filter((t): t is string => t !== undefined))
    for (const week of weeks) {
      const report = outlook.get(week)
      expect(report).toBeDefined()
      const affected = [...calendar.byeTeams(week)].some((t) => rosterTeams.has(t))
      if (affected) expect(report!.totalShortfall, `week ${week}`).toBeGreaterThan(0)
      else expect(report!.totalShortfall, `week ${week}`).toBe(0)
    }
  })
})
