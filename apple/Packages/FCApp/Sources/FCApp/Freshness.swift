import Foundation
import FCData

/// Turns a `Provenance` into the words the UI shows.
///
/// This exists as its own type because §6 makes freshness a first-class claim:
/// every screen that renders cached or bundled data owes the user a visible
/// note saying so, and that note should read the same everywhere.
public enum Freshness {
    /// A short label for a header or a chip. `nil` means the data is live and
    /// no label is owed.
    public static func label(for provenance: Provenance) -> String? {
        switch provenance {
        case .live:
            return nil
        case .cached(let age):
            return "Updated \(relative(age))"
        case .staleCache(let age, _):
            return "Offline — showing data from \(relative(age))"
        case .bundled:
            return "Shipped with the app"
        }
    }

    /// The longer form, for a detail row where there is room to be explicit
    /// about why the data is old.
    public static func explanation(for provenance: Provenance) -> String? {
        switch provenance {
        case .live:
            return nil
        case .cached(let age):
            return "Last refreshed \(relative(age))."
        case .staleCache(let age, _):
            return "Could not reach Sleeper, so this is the copy from \(relative(age))."
        case .bundled:
            return "This is the copy bundled at build time and may be behind."
        }
    }

    /// Whether to draw the label in a warning colour. Only stale data after a
    /// failed fetch is a problem.
    ///
    /// Bundled data used to count as degraded too, but seeing the app for the
    /// first time with data in it showed that was wrong: the bundled stats are
    /// the *normal* state until a static-data host exists, so every screen wore
    /// a permanent orange warning. It is still labelled — just not as an alarm.
    public static func isDegraded(_ provenance: Provenance) -> Bool {
        switch provenance {
        case .live, .cached, .bundled: return false
        case .staleCache: return true
        }
    }

    /// Ages phrased the way a person would say them. Deliberately coarse — the
    /// user wants to know whether to trust it, not the exact second.
    static func relative(_ age: TimeInterval) -> String {
        let seconds = max(0, Int(age))
        switch seconds {
        case ..<90:
            return "just now"
        case ..<3_600:
            let minutes = seconds / 60
            return "\(minutes) minute\(minutes == 1 ? "" : "s") ago"
        case ..<86_400:
            let hours = seconds / 3_600
            return "\(hours) hour\(hours == 1 ? "" : "s") ago"
        default:
            let days = seconds / 86_400
            return "\(days) day\(days == 1 ? "" : "s") ago"
        }
    }
}

/// The weakest provenance across several reads.
///
/// A screen assembled from four sources is only as fresh as its oldest part,
/// and claiming otherwise would be the kind of quiet overstatement §6 exists to
/// stop.
public extension Provenance {
    static func weakest(_ provenances: [Provenance]) -> Provenance {
        var worst: Provenance = .live
        for provenance in provenances where provenance.severity > worst.severity {
            worst = provenance
        }
        return worst
    }

    /// Higher means less trustworthy.
    var severity: Int {
        switch self {
        case .live: return 0
        case .cached: return 1
        case .bundled: return 2
        case .staleCache: return 3
        }
    }
}
