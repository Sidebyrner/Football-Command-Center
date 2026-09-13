import Foundation

/// The crosswalk between the three team dialects this app touches.
///
/// The Odds API returns full team names; Sleeper keys on its own abbreviation;
/// every nflverse-derived file in `public/data` uses a third set that differs
/// from Sleeper's on exactly one live team.
public enum NFLTeams {
    static let abbreviationsByName: [String: String] = [
        "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
        "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
        "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
        "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
        "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
        "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
        "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
        "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
        "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
        "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
        "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
    ]

    /// Built from the same table so the two directions can never drift apart.
    static let namesByAbbreviation: [String: String] = Dictionary(
        uniqueKeysWithValues: abbreviationsByName.map { ($0.value, $0.key) }
    )

    /// Sleeper (and The Odds API) team codes mapped to the codes every
    /// nflverse-derived file uses.
    ///
    /// There is exactly one live disagreement — Sleeper says `LAR`, nflverse
    /// says `LA`. It is one team, but without this every Rams player silently
    /// falls through to "no game this week" and reads as on bye, which looks
    /// like missing data rather than a join bug. The relocated-franchise codes
    /// are here so historical seasons join too (§5.6).
    public static let nflverseAliases: [String: String] = [
        "LAR": "LA",
        "STL": "LA",
        "SD": "LAC",
        "OAK": "LV",
    ]

    public static func abbreviation(oddsAPIName name: String?) -> String? {
        guard let name else { return nil }
        return abbreviationsByName[name]
    }

    /// Accepts either dialect: the name table is keyed on The Odds API's codes
    /// (`LAR`), but callers routinely hold an nflverse code (`LA`), so fall back
    /// through the alias map rather than returning nothing where a team name
    /// belongs.
    public static func name(abbreviation: String?) -> String? {
        guard let abbreviation, !abbreviation.isEmpty else { return nil }
        if let name = namesByAbbreviation[abbreviation] { return name }
        for (alias, canonical) in nflverseAliases
        where canonical == abbreviation {
            if let name = namesByAbbreviation[alias] { return name }
        }
        return nil
    }

    /// Normalises a Sleeper-sourced team code into the nflverse dialect.
    ///
    /// **Apply this before any join between a Sleeper-sourced team and an
    /// nflverse-sourced team.** Skipping it silently breaks bye detection for
    /// every Rams player.
    public static func nflverse(_ abbreviation: String?) -> String? {
        guard let abbreviation, !abbreviation.isEmpty else { return nil }
        return nflverseAliases[abbreviation] ?? abbreviation
    }
}
