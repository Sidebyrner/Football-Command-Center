import XCTest
import FCData
@testable import FCApp

/// Accent themes and the relay address, as stored settings.
@MainActor
final class AppearanceSettingsTests: XCTestCase {
    private func model(_ settings: AppSettings = AppSettings()) -> (SettingsModel, InMemorySettingsStore) {
        let store = InMemorySettingsStore(settings)
        let sleeper = SleeperService(
            client: SleeperClient(transport: StubTransport(), retries: 0),
            cache: DiskCache(directory: FileManager.default.temporaryDirectory
                .appendingPathComponent("fcapp-appearance-\(UUID().uuidString)"))
        )
        return (SettingsModel(sleeper: sleeper, store: store, secrets: InMemorySecretStore()), store)
    }

    // MARK: - Accent theme

    func testANewInstallUsesTheDefaultTheme() {
        XCTAssertEqual(AppSettings().accentTheme, .amber)
    }

    func testAChosenThemePersists() {
        let (model, store) = model()
        model.setAccentTheme(.teal)
        XCTAssertEqual(store.load().accentTheme, .teal)
        XCTAssertEqual(model.settings.accentTheme, .teal)
    }

    /// Settings saved before themes existed must still load — with the league
    /// intact. A thrown decode here would silently reset the user's setup.
    func testSettingsSavedBeforeThemesExistedStillLoad() throws {
        let old = #"{"sleeperUsername":"connor","userID":"u1","leagueID":"L1","rosterID":3}"#
        let settings = try JSONDecoder().decode(AppSettings.self, from: Data(old.utf8))

        XCTAssertEqual(settings.leagueID, "L1")
        XCTAssertEqual(settings.rosterID, 3)
        XCTAssertEqual(settings.accentTheme, .default)
        XCTAssertFalse(settings.hasSeenPlanningIntro)
    }

    /// A theme a later version removed falls back rather than failing.
    func testAnUnknownThemeFallsBackToTheDefault() throws {
        let future = #"{"leagueID":"L1","rosterID":1,"accentTheme":"neonMagenta"}"#
        let settings = try JSONDecoder().decode(AppSettings.self, from: Data(future.utf8))

        XCTAssertEqual(settings.accentTheme, .default)
        XCTAssertEqual(settings.leagueID, "L1", "the rest of the settings survive")
    }

    func testThemesRoundTrip() throws {
        for theme in AccentTheme.allCases {
            let data = try JSONEncoder().encode(AppSettings(accentTheme: theme))
            XCTAssertEqual(try JSONDecoder().decode(AppSettings.self, from: data).accentTheme, theme)
        }
    }

    // MARK: - Relay address

    func testABareHostGetsHTTPS() {
        let (model, store) = model()
        XCTAssertTrue(model.setRelayURL(text: "  relay.example.com  "))
        XCTAssertEqual(store.load().relayBaseURL?.absoluteString, "https://relay.example.com")
        XCTAssertNil(model.relayError)
    }

    func testAnExplicitSchemeAndPortAreKept() {
        let (model, store) = model()
        XCTAssertTrue(model.setRelayURL(text: "http://192.168.1.20:3001"))
        XCTAssertEqual(store.load().relayBaseURL?.absoluteString, "http://192.168.1.20:3001")
    }

    /// A non-web scheme would make every request fail, so it is refused with a
    /// message rather than saved.
    func testANonWebAddressIsRefused() {
        let (model, store) = model(AppSettings(relayBaseURL: URL(string: "https://kept.example.com")))
        XCTAssertFalse(model.setRelayURL(text: "ftp://files.example.com"))
        XCTAssertNotNil(model.relayError)
        XCTAssertEqual(store.load().relayBaseURL?.host, "kept.example.com", "the previous address is kept")
    }

    func testClearingTheFieldRemovesTheRelay() {
        let (model, store) = model(AppSettings(relayBaseURL: URL(string: "https://relay.example.com")))
        XCTAssertTrue(model.setRelayURL(text: "   "))
        XCTAssertNil(store.load().relayBaseURL)
    }

    func testThePlanningIntroIsRemembered() {
        let (model, store) = model()
        model.markPlanningIntroSeen()
        XCTAssertTrue(store.load().hasSeenPlanningIntro)
    }
}
