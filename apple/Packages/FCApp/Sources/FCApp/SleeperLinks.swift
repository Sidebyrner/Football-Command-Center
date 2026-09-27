import Foundation

/// Links into Sleeper, built in one place.
///
/// Sleeper's API is read-only, so every change a screen recommends has to be made
/// in Sleeper itself. On a phone with Sleeper installed this web address opens
/// the app through its universal link; without it, the page opens in Safari.
public enum SleeperLinks {
    public static func team(leagueID: String) -> URL? {
        let escaped = leagueID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? leagueID
        return URL(string: "https://sleeper.com/leagues/\(escaped)/team")
    }
}
