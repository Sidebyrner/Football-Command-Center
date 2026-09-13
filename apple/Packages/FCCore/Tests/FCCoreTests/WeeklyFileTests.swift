import XCTest
@testable import FCCore

final class WeeklyFileTests: XCTestCase {
    func testDecodesTheShippedFile() throws {
        let file = try Fixtures.weekly2025()

        XCTAssertEqual(file.playerCount, 652)
        XCTAssertEqual(file.rowCount, 6_580)
        XCTAssertEqual(file.fileMeta?.season, 2025)
        XCTAssertEqual(file.fileMeta?.complete, true)
        XCTAssertEqual(file.fileMeta?.weeks?.count, 18)
    }

    /// **The coverage gap, stated rather than papered over.** The file holds QB,
    /// RB, WR, TE and K only. There is no DEF and no IDP production data at all,
    /// which in this league is three of eleven starting slots (§3.2).
    func testTheFileCarriesNoDefenceOrIDPData() throws {
        let file = try Fixtures.weekly2025()
        let positions = Set(file.playerIDs.compactMap { file.position(for: $0) })

        XCTAssertEqual(positions, [.qb, .rb, .wr, .te, .k])
        XCTAssertFalse(positions.contains(.def))
        XCTAssertTrue(positions.isDisjoint(with: Position.idp))
    }

    /// Rows decode by zipping the file's own `fields` header, never by fixed
    /// index. The field list has changed before and will again, and a column
    /// reordering upstream must not silently shift values (§3.2).
    func testRowsDecodeByFieldNameNotByIndex() throws {
        let original = try Fixtures.weekly2025()
        let reference = try XCTUnwrap(original.rows(for: Fixtures.Player.joshAllen).first)

        // Same data, columns reversed.
        let reordered = try JSONDecoder().decode(
            WeeklyFile.self,
            from: Data(
                """
                {"fields":["opp","team","week","pass_yd","pass_td"],
                 "meta":{"x":{"n":"Test","p":"QB"}},
                 "players":{"x":[["NYJ","BUF",1,394,2]]}}
                """.utf8
            )
        )
        let row = try XCTUnwrap(reordered.rows(for: "x").first)

        XCTAssertEqual(row.week, reference.week)
        XCTAssertEqual(row.team, reference.team)
        XCTAssertEqual(row.opponent, reference.opponent)
        XCTAssertEqual(row.number(.passYards), reference.number(.passYards))
        XCTAssertEqual(row.number(.passTD), reference.number(.passTD))
    }

    /// A newer schema than we know must be ignored, never crashed on (§9).
    func testUnknownColumnsAreToleratedNotFatal() throws {
        let file = try JSONDecoder().decode(
            WeeklyFile.self,
            from: Data(
                """
                {"fields":["week","team","rec_yd","brand_new_metric"],
                 "meta":{"x":{"n":"Test","p":"WR"}},
                 "players":{"x":[[3,"PHI",88,0.42]]},
                 "_meta":{"season":2027,"somethingElse":true}}
                """.utf8
            )
        )
        let row = try XCTUnwrap(file.rows(for: "x").first)

        XCTAssertEqual(row.week, 3)
        XCTAssertEqual(row.number(.recYards), 88)
        XCTAssertEqual(file.fileMeta?.season, 2027)

        let score = ScoringEngine.score(row, profile: .leagueDefault, position: .wr)
        XCTAssertEqual(try XCTUnwrap(score.points), 8.8, accuracy: 0.001)
    }

    /// An absent column is not zero. `fp_ppr_ref` in particular must stay
    /// distinguishable so the correctness gate skips rows it cannot check rather
    /// than failing them.
    func testAnAbsentColumnIsDistinguishableFromZero() throws {
        let file = try JSONDecoder().decode(
            WeeklyFile.self,
            from: Data(
                """
                {"fields":["week","team","rec_yd","fp_ppr_ref"],
                 "meta":{"present":{"n":"A","p":"WR"},"absent":{"n":"B","p":"WR"}},
                 "players":{"present":[[1,"PHI",50,5]],"absent":[[1,"PHI",50,null]]}}
                """.utf8
            )
        )

        let present = try XCTUnwrap(file.rows(for: "present").first)
        let absent = try XCTUnwrap(file.rows(for: "absent").first)

        XCTAssertEqual(present.value(.pprReference), 5)
        XCTAssertNil(absent.value(.pprReference))
        XCTAssertEqual(absent.number(.pprReference), 0, "the scoring read still coerces")

        let report = ScoringEngine.validateAgainstReference(file: file)
        XCTAssertEqual(report.checkedRows, 1)
        XCTAssertEqual(report.skippedRows, 1)
    }

    func testRowsAreReturnedAscendingByWeek() throws {
        let file = try Fixtures.weekly2025()
        for id in file.playerIDs.prefix(50) {
            let weeks = file.rows(for: id).map(\.week)
            XCTAssertEqual(weeks, weeks.sorted(), id)
        }
    }

    func testUnknownPlayerYieldsNoRows() throws {
        XCTAssertTrue(try Fixtures.weekly2025().rows(for: "not-a-player").isEmpty)
    }

    /// The scan order must be stable so two runs over the same file agree.
    func testAllPlayersIsDeterministic() throws {
        let file = try Fixtures.weekly2025()
        XCTAssertEqual(
            file.allPlayers().map(\.gsisID), file.allPlayers().map(\.gsisID)
        )
        XCTAssertEqual(file.allPlayers().map(\.gsisID), file.playerIDs.sorted())
    }

    func testManifestDecodes() throws {
        let manifest = try Fixtures.decode(WeeklyManifest.self, from: "weekly-index.json")
        let season = try XCTUnwrap(manifest.seasons.first { $0.season == 2025 })

        XCTAssertEqual(season.weeks, 18)
        XCTAssertEqual(season.complete, true)
        XCTAssertNotNil(manifest.fileMeta?.generated)
    }

    /// The schedule ships recorded closing lines. They are free and do not move
    /// during the week, and the UI must label them as recorded so they are never
    /// mistaken for live odds (§3.2).
    func testScheduleCarriesRecordedClosingLines() throws {
        let schedule = try Fixtures.schedule2025()
        let opener = try XCTUnwrap(schedule.games(week: 1).first)

        XCTAssertEqual(opener.home, "PHI")
        XCTAssertEqual(opener.away, "DAL")
        XCTAssertEqual(try XCTUnwrap(opener.spreadLine), 8.5, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(opener.totalLine), 47.5, accuracy: 0.001)
        XCTAssertEqual(opener.opponent(of: "PHI"), "DAL")
        XCTAssertEqual(opener.opponent(of: "DAL"), "PHI")
        XCTAssertNil(opener.opponent(of: "KC"))

        XCTAssertEqual(schedule.weeksAscending.map(\.week), Array(1...18))
        XCTAssertEqual(schedule.fileMeta?.games, 272)
    }
}
