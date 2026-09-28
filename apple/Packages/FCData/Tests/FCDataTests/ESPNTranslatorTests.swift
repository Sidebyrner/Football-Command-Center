import XCTest
import FCCore
@testable import FCData

/// ESPN → Sleeper-shape translation on a fixture league: one private league,
/// two teams, three weeks. The ids in the fixture are real ESPN ids so the
/// crosswalk resolves them; the names are the players they belong to.
final class ESPNTranslatorTests: XCTestCase {
    private var raw: ESPNLeague!
    private var crosswalk: PlayerIDCrosswalk!
    private var mapper: ESPNPlayerIDMapper!

    override func setUpWithError() throws {
        raw = try JSONDecoder().decode(ESPNLeague.self, from: Fixtures.data("espn-league"))
        crosswalk = try JSONDecoder().decode(PlayerIDCrosswalk.self, from: Fixtures.data("player-ids"))
        mapper = ESPNPlayerIDMapper(crosswalk: crosswalk, players: nil)
    }

    private func sleeperID(named name: String) -> String {
        crosswalk.players.first { $0.value.name == name && $0.value.espnId != nil }!.key
    }

    // MARK: - League

    func testTheLineupTemplateMatchesTheLeague() {
        let league = ESPNTranslator.league(raw, id: "987654")
        XCTAssertEqual(league.leagueID, "987654")
        XCTAssertEqual(league.name, "Test Private League")
        XCTAssertEqual(league.season, "2026")
        XCTAssertEqual(league.totalRosters, 2)
        XCTAssertEqual(
            league.rosterPositions,
            ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN", "BN", "BN", "BN", "BN", "IR"]
        )
        let template = league.slotTemplate
        XCTAssertEqual(template.starters.count, 9)
        XCTAssertEqual(template.benchCount, 6)
    }

    func testScoringTranslatesToSleeperKeys() {
        let scoring = ESPNTranslator.league(raw, id: "987654").scoringSettings ?? [:]
        XCTAssertEqual(scoring["pass_yd"], 0.04)
        XCTAssertEqual(scoring["pass_td"], 4)
        XCTAssertEqual(scoring["pass_int"], -2)
        XCTAssertEqual(scoring["rec"], 1)
        XCTAssertEqual(scoring["rec_td"], 6)
        XCTAssertEqual(scoring["fum_lost"], -2)
        // ESPN's one 0–39 field-goal bucket fans out to Sleeper's three.
        XCTAssertEqual(scoring["fgm_0_19"], 3)
        XCTAssertEqual(scoring["fgm_20_29"], 3)
        XCTAssertEqual(scoring["fgm_30_39"], 3)
        XCTAssertEqual(scoring["fgm_40_49"], 4)
        XCTAssertEqual(scoring["fgm_50p"], 5)
        XCTAssertEqual(scoring["sack"], 1)
        XCTAssertEqual(scoring["pts_allow_0"], 5)
        // An unknown stat id is dropped rather than invented.
        XCTAssertEqual(scoring.values.filter { $0 == 42 }.count, 0)

        let translation = ScoringProfile.fromSleeper(scoringSettings: scoring, leagueName: "x")
        XCTAssertEqual(translation.profile.passingTD, 4)
        XCTAssertEqual(translation.profile.interception, -2)
    }

    func testLeagueRulesCarryOver() {
        let settings = ESPNTranslator.league(raw, id: "987654").settings
        XCTAssertEqual(settings?.playoffWeekStart, 15)
        XCTAssertEqual(settings?.playoffTeams, 6)
        XCTAssertEqual(settings?.waiverType, 2)
        XCTAssertEqual(settings?.waiverBudget, 100)
        XCTAssertEqual(settings?.waiverDayOfWeek, 3)
        XCTAssertEqual(settings?.reserveSlots, 1)
        XCTAssertNil(settings?.effectiveTradeDeadline)
    }

    // MARK: - Members

    func testMembersCarryTeamNamesInEitherEra() {
        let members = ESPNTranslator.members(raw)
        XCTAssertEqual(members.count, 2)
        let connor = members.first { $0.userID == "{AAAAAAAA-0000-0000-0000-00000000AB12}" }
        XCTAssertEqual(connor?.displayName, "connor")
        // The team's owner id is the same account in a different case.
        XCTAssertEqual(connor?.teamName, "Byrne Notice")
        let rival = members.first { $0.userID == "{BBBBBBBB-0000-0000-0000-000000000002}" }
        XCTAssertEqual(rival?.teamName, "Waiver Wire")
        XCTAssertEqual(rival?.label, "Waiver Wire")
    }

    // MARK: - Rosters

    func testRostersSplitStartersBenchAndIRInSlotOrder() {
        let rosters = ESPNTranslator.rosters(raw, leagueID: "987654", mapper: mapper)
        XCTAssertEqual(rosters.count, 2)
        let mine = rosters[0]
        XCTAssertEqual(mine.rosterID, 1)
        XCTAssertEqual(mine.ownerID, "{AAAAAAAA-0000-0000-0000-00000000AB12}")

        let mahomes = sleeperID(named: "Patrick Mahomes")
        let bijan = sleeperID(named: "Bijan Robinson")
        let lamb = sleeperID(named: "CeeDee Lamb")
        let aiyuk = sleeperID(named: "Brandon Aiyuk")
        let kelce = sleeperID(named: "Travis Kelce")
        let chase = sleeperID(named: "Ja'Marr Chase")
        let butker = sleeperID(named: "Harrison Butker")
        let mixon = sleeperID(named: "Joe Mixon")

        // QB RB RB WR WR TE FLEX DEF K — the second RB slot is empty.
        XCTAssertEqual(
            mine.starters,
            [mahomes, bijan, "0", lamb, aiyuk, kelce, chase, "KC", butker]
        )
        XCTAssertEqual(mine.reserve, [mixon])
        XCTAssertEqual(mine.players?.count, 11)
        XCTAssertEqual(mine.bench.count, 3)
        XCTAssertTrue(mine.bench.contains("espn:99999991"), "an unmapped rookie keeps a stable synthetic id")

        XCTAssertEqual(mine.settings?.wins, 2)
        XCTAssertEqual(mine.settings?.pointsFor, 251.5)
        XCTAssertEqual(mine.settings?.pointsAgainst, 200.25)
        XCTAssertEqual(mine.settings?.waiverBudgetUsed, 12)
        XCTAssertEqual(mine.settings?.waiverPosition, 8)
    }

    /// The data pipeline once published a crosswalk without ESPN ids; the copy
    /// shipped with the build must fill the gap rather than every roster
    /// showing as unrostered.
    func testTheBundledCrosswalkFillsInMissingESPNIDs() throws {
        let stripped = try JSONDecoder().decode(PlayerIDCrosswalk.self, from: Data("""
        {"players":{"4046":{"gsisId":"00-0033873","name":"Patrick Mahomes","position":"QB","team":"KCC"}}}
        """.utf8))
        XCTAssertEqual(ESPNPlayerIDMapper(crosswalk: stripped, players: nil).sleeperID(for: nil, espnID: 3139477), "espn:3139477")
        let mapper = ESPNPlayerIDMapper(crosswalk: stripped, players: nil, bundledCrosswalk: crosswalk)
        XCTAssertEqual(mapper.sleeperID(for: nil, espnID: 3139477), "4046")
    }

    func testATeamDefenseBecomesItsAbbreviation() {
        XCTAssertEqual(mapper.sleeperID(for: nil, espnID: -16012), "KC")
        XCTAssertEqual(mapper.sleeperID(for: nil, espnID: -16014), "LAR")
        XCTAssertEqual(mapper.sleeperID(for: nil, espnID: -16030), "JAX")
    }

    // MARK: - Player id mapping

    func testMapperFallsBackToSleeperEspnIDThenName() {
        let index = PlayerIndex(players: [
            "s1": IndexedPlayer(id: "s1", name: "Only On Sleeper", positionCode: "WR", team: "CHI", injuryStatus: nil, active: true, espnID: 555),
            "s2": IndexedPlayer(id: "s2", name: "Name Match", positionCode: "RB", team: "DAL", injuryStatus: nil, active: true),
            "s3": IndexedPlayer(id: "s3", name: "Name Match", positionCode: "RB", team: "DAL", injuryStatus: nil, active: false),
        ])
        let mapper = ESPNPlayerIDMapper(crosswalk: nil, players: index)

        XCTAssertEqual(mapper.sleeperID(for: nil, espnID: 555), "s1")

        let named = try! JSONDecoder().decode(
            ESPNLeague.Player.self,
            from: Data(#"{"id":777,"fullName":"Name Match","proTeamId":6,"defaultPositionId":2}"#.utf8)
        )
        XCTAssertEqual(mapper.sleeperID(for: named, espnID: 777), "s2")

        let wrongTeam = try! JSONDecoder().decode(
            ESPNLeague.Player.self,
            from: Data(#"{"id":778,"fullName":"Name Match","proTeamId":12,"defaultPositionId":2}"#.utf8)
        )
        XCTAssertEqual(mapper.sleeperID(for: wrongTeam, espnID: 778), "espn:778")
    }

    // MARK: - Matchups

    func testMatchupsPairBothSidesWithPoints() {
        let week3 = ESPNTranslator.matchups(raw, week: 3, mapper: mapper)
        XCTAssertEqual(week3.count, 2)
        XCTAssertEqual(Set(week3.map(\.matchupID)), [3])

        let mine = week3.first { $0.rosterID == 1 }!
        XCTAssertEqual(mine.points, 48.2)
        let mahomes = sleeperID(named: "Patrick Mahomes")
        XCTAssertEqual(mine.playersPoints?[mahomes], 24.5)
        XCTAssertEqual(mine.playersPoints?["KC"], 11.4)
        // Starters follow the league template; unset slots are "0".
        XCTAssertEqual(mine.starters?.count, 9)
        XCTAssertEqual(mine.starters?.first, mahomes)
        XCTAssertEqual(mine.startersPoints?.first, 24.5)
        XCTAssertEqual(mine.players?.count, 4)

        let theirs = week3.first { $0.rosterID == 2 }!
        XCTAssertEqual(theirs.points, 30)

        // A week with only totals still pairs, with no lineups.
        let week1 = ESPNTranslator.matchups(raw, week: 1, mapper: mapper)
        XCTAssertEqual(week1.count, 2)
        XCTAssertEqual(week1.first { $0.rosterID == 1 }?.points, 130.5)
        XCTAssertNil(week1.first?.starters)
    }

    // MARK: - Service

    func testTheServiceCachesUnderItsOwnPrefixAndPurgesOnSignOut() async throws {
        let transport = StubTransport()
        await transport.on("/leagues/987654", data: try Fixtures.data("espn-league"))
        let (cache, directory) = makeTemporaryCache()
        defer { try? FileManager.default.removeItem(at: directory) }
        let crosswalk = self.crosswalk!
        let service = ESPNLeagueService(
            client: ESPNClient(credentials: ESPNCredentials(espnS2: "x", swid: "{Y}"), transport: transport, retries: 0),
            cache: cache,
            season: { 2026 },
            playerIndex: { nil },
            crosswalk: { crosswalk }
        )

        let league = try await service.league(id: "987654")
        XCTAssertEqual(league.value.name, "Test Private League")
        XCTAssertEqual(league.provenance, .live)
        let again = try await service.league(id: "987654")
        XCTAssertFalse(again.provenance.isLive)
        let requests = await transport.requestCount
        XCTAssertEqual(requests, 1)

        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertTrue(files.allSatisfy { $0.hasPrefix("espn-") })

        // Nothing translated yet is an empty answer, not an error.
        let drafts = try await service.drafts(leagueID: "987654")
        XCTAssertTrue(drafts.value.isEmpty)

        await service.purgeCache()
        let after = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        XCTAssertTrue(after.isEmpty)
    }
}
