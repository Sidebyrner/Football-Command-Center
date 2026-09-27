import Foundation

/// A roster position in Sleeper's dialect, which is the dialect the app speaks
/// internally.
///
/// Everything that crosses a boundary translates *into* this type rather than
/// comparing raw strings, because the three feeds disagree:
///
/// - Sleeper: `QB RB WR TE K DEF LB DL DB`
/// - nflverse weekly file: `QB RB WR TE K` only — no DEF, no IDP (§3.2)
/// - dynastyprocess `player-ids.json`: kickers are `PK`, IDP is `CB`/`S`/`DE`/`DT`,
///   and there are zero `DEF` entries
public enum Position: String, CaseIterable, Codable, Hashable, Sendable {
    case qb = "QB"
    case rb = "RB"
    case wr = "WR"
    case te = "TE"
    case k = "K"
    case def = "DEF"
    case lb = "LB"
    case dl = "DL"
    case db = "DB"

    /// Offensive skill positions the nflverse weekly file actually covers.
    public static let coveredByWeeklyData: Set<Position> = [.qb, .rb, .wr, .te, .k]

    /// Individual defensive players.
    public static let idp: Set<Position> = [.lb, .dl, .db]

    /// Parses a Sleeper position code. `DST` is accepted as a synonym for `DEF`
    /// because some feeds use it.
    public init?(sleeper code: String?) {
        guard let code else { return nil }
        switch code.uppercased() {
        case "DST": self = .def
        // Sleeper lists most defenders by their football position, not the
        // IDP slot — live, about 2,000 active players are CB, DE, DT, OLB, SS
        // and the like rather than DB, DL or LB. Without these every one of
        // them has no position and falls out of the pool.
        case "CB", "S", "SS", "FS": self = .db
        case "DE", "DT", "NT": self = .dl
        case "ILB", "OLB", "MLB": self = .lb
        default:
            guard let value = Position(rawValue: code.uppercased()) else { return nil }
            self = value
        }
    }

    /// Parses a dynastyprocess position code (`player-ids.json`).
    ///
    /// This translation exists because `player-ids.json` does not speak
    /// Sleeper's dialect, and treating it as if it did cost real debugging time
    /// in the web app (§3.2). There is no `DEF` case on purpose: team defenses
    /// are simply absent from that file, so a caller must not expect one.
    public init?(dynastyProcess code: String?) {
        guard let code else { return nil }
        switch code.uppercased() {
        case "PK": self = .k
        case "CB", "S", "SS", "FS", "DB": self = .db
        case "DE", "DT", "NT", "DL": self = .dl
        case "LB", "ILB", "OLB", "MLB": self = .lb
        default:
            guard let value = Position(rawValue: code.uppercased()) else { return nil }
            self = value
        }
    }

    /// Whether the nflverse weekly stats file carries production rows for this
    /// position at all. `false` means "unsupported", which is a different claim
    /// from "scored zero" and the UI must say so (§3.2).
    public var hasWeeklyProductionData: Bool {
        Position.coveredByWeeklyData.contains(self)
    }
}
