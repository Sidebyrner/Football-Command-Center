import XCTest
@testable import FCCore

/// Kickoff times and lineup locks against the real 2025 schedule.
final class GameClockTests: XCTestCase {
    private func utc(_ text: String) -> Date {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: text)!
    }

    private func calendar() throws -> KickoffCalendar {
        KickoffCalendar(schedule: try Fixtures.schedule2025())
    }

    // MARK: - Parsing

    /// DAL at PHI, Thursday 2025-09-04, 20:20 ET — the 8:20pm broadcast slot,
    /// which is 00:20 UTC on the Friday.
    func testThursdayNightKickoffIsEastern() throws {
        XCTAssertEqual(try calendar().kickoff(team: "PHI", week: 1), utc("2025-09-05T00:20:00Z"))
        XCTAssertEqual(try calendar().kickoff(team: "DAL", week: 1), utc("2025-09-05T00:20:00Z"))
    }

    /// A 1pm ET game is 17:00 UTC in September (EDT)…
    func testEarlySeasonOnePMIsSeventeenHundredUTC() throws {
        XCTAssertEqual(try calendar().kickoff(team: "ATL", week: 1), utc("2025-09-07T17:00:00Z"))
    }

    /// …and 18:00 UTC after clocks change on 2025-11-02 (EST). Getting this wrong
    /// would unlock a lineup an hour after Sleeper locked it.
    func testAfterTheClocksChangeOnePMIsEighteenHundredUTC() throws {
        XCTAssertEqual(try calendar().kickoff(team: "CAR", week: 10), utc("2025-11-09T18:00:00Z"))
    }

    func testMalformedTimesAreNilNotMidnight() {
        let game = ScheduledGame(home: "PHI", away: "DAL", kickoff: "2025-09-04", time: "TBD", spreadLine: nil, totalLine: nil)
        XCTAssertNil(game.kickoffDate)
        let noTime = ScheduledGame(home: "PHI", away: "DAL", kickoff: "2025-09-04", time: nil, spreadLine: nil, totalLine: nil)
        XCTAssertNil(noTime.kickoffDate)
    }

    /// Sleeper spells the Rams LAR; the schedule says LA.
    func testSleeperTeamCodesAreNormalised() throws {
        let calendar = try calendar()
        XCTAssertNotNil(calendar.kickoff(team: "LAR", week: 7))
        XCTAssertEqual(calendar.kickoff(team: "LAR", week: 7), calendar.kickoff(team: "LA", week: 7))
    }

    // MARK: - Locks

    /// Week 7 on Sunday 2025-10-19 at 2:30pm ET: the London game (9:30) and the
    /// 1pm games have kicked off; the late games haven't.
    func testMidSundayLocksEarlyGamesOnly() throws {
        let calendar = try calendar()
        let now = utc("2025-10-19T18:30:00Z")

        XCTAssertTrue(calendar.isLocked(team: "JAX", week: 7, now: now), "9:30 London game")
        XCTAssertTrue(calendar.isLocked(team: "CHI", week: 7, now: now), "1pm game")
        XCTAssertTrue(calendar.isLocked(team: "CIN", week: 7, now: now), "Thursday game")
        let lateTeams = ["GB", "ARI", "SF", "ATL", "DAL", "WAS", "DEN", "NYG", "IND", "LAC", "TB", "DET", "SEA", "HOU"]
        let unlocked = lateTeams.filter { !calendar.isLocked(team: $0, week: 7, now: now) }
        XCTAssertFalse(unlocked.isEmpty, "some late games have not started")
    }

    func testTheKickoffInstantItselfIsLocked() throws {
        let calendar = try calendar()
        let kickoff = try XCTUnwrap(calendar.kickoff(team: "PHI", week: 1))
        XCTAssertFalse(calendar.isLocked(team: "PHI", week: 1, now: kickoff.addingTimeInterval(-1)))
        XCTAssertTrue(calendar.isLocked(team: "PHI", week: 1, now: kickoff))
    }

    /// A team on bye has no game, so it is never locked — its players can be
    /// moved all week (and a bye starter should be).
    func testATeamOnByeIsNeverLocked() throws {
        let calendar = try calendar()
        XCTAssertNil(calendar.kickoff(team: "BUF", week: 7))
        XCTAssertFalse(calendar.isLocked(team: "BUF", week: 7, now: utc("2025-10-21T00:00:00Z")))
    }

    func testLiveWindowIsKickoffToFourHoursAfter() throws {
        let calendar = try calendar()
        let kickoff = try XCTUnwrap(calendar.kickoff(team: "PHI", week: 1))
        XCTAssertFalse(calendar.isLive(team: "PHI", week: 1, now: kickoff.addingTimeInterval(-60)))
        XCTAssertTrue(calendar.isLive(team: "PHI", week: 1, now: kickoff.addingTimeInterval(60)))
        XCTAssertFalse(calendar.isLive(team: "PHI", week: 1, now: kickoff.addingTimeInterval(KickoffCalendar.liveWindow + 60)))
    }

    func testLockWindowsAreDistinctAndAscending() throws {
        let windows = try calendar().lockWindows(week: 7)
        XCTAssertEqual(windows, windows.sorted())
        XCTAssertEqual(Set(windows).count, windows.count)
        XCTAssertEqual(windows.first, utc("2025-10-17T00:15:00Z"), "Thursday night is the first lock")
    }

    func testNextLockSkipsGamesAlreadyStarted() throws {
        let calendar = try calendar()
        let now = utc("2025-10-19T18:30:00Z")
        let next = try XCTUnwrap(calendar.nextLock(week: 7, teams: ["CHI", "GB", nil, "BUF"], now: now))
        XCTAssertEqual(next, calendar.kickoff(team: "GB", week: 7))
    }
}

/// The optimizer with lineup locks.
final class LockedLineupOptimizerTests: XCTestCase {
    private let positions: [String: Position] = [
        "qb1": .qb, "qb2": .qb, "rb1": .rb, "rb2": .rb, "rb3": .rb, "wr1": .wr, "wr2": .wr,
    ]
    private let template = RosterSlots.parse(["QB", "RB", "RB", "FLEX"])

    private func optimize(
        starters: [String], roster: [String], values: [String: Double], locked: Set<String>
    ) -> LineupProposal {
        LineupOptimizer.optimize(
            currentStarterIDs: starters, playerIDs: roster, template: template,
            positions: { self.positions[$0] }, valueOf: { values[$0] }, locked: locked
        )
    }

    /// qb1 has kicked off. qb2 is far better, but qb1's slot is locked.
    func testALockedStarterIsNeverSwappedOut() {
        let proposal = optimize(
            starters: ["qb1", "rb1", "rb2", "wr1"],
            roster: ["qb1", "qb2", "rb1", "rb2", "wr1"],
            values: ["qb1": 5, "qb2": 30, "rb1": 10, "rb2": 9, "wr1": 8],
            locked: ["qb1"]
        )
        XCTAssertEqual(proposal.proposedIDs[0], "qb1")
        XCTAssertFalse(proposal.swaps.contains { $0.outID == "qb1" || $0.inID == "qb2" })
    }

    /// rb3 is the best back on the roster but already played from the bench.
    func testALockedBenchPlayerIsNeverStarted() {
        let proposal = optimize(
            starters: ["qb1", "rb1", "rb2", "wr1"],
            roster: ["qb1", "rb1", "rb2", "rb3", "wr1"],
            values: ["qb1": 20, "rb1": 10, "rb2": 9, "rb3": 25, "wr1": 8],
            locked: ["rb3"]
        )
        XCTAssertFalse(proposal.proposedIDs.contains("rb3"))
        XCTAssertFalse(proposal.unranked.contains("rb3"), "locked is not the same claim as unvalued")
    }

    /// Unlocked slots are still optimized around the pinned ones, and slot
    /// indices in the swaps refer to the full lineup.
    func testUnlockedSlotsAreStillOptimizedWithCorrectIndices() throws {
        let proposal = optimize(
            starters: ["qb1", "rb1", "rb2", "wr1"],
            roster: ["qb1", "rb1", "rb2", "rb3", "wr1"],
            values: ["qb1": 20, "rb1": 10, "rb2": 4, "rb3": 12, "wr1": 8],
            locked: ["rb1"]
        )
        XCTAssertEqual(proposal.proposedIDs[1], "rb1", "locked rb1 pinned in slot 1")
        let swap = try XCTUnwrap(proposal.swaps.first { $0.inID == "rb3" })
        XCTAssertEqual(swap.outID, "rb2")
        XCTAssertEqual(swap.slotIndex, 2, "index in the full lineup, not the sub-lineup")
    }

    /// Totals cover the whole lineup, locked starters included, and the gain is
    /// unaffected by them.
    func testTotalsIncludeLockedStarters() throws {
        let proposal = optimize(
            starters: ["qb1", "rb1", "rb2", "wr1"],
            roster: ["qb1", "rb1", "rb2", "rb3", "wr1"],
            values: ["qb1": 20, "rb1": 10, "rb2": 4, "rb3": 12, "wr1": 8],
            locked: ["qb1"]
        )
        XCTAssertEqual(try XCTUnwrap(proposal.currentTotal), 42, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(proposal.proposedTotal), 50, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(proposal.gain), 8, accuracy: 0.001)
    }

    /// With nothing locked the result is identical to the plain optimizer.
    func testNoLocksMatchesThePlainOptimizer() {
        let values: [String: Double] = ["qb1": 20, "qb2": 22, "rb1": 10, "rb2": 4, "rb3": 12, "wr1": 8]
        let roster = ["qb1", "qb2", "rb1", "rb2", "rb3", "wr1"]
        let starters = ["qb1", "rb1", "rb2", "wr1"]
        let locked = optimize(starters: starters, roster: roster, values: values, locked: [])
        let plain = LineupOptimizer.optimize(
            currentStarterIDs: starters, playerIDs: roster, template: template,
            positions: { self.positions[$0] }, valueOf: { values[$0] }
        )
        XCTAssertEqual(locked, plain)
    }

    /// Every slot locked: nothing to do, nothing proposed.
    func testAFullyLockedLineupProposesNoChanges() {
        let proposal = optimize(
            starters: ["qb1", "rb1", "rb2", "wr1"],
            roster: ["qb1", "qb2", "rb1", "rb2", "rb3", "wr1"],
            values: ["qb1": 1, "qb2": 30, "rb1": 1, "rb2": 1, "rb3": 30, "wr1": 1],
            locked: ["qb1", "rb1", "rb2", "wr1"]
        )
        XCTAssertTrue(proposal.swaps.isEmpty)
        XCTAssertEqual(proposal.proposedIDs, ["qb1", "rb1", "rb2", "wr1"])
    }
}
