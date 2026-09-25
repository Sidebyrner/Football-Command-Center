import SwiftUI
import FCCore
import FCData

/// RB Stream — free-agent backs ranked by this week's projected points in
/// your scoring, each compared with the RB a stream would replace.
public struct RBStreamView: View {
    @ObservedObject var model: RBStreamScreenModel

    public init(model: RBStreamScreenModel) {
        self.model = model
    }

    public var body: some View {
        StreamScreenView(model: model, spec: Self.spec)
    }

    static let spec = StreamScreenSpec<RBStreamKind>(
        title: "RB Stream",
        systemImage: "figure.run",
        filterPositions: [],
        scoringSummary: { s in
            var parts: [String] = []
            parts.append(s.reception != 0 ? "\(num(s.reception)) per catch" : "no PPR")
            if s.rushingYard != 0 { parts.append("\(num(s.rushingYard))/yd") }
            if s.firstDown != 0 { parts.append("\(num(s.firstDown))/first down") }
            if s.touchdown != 0 { parts.append("\(num(s.touchdown))/TD") }
            let run40 = s.runBonus30 + s.runBonus40
            if run40 != 0 { parts.append("+\(num(run40)) 40+ yd run") }
            if s.touchdownBonus40 != 0 || s.touchdownBonus50 != 0 {
                parts.append("+\(num(s.touchdownBonus40)) 40+ yd TD, +\(num(s.touchdownBonus40 + s.touchdownBonus50)) 50+")
            }
            if s.fumble != 0 || s.fumbleLost != 0 {
                parts.append("fumble \(num(s.fumble)), lost \(num(s.fumble + s.fumbleLost))")
            }
            return parts.joined(separator: " · ")
        },
        usage: { "\(StreamFormat.pct($0.carryShare)) of carries" },
        rowPills: { p in [
            StreamPill(label: "car", value: StreamFormat.one(p.expCarries)),
            StreamPill(label: "tgt", value: StreamFormat.one(p.expTargets)),
            StreamPill(label: "ru yds", value: StreamFormat.whole(p.eRushYd)),
            StreamPill(label: "1st dn", value: StreamFormat.one(p.eFirstDowns)),
            StreamPill(label: "TD", value: StreamFormat.two(p.eTouchdowns)),
        ] },
        starterPills: { p in [
            StreamPill(label: "carries", value: StreamFormat.one(p.expCarries)),
            StreamPill(label: "implied", value: StreamFormat.one(p.implied)),
        ] },
        compare: StreamCompareSpec(
            sections: { model, players in [
                StreamCompareSection(title: "Expected stat line", rows: [
                    .metric("Carries", players.map(\.expCarries)),
                    .metric("Carry share", players.map(\.carryShare), format: StreamFormat.pct),
                    .metric("Targets", players.map(\.expTargets)),
                    .metric("Rush yards", players.map(\.eRushYd), format: StreamFormat.whole),
                    .metric("Rec yards", players.map(\.eRecYd), format: StreamFormat.whole),
                    .metric("Rush first downs", players.map(\.eRushFirstDowns)),
                    .metric("Rec first downs", players.map(\.eRecFirstDowns)),
                    .metric("TD", players.map(\.eTouchdowns), format: StreamFormat.two),
                    .metric("30+ plays", players.map(\.e30), format: StreamFormat.two),
                    .metric("40+ plays", players.map(\.e40), format: StreamFormat.two),
                    .text("Red-zone share", players.map { $0.redZoneShare.map(StreamFormat.pct) ?? "–" }),
                ]),
                StreamCompareSection(title: "Points by stat, if he plays",
                                     rows: pointsRows(players.map { $0.pointsBreakdown(scoring: model.scoring) })),
                StreamCompareSection(title: "Game script", rows: [
                    .metric("Implied team total", players.map(\.implied)),
                    .metric("Rush volume ×", players.map(\.rushEnv), format: StreamFormat.three),
                    .metric("RB matchup ×", players.map(\.dvpMult), format: StreamFormat.three),
                    .metric("Line ×", players.map(\.lineMult), format: StreamFormat.two),
                    .metric("Red zone ×", players.map(\.redZoneMult), format: StreamFormat.two),
                ]),
            ] },
            cardPills: { p in [
                StreamPill(label: "carries", value: StreamFormat.one(p.expCarries)),
                StreamPill(label: "1st dn", value: StreamFormat.one(p.eFirstDowns)),
            ] },
            breakdown: { model, p in p.pointsBreakdown(scoring: model.scoring) },
            recentGames: { model, id in
                model.recentGames(id).map { g in
                    var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
                    parts.append("\(StreamFormat.whole(g.carries))–\(StreamFormat.whole(g.rushYards))")
                    parts.append("\(StreamFormat.whole(g.firstDowns)) 1st dn")
                    if g.targets > 0 { parts.append("\(StreamFormat.whole(g.targets)) tgt") }
                    if g.touchdowns > 0 { parts.append("\(StreamFormat.whole(g.touchdowns)) TD") }
                    if let long = g.longestRun, long >= 20 { parts.append("long \(StreamFormat.whole(long))") }
                    if g.fumblesLost > 0 { parts.append("fumble lost") }
                    return StreamGameCell(title: "\(StreamFormat.one(g.points)) pts", detail: parts.joined(separator: " · "))
                }
            }
        ),
        contextEditor: { AnyView(RBContextEditorView(model: $0)) },
        playerEditor: { AnyView(RBPlayerOverrideView(model: $0, row: $1)) }
    )

    private static func num(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(0...2))) }
}
