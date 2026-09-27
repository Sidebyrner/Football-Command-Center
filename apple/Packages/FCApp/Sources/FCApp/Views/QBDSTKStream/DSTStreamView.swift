import SwiftUI
import FCCore
import FCData

/// D/ST Stream — team defenses ranked on this week and the rest of the season.
public struct DSTStreamView: View {
    @ObservedObject var model: DSTStreamScreenModel

    public init(model: DSTStreamScreenModel) { self.model = model }

    public var body: some View {
        StreamScreenView(model: model, spec: Self.spec)
    }

    static let spec = StreamScreenSpec<DSTStreamKind>(
        title: "D/ST Stream",
        systemImage: "shield",
        filterPositions: [],
        scoringSummary: { s in
            var parts = ["sack \(num(s.sack))", "INT \(num(s.interception))", "fumble rec \(num(s.fumbleRecovery))", "TD \(num(s.touchdown))"]
            if let shutout = s.pointsAllowed.first?.points, let blowout = s.pointsAllowed.last?.points {
                parts.append("points allowed \(num(shutout)) to \(num(blowout))")
            }
            if s.yardsAllowed.contains(where: { $0.points != 0 }) { parts.append("yards-allowed tiers") }
            return parts.joined(separator: " · ")
        },
        usage: { p in "opp implied \(StreamFormat.one(p.impliedOpp))" },
        rowPills: { p in [
            StreamPill(label: "sacks", value: StreamFormat.one(p.eSacks)),
            StreamPill(label: "takeaways", value: StreamFormat.two(p.eTakeaways)),
            StreamPill(label: "TDs", value: StreamFormat.two(p.eTd)),
            StreamPill(label: "points allowed pts", value: StreamFormat.one(p.paPts)),
            StreamPill(label: "opp implied", value: StreamFormat.one(p.impliedOpp)),
        ] + StreamROSPills.pills(p.ros) },
        starterPills: { p in [
            StreamPill(label: "opp implied", value: StreamFormat.one(p.impliedOpp)),
            StreamPill(label: "rest of season /g", value: StreamFormat.one(p.ros.perGame)),
        ] },
        compare: StreamCompareSpec(
            sections: { _, players in [
                StreamCompareSection(title: "Expected stat line", rows: [
                    .metric("Opponent dropbacks", players.map(\.expDropbacks)),
                    .metric("Sacks", players.map(\.eSacks)),
                    .metric("Interceptions", players.map(\.eInt), format: StreamFormat.two),
                    .metric("Fumble recoveries", players.map(\.eFr), format: StreamFormat.two),
                    .metric("Touchdowns", players.map(\.eTd), format: StreamFormat.two),
                    .metric("Opp implied points", players.map(\.impliedOpp)),
                    .metric("Points allowed (est.)", players.map(\.paMean)),
                ]),
                StreamCompareSection(title: "Points by stat, if they play", rows: pointsRows(players.map(\.breakdown))),
                StreamCompareSection(title: "Matchup", rows: [
                    .metric("Matchup ×", players.map(\.dvpMult), format: StreamFormat.three),
                    .metric("QB adj ×", players.map(\.qbAdj), format: StreamFormat.two),
                    .metric("Rest-of-season opp PPG", players.map(\.rosAvgOppPpg)),
                ]),
                StreamROSPills.compareSection(players),
            ] },
            cardPills: { p in [
                StreamPill(label: "takeaways", value: StreamFormat.two(p.eTakeaways)),
                StreamPill(label: "ROS /g", value: StreamFormat.one(p.ros.perGame)),
            ] },
            breakdown: { _, p in p.breakdown },
            recentGames: { model, id in
                model.recentGames(id).map { g in
                    var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
                    parts.append("\(StreamFormat.whole(g.sacks)) sk")
                    if g.takeaways > 0 { parts.append("\(StreamFormat.whole(g.takeaways)) TO") }
                    if g.touchdowns > 0 { parts.append("\(StreamFormat.whole(g.touchdowns)) TD") }
                    parts.append("\(StreamFormat.whole(g.pointsAllowed)) allowed")
                    return StreamGameCell(title: "\(StreamFormat.one(g.points)) pts", detail: parts.joined(separator: " · "))
                }
            }
        ),
        contextEditor: { model in
            AnyView(StreamContextListView(
                model: model,
                footer: "Spread is from each defense's side: positive means that team is the underdog, so its opponent is expected to score more.",
                row: { team in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(team.team).font(.subheadline.weight(.semibold))
                            Text(team.opponentLabel).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text("opp implied \(StreamFormat.one(team.opponentImplied))").font(.caption.monospacedDigit())
                        }
                        HStack(spacing: 8) {
                            Text("matchup \(team.dvpPct.map { StreamFormat.signed($0, places: 0) + "%" } ?? "–")")
                            Text("QB adj ×\(StreamFormat.two(team.oppQbAdj))")
                            Spacer()
                            StreamSourceBadge(sources: [team.linesSource, team.dvpSource, team.qbSource])
                        }
                        .font(.caption2).foregroundStyle(.secondary)
                    }
                },
                editor: { team in DSTTeamEditorView(model: model, team: team) }
            ))
        },
        playerEditor: { model, row in AnyView(DSTNotesView(model: model, row: row)) }
    )

    static func num(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(0...2))) }
}

struct DSTTeamEditorView: View {
    @ObservedObject var model: DSTStreamScreenModel
    let team: DSTTeamContext
    @Environment(\.dismiss) private var dismiss
    @State private var spread: Double
    @State private var total: Double
    @State private var qbAdj: Double
    @State private var dvp: Double
    @State private var dvpGames: Int

    init(model: DSTStreamScreenModel, team: DSTTeamContext) {
        self.model = model
        self.team = team
        _spread = State(initialValue: team.spreadDef)
        _total = State(initialValue: team.total)
        _qbAdj = State(initialValue: team.oppQbAdj)
        _dvp = State(initialValue: team.dvpPct ?? 0)
        _dvpGames = State(initialValue: max(team.dvpGames, 1))
    }

    private var auto: DSTTeamContext? { model.autoTeams[team.team] }

    var body: some View {
        Form {
            Section {
                Stepper("Spread \(StreamFormat.signed(spread))", value: $spread, in: -25...25, step: 0.5)
                Stepper("Total \(StreamFormat.one(total))", value: $total, in: 30...65, step: 0.5)
            } header: {
                Text("\(team.team) \(team.opponentLabel)")
            } footer: {
                Text("\(team.opponent) is expected to score \(StreamFormat.one((total + spread) / 2)) — the points-allowed tiers are scored around that.")
            }
            Section {
                Stepper("×\(StreamFormat.two(qbAdj))", value: $qbAdj, in: 0.7...1.6, step: 0.05)
            } header: {
                Text("\(team.opponent) QB / O-line")
            } footer: {
                Text("1.00 is neutral. Raise it for a backup quarterback or O-line injuries — more sacks and turnovers.")
            }
            Section {
                Stepper("D/ST points \(StreamFormat.signed(dvp, places: 0))%", value: $dvp, in: -80...150, step: 5)
                Stepper("Based on \(dvpGames) games", value: $dvpGames, in: 1...17)
            } header: {
                Text("What \(team.opponent) gives up to defenses vs average")
            }
            Section {
                Button("Reset to auto", role: .destructive) {
                    Task { await model.setTeamOverride(nil, team: team.team); dismiss() }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(team.team)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save(); dismiss() } } }
        }
    }

    private func save() async {
        var change = DSTTeamOverride(source: .manual)
        if spread != auto?.spreadDef { change.spreadDef = spread }
        if total != auto?.total { change.total = total }
        if qbAdj != auto?.oppQbAdj { change.oppQbAdj = qbAdj }
        if dvp != (auto?.dvpPct ?? 0) || dvpGames != auto?.dvpGames { change.dvpPct = dvp; change.dvpGames = dvpGames }
        await model.setTeamOverride(change, team: team.team)
    }
}

struct DSTNotesView: View {
    @ObservedObject var model: DSTStreamScreenModel
    let row: DSTProjection
    @Environment(\.dismiss) private var dismiss
    @State private var notes: String

    init(model: DSTStreamScreenModel, row: DSTProjection) {
        self.model = model
        self.row = row
        _notes = State(initialValue: row.notes)
    }

    var body: some View {
        Form {
            Section {
                Text("A defense's inputs are its game's: edit the spread, total and the opponent's QB situation in Game context.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Notes") { TextField("Why", text: $notes, axis: .vertical) }
        }
        .formStyle(.grouped)
        .navigationTitle(row.name)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        await model.setPlayerOverride(notes.isEmpty ? nil : DSTPlayerOverride(notes: notes), playerID: row.id)
                        dismiss()
                    }
                }
            }
        }
    }
}
