import Foundation
import FCCore

/// `player-ids.json` — the bridge from a Sleeper player id to the gsis id the
/// nflverse weekly file is keyed by. Without it, nothing Sleeper tells us about
/// a roster can be joined to any production data.
///
/// This is a dynastyprocess export and **does not speak Sleeper's dialect**
/// (§3.2). The traps, all of which cost real debugging time in the web app:
///
/// - kickers are `PK`, not `K`
/// - there are **zero** `DEF` entries — team defenses are simply absent
/// - IDP positions are `CB`/`S`/`DE`/`DT`, not `DB`/`DL`
///
/// Position codes from this file are therefore always read through
/// `Position(dynastyProcess:)`, never compared as raw strings.
public struct PlayerIDCrosswalk: Decodable, Sendable {
    public let players: [String: Entry]

    public struct Entry: Decodable, Hashable, Sendable {
        public let gsisId: String?
        public let fantasyprosId: String?
        public let name: String?
        /// The **dynastyprocess** spelling. Use `position` rather than this.
        public let positionCode: String?
        public let team: String?

        enum CodingKeys: String, CodingKey {
            case gsisId, fantasyprosId, name, team
            case positionCode = "position"
        }

        /// Translated into the app's dialect. `nil` for codes this app does not
        /// model — punters (`PN`) and the file's `XX` placeholder — which is
        /// the honest answer rather than a guess.
        public var position: Position? { Position(dynastyProcess: positionCode) }

        /// Team in nflverse's spelling, which is what the weekly and schedule
        /// files use (§5.6).
        public var nflverseTeam: String? { NFLTeams.nflverse(team) }

        /// dynastyprocess marks unrostered players `FA`.
        public var isFreeAgent: Bool { team == "FA" }
    }

    enum CodingKeys: String, CodingKey {
        case players
    }

    /// The gsis id for a Sleeper player id, or `nil` when this file has no row.
    ///
    /// A `nil` here is expected and routine, not an error: every team defense
    /// returns `nil` because the file contains none, and a caller must treat
    /// that as "no production data for this player" rather than as a bug (§3.2).
    public func gsisID(forSleeperID sleeperID: String) -> String? {
        players[sleeperID]?.gsisId
    }

    public func entry(forSleeperID sleeperID: String) -> Entry? {
        players[sleeperID]
    }

    /// Reverse lookup, built on demand. The forward map is the common case;
    /// this exists for going from a weekly-file row back to a Sleeper roster.
    public func sleeperIDsByGSIS() -> [String: String] {
        var reverse: [String: String] = [:]
        reverse.reserveCapacity(players.count)
        for (sleeperID, entry) in players {
            guard let gsisId = entry.gsisId else { continue }
            reverse[gsisId] = sleeperID
        }
        return reverse
    }

    /// Maps a roster's Sleeper ids to gsis ids, reporting the ones that have no
    /// crosswalk row.
    ///
    /// Returns the misses rather than dropping them silently, because "we have
    /// no data for your DEF and both IDP slots" is exactly the kind of coverage
    /// gap the UI is required to state rather than paper over (§3.2).
    public func resolve(sleeperIDs: [String]) -> Resolution {
        var resolved: [String: String] = [:]
        var unmatched: [String] = []
        for id in sleeperIDs {
            if let gsisId = gsisID(forSleeperID: id) {
                resolved[id] = gsisId
            } else {
                unmatched.append(id)
            }
        }
        return Resolution(gsisBySleeperID: resolved, unmatched: unmatched)
    }

    public struct Resolution: Hashable, Sendable {
        public let gsisBySleeperID: [String: String]
        /// Sleeper ids with no row in this file — team defenses always, plus
        /// anyone too new or too obscure for the export.
        public let unmatched: [String]

        public var matchedCount: Int { gsisBySleeperID.count }
    }
}
