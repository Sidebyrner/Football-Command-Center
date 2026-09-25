import SwiftUI
import FCCore
import FCData

/// IDP Stream — free-agent defenders ranked by this week's projected points in
/// your scoring, each compared with the IDP starter a stream would replace.
public struct IDPStreamView: View {
    @ObservedObject var model: IDPStreamScreenModel

    public init(model: IDPStreamScreenModel) {
        self.model = model
    }

    public var body: some View {
        StreamScreenView(model: model, spec: Self.spec)
    }

    static let spec = StreamScreenSpec<IDPStreamKind>(
        title: "IDP Stream",
        systemImage: "shield.lefthalf.filled",
        filterPositions: [.lb, .dl, .db],
        scoringSummary: { s in
            let parts: [(String, Double)] = [
                ("solo", s.solo), ("ast", s.ast), ("sack", s.sack), ("TFL", s.tfl), ("PD", s.pd),
                ("INT", s.int), ("FF", s.ff), ("QB hit", s.qbHit),
            ]
            let paid = parts.filter { $0.1 != 0 }.map { "\($0.0) \($0.1.formatted(.number.precision(.fractionLength(0...1))))" }
            return paid.isEmpty ? "no IDP scoring set" : paid.joined(separator: " · ")
        },
        usage: { "\(StreamFormat.pct($0.snapShare)) snaps" },
        rowPills: { p in [
            StreamPill(label: "snaps", value: StreamFormat.whole(p.expSnaps)),
            StreamPill(label: "tackles", value: StreamFormat.one(p.expTackles)),
            StreamPill(label: "sacks", value: StreamFormat.two(p.eSack)),
            StreamPill(label: "TFL", value: StreamFormat.two(p.eTfl)),
            StreamPill(label: "QB hits", value: StreamFormat.two(p.eQbHit)),
            StreamPill(label: "pass def", value: StreamFormat.two(p.ePd)),
            StreamPill(label: "chance he plays", value: StreamFormat.pct(p.pPlay)),
        ] },
        starterPills: { p in [StreamPill(label: "snaps", value: StreamFormat.whole(p.expSnaps))] },
        compare: StreamCompareSpec(
            sections: { model, players in [
                StreamCompareSection(title: "Expected stat line", rows: [
                    .metric("Snaps", players.map(\.expSnaps), format: StreamFormat.whole),
                    .metric("Snap share", players.map(\.snapShare), format: StreamFormat.pct),
                    .metric("Solo", players.map(\.eSolo)),
                    .metric("Assist", players.map(\.eAst)),
                    .metric("Sack", players.map(\.eSack), format: StreamFormat.two),
                    .metric("TFL", players.map(\.eTfl), format: StreamFormat.two),
                    .metric("QB hit", players.map(\.eQbHit), format: StreamFormat.two),
                    .metric("Pass def", players.map(\.ePd), format: StreamFormat.two),
                ]),
                StreamCompareSection(title: "Points by stat, if he plays",
                                     rows: pointsRows(players.map { $0.pointsBreakdown(scoring: model.scoring) })),
                StreamCompareSection(title: "Matchup", rows: [
                    .metric("Tackle matchup ×", players.map(\.tklMult), format: StreamFormat.three),
                    .metric("Pass-pro ×", players.map(\.sackMult), format: StreamFormat.two),
                ]),
            ] },
            cardPills: { p in [
                StreamPill(label: "snaps", value: StreamFormat.whole(p.expSnaps)),
                StreamPill(label: "P(plays)", value: StreamFormat.pct(p.pPlay)),
            ] },
            breakdown: { model, p in p.pointsBreakdown(scoring: model.scoring) },
            recentGames: { model, id in
                model.recentGames(id).map { g in
                    var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
                    if let share = g.snapShare { parts.append(StreamFormat.pct(share)) }
                    parts.append("\(StreamFormat.whole(g.tackles)) tkl")
                    if g.sacks > 0 { parts.append("\(StreamFormat.one(g.sacks)) sk") }
                    return StreamGameCell(title: "\(StreamFormat.one(g.points)) pts", detail: parts.joined(separator: " · "))
                }
            }
        ),
        contextEditor: { AnyView(IDPContextEditorView(model: $0)) },
        playerEditor: { AnyView(IDPPlayerOverrideView(model: $0, row: $1)) }
    )
}

/// One metric row per stat any compared player scores, in first-seen order.
func pointsRows(_ breakdowns: [[StreamStatPoints]]) -> [StreamCompareRow] {
    var stats: [String] = []
    for breakdown in breakdowns {
        for part in breakdown where !stats.contains(part.stat) { stats.append(part.stat) }
    }
    return stats.map { stat in
        .metric(stat, breakdowns.map { $0.first { $0.stat == stat }?.points ?? 0 })
    }
}
