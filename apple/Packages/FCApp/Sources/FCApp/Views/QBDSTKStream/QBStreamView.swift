import SwiftUI
import FCCore
import FCData

/// QB Stream — quarterbacks ranked on this week and the rest of the season,
/// each compared with the QB a stream would replace.
public struct QBStreamView: View {
    @ObservedObject var model: QBStreamScreenModel

    public init(model: QBStreamScreenModel) { self.model = model }

    public var body: some View {
        StreamScreenView(model: model, spec: Self.spec)
    }

    static let spec = StreamScreenSpec<QBStreamKind>(
        title: "QB Stream",
        systemImage: "football",
        filterPositions: [],
        scoringSummary: { s in
            var parts = ["\(num(s.passYard))/pass yd", "\(num(s.passTD))/pass TD"]
            if s.passFirstDown != 0 { parts.append("\(num(s.passFirstDown))/first down") }
            if s.incompletion != 0 { parts.append("\(num(s.incompletion)) per incompletion") }
            if s.sack != 0 { parts.append("\(num(s.sack)) per sack") }
            if s.interception != 0 { parts.append("INT \(num(s.interception)) (pick-six \(num(s.interception + s.pickSixExtra)))") }
            if s.bonus30 + s.bonus40 != 0 { parts.append("+\(num(s.bonus30 + s.bonus40)) 40+ completion") }
            if s.touchdownBonus40 != 0 { parts.append("+\(num(s.touchdownBonus40)) 40+ yd TD") }
            return parts.joined(separator: " · ")
        },
        usage: { p in "\(p.role.label) · \(StreamFormat.pct(p.compRate)) comp" },
        rowPills: { p in [
            StreamPill(label: "attempts", value: StreamFormat.one(p.expAtt)),
            StreamPill(label: "completion", value: StreamFormat.pct(p.compRate)),
            StreamPill(label: "pass yds", value: StreamFormat.whole(p.ePassYd)),
            StreamPill(label: "pass TDs", value: StreamFormat.two(p.ePassTd)),
            StreamPill(label: "INTs", value: StreamFormat.two(p.eInt)),
            StreamPill(label: "sacks", value: StreamFormat.one(p.eSacks)),
            StreamPill(label: "rush yds", value: StreamFormat.whole(p.eRushYd)),
        ] + StreamROSPills.pills(p.ros) },
        starterPills: { p in [
            StreamPill(label: "attempts", value: StreamFormat.one(p.expAtt)),
            StreamPill(label: "rest of season /g", value: StreamFormat.one(p.ros.perGame)),
        ] },
        compare: StreamCompareSpec(
            sections: { model, players in [
                StreamCompareSection(title: "Expected stat line", rows: [
                    .metric("Dropbacks", players.map(\.expDropbacks)),
                    .metric("Attempts", players.map(\.expAtt)),
                    .metric("Completion %", players.map(\.compRate), format: StreamFormat.pct),
                    .metric("Incompletions", players.map(\.eInc)),
                    .metric("Pass yards", players.map(\.ePassYd), format: StreamFormat.whole),
                    .metric("Pass first downs", players.map(\.ePassFd)),
                    .metric("Pass TD", players.map(\.ePassTd), format: StreamFormat.two),
                    .metric("INT", players.map(\.eInt), format: StreamFormat.two),
                    .metric("Sacks", players.map(\.eSacks)),
                    .metric("Rush yards", players.map(\.eRushYd), format: StreamFormat.whole),
                    .metric("Rush first downs", players.map(\.eRushFd)),
                ]),
                StreamCompareSection(title: "Points by stat, if he plays", rows: pointsRows(players.map(\.breakdown))),
                StreamCompareSection(title: "Matchup", rows: [
                    .metric("QB points ×", players.map(\.dvpMult), format: StreamFormat.three),
                    .metric("Completions ×", players.map(\.compAdj), format: StreamFormat.three),
                    .metric("Sacks ×", players.map(\.sackAdj), format: StreamFormat.three),
                    .metric("INTs ×", players.map(\.intAdj), format: StreamFormat.three),
                    .metric("Script ×", players.map(\.envMult), format: StreamFormat.three),
                ]),
                StreamROSPills.compareSection(players),
            ] },
            cardPills: { p in [
                StreamPill(label: "comp", value: StreamFormat.pct(p.compRate)),
                StreamPill(label: "ROS /g", value: StreamFormat.one(p.ros.perGame)),
            ] },
            breakdown: { _, p in p.breakdown },
            recentGames: { model, id in
                model.recentGames(id).map { g in
                    var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
                    parts.append("\(StreamFormat.whole(g.completions))/\(StreamFormat.whole(g.attempts)), \(StreamFormat.whole(g.yards)) yds")
                    if g.touchdowns > 0 { parts.append("\(StreamFormat.whole(g.touchdowns)) TD") }
                    if g.interceptions > 0 { parts.append("\(StreamFormat.whole(g.interceptions)) INT") }
                    if g.sacks > 0 { parts.append("\(StreamFormat.whole(g.sacks)) sk") }
                    if g.rushYards >= 10 { parts.append("\(StreamFormat.whole(g.rushYards)) rush") }
                    return StreamGameCell(title: "\(StreamFormat.one(g.points)) pts", detail: parts.joined(separator: " · "))
                }
            }
        ),
        contextEditor: { model in
            AnyView(StreamContextListView(
                model: model,
                footer: "Spread is from each offense's side: positive means that team is the underdog — more dropbacks, more pass volume.",
                row: { team in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(team.team).font(.subheadline.weight(.semibold))
                            Text(team.opponentLabel).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text("spread \(StreamFormat.signed(team.spreadOff)) · O/U \(StreamFormat.one(team.total))")
                                .font(.caption.monospacedDigit())
                        }
                        HStack(spacing: 8) {
                            Text("QB matchup \(team.dvpPct.map { StreamFormat.signed($0, places: 0) + "%" } ?? "–")")
                            Text("comp allowed \(team.oppCompAllowed.map(StreamFormat.pct) ?? "–")")
                            Text("sack \(team.oppSackRate.map(StreamFormat.pct) ?? "–")")
                            Spacer()
                            StreamSourceBadge(sources: [team.linesSource, team.dvpSource, team.ratesSource])
                        }
                        .font(.caption2).foregroundStyle(.secondary)
                    }
                },
                editor: { team in QBTeamEditorView(model: model, team: team) }
            ))
        },
        playerEditor: { model, row in AnyView(QBPlayerOverrideView(model: model, row: row)) }
    )

    static func num(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(0...2))) }
}

struct QBTeamEditorView: View {
    @ObservedObject var model: QBStreamScreenModel
    let team: QBTeamContext
    @Environment(\.dismiss) private var dismiss
    @State private var spread: Double
    @State private var total: Double
    @State private var dvp: Double
    @State private var dvpGames: Int
    @State private var comp: Double
    @State private var sack: Double
    @State private var int: Double

    init(model: QBStreamScreenModel, team: QBTeamContext) {
        self.model = model
        self.team = team
        _spread = State(initialValue: team.spreadOff)
        _total = State(initialValue: team.total)
        _dvp = State(initialValue: team.dvpPct ?? 0)
        _dvpGames = State(initialValue: max(team.dvpGames, 1))
        _comp = State(initialValue: team.oppCompAllowed ?? QBStreamKnobs.priorComp)
        _sack = State(initialValue: team.oppSackRate ?? QBStreamKnobs.priorSack)
        _int = State(initialValue: team.oppIntRate ?? QBStreamKnobs.priorINT)
    }

    private var auto: QBTeamContext? { model.autoTeams[team.team] }

    var body: some View {
        Form {
            Section {
                Stepper("Spread \(StreamFormat.signed(spread))", value: $spread, in: -25...25, step: 0.5)
                Stepper("Total \(StreamFormat.one(total))", value: $total, in: 30...65, step: 0.5)
            } header: {
                Text("\(team.team) \(team.opponentLabel)")
            } footer: {
                Text("Auto: spread \(StreamFormat.signed(auto?.spreadOff ?? 0)), total \(StreamFormat.one(auto?.total ?? 45)) — \(auto?.linesSource.label ?? "none"). Underdogs throw more.")
            }
            Section {
                Stepper("QB points \(StreamFormat.signed(dvp, places: 0))%", value: $dvp, in: -60...100, step: 5)
                Stepper("Based on \(dvpGames) games", value: $dvpGames, in: 1...17)
            } header: {
                Text("What \(team.opponent) allows to quarterbacks vs average")
            }
            Section {
                Stepper("Completion allowed \(StreamFormat.pct(comp))", value: $comp, in: 0.5...0.8, step: 0.005)
                Stepper("Sack rate \(StreamFormat.pct(sack))", value: $sack, in: 0.02...0.14, step: 0.0025)
                Stepper("INT rate \(StreamFormat.pct(int))", value: $int, in: 0.005...0.06, step: 0.001)
            } header: {
                Text("\(team.opponent) pass defense")
            } footer: {
                Text("Each moves the QB's own rate by half its difference from the league, capped. In this scoring incompletions and sacks cost a point each.")
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
        var change = QBTeamOverride(source: .manual)
        if spread != auto?.spreadOff { change.spreadOff = spread }
        if total != auto?.total { change.total = total }
        if dvp != (auto?.dvpPct ?? 0) || dvpGames != auto?.dvpGames { change.dvpPct = dvp; change.dvpGames = dvpGames }
        if comp != (auto?.oppCompAllowed ?? QBStreamKnobs.priorComp) { change.oppCompAllowed = comp }
        if sack != (auto?.oppSackRate ?? QBStreamKnobs.priorSack) { change.oppSackRate = sack }
        if int != (auto?.oppIntRate ?? QBStreamKnobs.priorINT) { change.oppIntRate = int }
        await model.setTeamOverride(change, team: team.team)
    }
}

struct QBPlayerOverrideView: View {
    @ObservedObject var model: QBStreamScreenModel
    let row: QBProjection
    @Environment(\.dismiss) private var dismiss
    @State private var role: QBRole
    @State private var practice: StreamPractice
    @State private var starterConf: Double
    @State private var notes: String

    init(model: QBStreamScreenModel, row: QBProjection) {
        self.model = model
        self.row = row
        _role = State(initialValue: row.role)
        _practice = State(initialValue: row.practice)
        _starterConf = State(initialValue: row.starterConf)
        _notes = State(initialValue: row.notes)
    }

    var body: some View {
        Form {
            Section {
                Picker("Role", selection: $role) {
                    ForEach(QBRole.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Picker("Status", selection: $practice) {
                    ForEach(StreamPractice.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            } footer: {
                Text("Role sets the rushing priors: a dual-threat's rushing first downs give him a floor.")
            }
            Section {
                Slider(value: $starterConf, in: 0.2...1, step: 0.05) { Text("Starter confidence") }
                Text("Starter confidence \(StreamFormat.two(starterConf)) — the share of dropbacks he takes if active. Lower it for a benching risk or a two-QB plan.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Notes") { TextField("Why", text: $notes, axis: .vertical) }
            Section {
                Button("Clear edits", role: .destructive) {
                    Task { await model.setPlayerOverride(nil, playerID: row.id); dismiss() }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(row.name)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        let existing = model.overrides.players[row.id]
                        let change = QBPlayerOverride(
                            role: role != row.role ? role : existing?.role,
                            practice: practice != row.practice ? practice : existing?.practice,
                            starterConf: starterConf != row.starterConf ? starterConf : existing?.starterConf,
                            notes: notes.isEmpty ? nil : notes
                        )
                        await model.setPlayerOverride(change, playerID: row.id)
                        dismiss()
                    }
                }
            }
        }
    }
}
