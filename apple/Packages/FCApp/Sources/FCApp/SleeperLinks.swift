import Foundation

/// Links into Sleeper, built in one place.
///
/// Sleeper's API is read-only, so every change a screen recommends has to be made
/// in Sleeper itself. On a phone with Sleeper installed this web address opens
/// the app through its universal link; without it, the page opens in Safari.
public enum SleeperLinks {
    /// The user's team page on whichever platform hosts the league.
    public static func team(for context: LeagueContext) -> URL? {
        switch context.provider {
        case .sleeper:
            return team(leagueID: context.league.leagueID)
        case .espn:
            let league = context.league.leagueID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
                ?? context.league.leagueID
            return URL(string: "https://fantasy.espn.com/football/team?leagueId=\(league)&teamId=\(context.userRosterID)")
        }
    }

    public static func team(leagueID: String) -> URL? {
        let escaped = leagueID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? leagueID
        return URL(string: "https://sleeper.com/leagues/\(escaped)/team")
    }
}
