import Foundation

/// Which question a comparison answers. The same players and the same grid,
/// two different calls: who to start this week, or who to keep and add for
/// the rest of the season.
public enum CompareLens: String, CaseIterable, Hashable, Sendable, Identifiable {
    case thisWeek, restOfSeason

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .thisWeek: return "This week"
        case .restOfSeason: return "Rest of season"
        }
    }

    public var question: String {
        switch self {
        case .thisWeek: return "Who starts this week"
        case .restOfSeason: return "Who to keep, add or drop"
        }
    }
}
