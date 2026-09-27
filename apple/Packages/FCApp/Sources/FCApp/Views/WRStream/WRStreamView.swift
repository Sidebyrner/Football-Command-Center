import SwiftUI
import FCCore
import FCData

/// WR Stream — free-agent receivers ranked by this week's projected points in
/// your scoring, each compared with the WR a stream would replace.
public struct WRStreamView: View {
    @ObservedObject var model: WRStreamScreenModel

    public init(model: WRStreamScreenModel) {
        self.model = model
    }

    public var body: some View {
        StreamScreenView(model: model, spec: Self.spec)
    }

    static let spec = StreamScreenSpec<WRStreamKind>(
        title: "WR Stream",
        systemImage: "figure.american.football",
        filterPositions: [],
        scoringSummary: { s in
            var parts: [String] = []
            if s.reception != 0 { parts.append("\(num(s.reception)) per catch") } else { parts.append("no PPR") }
            if s.receivingYard != 0 { parts.append("\(num(s.receivingYard))/yd") }
            if s.firstDown != 0 { parts.append("\(num(s.firstDown))/first down") }
            if s.touchdown != 0 { parts.append("\(num(s.touchdown))/TD") }
            if s.hasLongCatchBonuses {
                parts.append("+\(num(s.bonus30)) 30–39 yd catch, +\(num(s.bonus30 + s.bonus40)) 40+")
            }
            if s.touchdownBonus40 != 0 || s.touchdownBonus50 != 0 {
                parts.append("+\(num(s.touchdownBonus40)) 40+ yd TD, +\(num(s.touchdownBonus40 + s.touchdownBonus50)) 50+")
            }
            return parts.joined(separator: " · ")
        },
        usage: { "\(StreamFormat.pct($0.targetShare)) of targets" },
        rowPills: { p in [
            StreamPill(label: "targets", value: StreamFormat.one(p.expTargets)),
            StreamPill(label: "rec yds", value: StreamFormat.whole(p.eRecYd)),
            StreamPill(label: "first downs", value: StreamFormat.one(p.eFirstDowns)),
            StreamPill(label: "TDs", value: StreamFormat.two(p.eTouchdowns)),
            StreamPill(label: "30+ yd catches", value: StreamFormat.two(p.e30)),
            StreamPill(label: "chance he plays", value: StreamFormat.pct(p.pPlay)),
        ] },
        starterPills: { p in [
            StreamPill(label: "targets", value: StreamFormat.one(p.expTargets)),
            StreamPill(label: "1st dn", value: StreamFormat.one(p.eFirstDowns)),
        ] },
        compare: StreamCompareSpec(
            sections: { model, players in [
                StreamCompareSection(title: "Expected stat line", rows: [
                    .metric("Targets", players.map(\.expTargets)),
                    .metric("Target share", players.map(\.targetShare), format: StreamFormat.pct),
                    .metric("Receptions", players.map(\.eRec)),
                    .metric("Yards", players.map(\.eRecYd), format: StreamFormat.whole),
                    .metric("First downs", players.map(\.eFirstDowns)),
                    .metric("TD", players.map(\.eTouchdowns), format: StreamFormat.two),
                    .metric("30+ catches", players.map(\.e30), format: StreamFormat.two),
                    .metric("40+ catches", players.map(\.e40), format: StreamFormat.two),
                    .text("aDOT", players.map { $0.adot.map(StreamFormat.one) ?? "–" }),
                    .text("Red-zone share", players.map { $0.redZoneShare.map(StreamFormat.pct) ?? "–" }),
                ]),
                StreamCompareSection(title: "Points by stat, if he plays",
                                     rows: pointsRows(players.map { $0.pointsBreakdown(scoring: model.scoring) })),
                StreamCompareSection(title: "Matchup", rows: [
                    .metric("Pass volume ×", players.map(\.envMult), format: StreamFormat.three),
                    .metric("WR matchup ×", players.map(\.dvpMult), format: StreamFormat.three),
                    .metric("Coverage ×", players.map(\.coverageMult), format: StreamFormat.two),
                    .metric("Red zone ×", players.map(\.redZoneMult), format: StreamFormat.two),
                ]),
            ] },
            cardPills: { p in [
                StreamPill(label: "targets", value: StreamFormat.one(p.expTargets)),
                StreamPill(label: "1st dn", value: StreamFormat.one(p.eFirstDowns)),
            ] },
            breakdown: { model, p in p.pointsBreakdown(scoring: model.scoring) },
            recentGames: { model, id in
                model.recentGames(id).map { g in
                    var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
                    parts.append("\(StreamFormat.whole(g.receptions))/\(StreamFormat.whole(g.targets)) for \(StreamFormat.whole(g.yards))")
                    parts.append("\(StreamFormat.whole(g.firstDowns)) 1st dn")
                    if g.touchdowns > 0 { parts.append("\(StreamFormat.whole(g.touchdowns)) TD") }
                    if g.longCatches > 0 { parts.append("\(StreamFormat.whole(g.longCatches)) × 30+") }
                    return StreamGameCell(title: "\(StreamFormat.one(g.points)) pts", detail: parts.joined(separator: " · "))
                }
            }
        ),
        contextEditor: { AnyView(WRContextEditorView(model: $0)) },
        playerEditor: { AnyView(WRPlayerOverrideView(model: $0, row: $1)) }
    )

    private static func num(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(0...2))) }
}
