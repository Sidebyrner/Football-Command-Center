import Foundation
import FCCore
import FCData

/// A Discovery sort: the Waiver Board's nine columns, or the name.
public enum DiscoverySort: Hashable, Sendable, Identifiable {
    case name
    case column(WaiverSort)

    public var id: String { storageKey }

    /// For `PanelSettings.extra["sort"]`: "name" or the column's raw value.
    public var storageKey: String {
        switch self {
        case .name: return "name"
        case .column(let sort): return sort.rawValue
        }
    }

    public init?(storageKey: String) {
        if storageKey == "name" { self = .name; return }
        guard let sort = WaiverSort(rawValue: storageKey) else { return nil }
        self = .column(sort)
    }

    public var label: String {
        switch self {
        case .name: return "Name"
        case .column(let sort): return sort.label
        }
    }

    public var unit: String? {
        switch self {
        case .name: return nil
        case .column(let sort): return sort.unit
        }
    }

    public static let all: [DiscoverySort] = [.name] + WaiverSort.allCases.map(DiscoverySort.column)
}

/// Discovery — every active player you could pick up at the positions your
/// league starts, with or without data yet, searchable and sortable on any
/// Waiver Board column. The same rows the board builds; the board just hides
/// the ones with no numbers.
@MainActor
public final class DiscoveryModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    /// Every acquirable row, unfiltered.
    @Published public private(set) var allRows: [WaiverRow] = []
    /// `allRows` after the search, position, bench toggle and sort.
    @Published public private(set) var visible: [WaiverRow] = []
    /// Defense-vs-position for this context, built once; the Schedule and
    /// Compare panels read it from here.
    @Published public private(set) var defense: DefenseLookup = .empty
    /// Weekly metrics and leaderboards for the Metric panels, per context.
    @Published public private(set) var metrics: PlayerMetricsIndex?
    @Published public private(set) var trendingUnavailable = false

    @Published public var sort: DiscoverySort = .column(.projected) { didSet { applyFilters() } }
    @Published public var positionFilter: Position? { didSet { applyFilters() } }
    @Published public var includeRivalBenches = false { didSet { applyFilters() } }
    @Published public var query = "" { didSet { applyFilters() } }

    private var builder: RowBuilder?
    private var rowCache: [String: WaiverRow] = [:]
    private let loader: LeagueContextLoader
    private let sleeper: SleeperService?

    public init(loader: LeagueContextLoader, sleeper: SleeperService? = nil) {
        self.loader = loader
        self.sleeper = sleeper
    }

    public func load(leagueID: String, userRosterID: Int, season: Int? = nil, force: Bool = false) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let context = try await loader.load(leagueID: leagueID, userRosterID: userRosterID, season: season, force: force)
            var trending: [String: Int] = [:]
            if let sleeper, let adds = try? await sleeper.trendingAdds(force: force) {
                trending = Dictionary(adds.value.map { ($0.playerID, $0.count) }, uniquingKeysWith: { first, _ in first })
                trendingUnavailable = false
            } else {
                trendingUnavailable = true
            }
            let builder = RowBuilder(context: context, trending: trending)
            // Scoring a season of rows is the expensive part; keep it off the main thread.
            let defense = await Task.detached(priority: .userInitiated) { DefenseLookup.build(context: context) }.value
            self.context = context
            self.builder = builder
            self.defense = defense
            metrics = PlayerMetricsIndex(context: context)
            rowCache = [:]
            allRows = builder.acquirableRows(includeNoData: true)
            fallBackToAValuedSort()
            applyFilters()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// A column nobody has a number for is a wall of dashes — projections
    /// unreachable, or no Sleeper lines yet. Move to the first column that
    /// values someone, as the Waiver Board does.
    func fallBackToAValuedSort() {
        guard case .column(let column) = sort, !allRows.isEmpty,
              !allRows.contains(where: { $0.value(column) != nil }) else { return }
        if let usable = WaiverSort.allCases.first(where: { c in allRows.contains { $0.value(c) != nil } }) {
            sort = .column(usable)
        }
    }

    /// A row for any player in the pool, rostered or not.
    public func row(for id: String) -> WaiverRow? {
        if let cached = rowCache[id] { return cached }
        if let row = allRows.first(where: { $0.id == id }) ?? builder?.row(id: id) {
            rowCache[id] = row
            return row
        }
        return nil
    }

    /// Positions the league starts, in template order.
    public var filterablePositions: [Position] {
        guard let context else { return [] }
        var seen: Set<Position> = []
        var out: [Position] = []
        for slot in context.template.starters {
            for position in slot.eligible.sorted(by: { $0.rawValue < $1.rawValue }) where seen.insert(position).inserted {
                out.append(position)
            }
        }
        return out
    }

    /// Rows the current sort can't value — they sit at the bottom.
    public var unvaluedCount: Int {
        guard case .column(let column) = sort else { return 0 }
        return visible.filter { $0.value(column) == nil }.count
    }

    /// The rows a panel shows: the shared search and bench toggle, with the
    /// panel's own position and sort when it has them.
    public func rows(position: Position?, sort: DiscoverySort?) -> [WaiverRow] {
        guard position != nil || sort != nil else { return visible }
        return Self.filtered(allRows, query: query, position: position ?? positionFilter,
                             includeRivalBenches: includeRivalBenches, sort: sort ?? self.sort)
    }

    func applyFilters() {
        visible = Self.filtered(allRows, query: query, position: positionFilter,
                                includeRivalBenches: includeRivalBenches, sort: sort)
    }

    static func filtered(_ rows: [WaiverRow], query: String, position: Position?,
                         includeRivalBenches: Bool, sort: DiscoverySort) -> [WaiverRow] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        var out: [(row: WaiverRow, match: Int)] = []
        for row in rows {
            if !includeRivalBenches, row.availability != .freeAgent { continue }
            if let position, row.position != position { continue }
            if needle.isEmpty {
                out.append((row, 0))
            } else if let score = FuzzyNameMatch.score(query: needle, name: row.name,
                                                       extra: [row.team, row.position.rawValue].compactMap { $0 }) {
                out.append((row, score))
            }
        }
        out.sort { a, b in
            switch sort {
            case .name:
                return a.row.name < b.row.name
            case .column(let column):
                switch (a.row.value(column), b.row.value(column)) {
                case let (x?, y?): return x == y ? a.row.name < b.row.name : x > y
                case (_?, nil): return true
                case (nil, _?): return false
                case (nil, nil): return a.row.name < b.row.name
                }
            }
        }
        return out.map(\.row)
    }
}
