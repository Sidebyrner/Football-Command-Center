import SwiftUI
import FCCore
import FCData

/// K Stream — kickers ranked on this week and the rest of the season.
public struct KStreamView: View {
    @ObservedObject var model: KStreamScreenModel

    public init(model: KStreamScreenModel) { self.model = model }

    public var body: some View {
        StreamScreenView(model: model, spec: Self.spec)
    }

    static let spec = StreamScreenSpec<KStreamKind>(
        title: "K Stream",
        systemImage: "figure.australian.football",
        filterPositions: [],
        scoringSummary: { s in
            var parts = KBucket.allCases.map { "\($0.label) \(num(s.make($0)))" }
            parts.append("XP \(num(s.extraPoint))")
            let misses = Set(KBucket.allCases.map { s.miss($0) })
            if misses.count == 1, let miss = misses.first { parts.append("miss \(num(miss))") } else { parts.append("misses by distance") }
            return parts.joined(separator: " · ")
        },
        usage: { p in "\(p.venue.label) · implied \(StreamFormat.one(p.implied))" },
        rowPills: { p in [
            StreamPill(label: "FG attempts", value: StreamFormat.two(p.eFga)),
            StreamPill(label: "FG made", value: StreamFormat.two(p.eFgm)),
            StreamPill(label: "50+ attempts", value: StreamFormat.two(p.e50pAtt)),
            StreamPill(label: "extra points", value: StreamFormat.two(p.eXpm)),
            StreamPill(label: "implied", value: StreamFormat.one(p.implied)),
        ] + StreamROSPills.pills(p.ros) },
        starterPills: { p in [
            StreamPill(label: "FG attempts", value: StreamFormat.two(p.eFga)),
            StreamPill(label: "rest of season /g", value: StreamFormat.one(p.ros.perGame)),
        ] },
        compare: StreamCompareSpec(
            sections: { _, players in [
                StreamCompareSection(title: "Expected kicks", rows: [
                    .metric("FG attempts", players.map(\.eFga), format: StreamFormat.two),
                    .metric("FG made", players.map(\.eFgm), format: StreamFormat.two),
                    .metric("FG missed", players.map(\.eMiss), format: StreamFormat.two),
                    .metric("50+ yard attempts", players.map(\.e50pAtt), format: StreamFormat.two),
                    .metric("Extra points", players.map(\.eXpm), format: StreamFormat.two),
                    .metric("Implied team total", players.map(\.implied)),
                ]),
                StreamCompareSection(title: "Points by kick, if he plays", rows: pointsRows(players.map(\.breakdown))),
                StreamCompareSection(title: "Conditions", rows: [
                    .text("Venue", players.map(\.venue.label)),
                    .metric("Wind over 12 mph", players.map(\.windOver), format: StreamFormat.whole),
                    .metric("Stall ×", players.map(\.stall), format: StreamFormat.two),
                    .metric("Matchup ×", players.map(\.dvpMult), format: StreamFormat.three),
                ]),
                StreamROSPills.compareSection(players),
            ] },
            cardPills: { p in [
                StreamPill(label: "FGA", value: StreamFormat.two(p.eFga)),
                StreamPill(label: "ROS /g", value: StreamFormat.one(p.ros.perGame)),
            ] },
            breakdown: { _, p in p.breakdown },
            recentGames: { model, id in
                model.recentGames(id).map { g in
                    var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
                    parts.append("\(StreamFormat.whole(g.made))/\(StreamFormat.whole(g.attempts)) FG")
                    if let long = g.longest, long > 0 { parts.append("long \(StreamFormat.whole(long))") }
                    parts.append("\(StreamFormat.whole(g.extraPoints)) XP")
                    return StreamGameCell(title: "\(StreamFormat.one(g.points)) pts", detail: parts.joined(separator: " · "))
                }
            }
        ),
        contextEditor: { model in
            AnyView(StreamContextListView(
                model: model,
                footer: "No weather feed yet: enter wind and rain for outdoor games. Wind over 12 mph cuts long attempts and make rates; a dome and Denver's altitude help.",
                row: { team in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(team.team).font(.subheadline.weight(.semibold))
                            Text(team.opponentLabel).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text("implied \(StreamFormat.one(team.implied))").font(.caption.monospacedDigit())
                        }
                        HStack(spacing: 8) {
                            Text(team.venue.label)
                            if team.venue != .dome {
                                Text("wind \(StreamFormat.whole(team.windMph)) mph · rain \(StreamFormat.whole(team.precipPct))%")
                            }
                            if team.altitude { Text("altitude") }
                            Spacer()
                            StreamSourceBadge(sources: [team.linesSource, team.dvpSource, team.weatherSource])
                        }
                        .font(.caption2).foregroundStyle(.secondary)
                    }
                },
                editor: { team in KTeamEditorView(model: model, team: team) }
            ))
        },
        playerEditor: { model, row in AnyView(KPlayerOverrideView(model: model, row: row)) }
    )

    static func num(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(0...2))) }
}

struct KTeamEditorView: View {
    @ObservedObject var model: KStreamScreenModel
    let team: KTeamContext
    @Environment(\.dismiss) private var dismiss
    @State private var spread: Double
    @State private var total: Double
    @State private var venue: KVenue
    @State private var wind: Double
    @State private var rain: Double
    @State private var dvp: Double
    @State private var dvpGames: Int

    init(model: KStreamScreenModel, team: KTeamContext) {
        self.model = model
        self.team = team
        _spread = State(initialValue: team.spreadOff)
        _total = State(initialValue: team.total)
        _venue = State(initialValue: team.venue)
        _wind = State(initialValue: team.windMph)
        _rain = State(initialValue: team.precipPct)
        _dvp = State(initialValue: team.dvpPct ?? 0)
        _dvpGames = State(initialValue: max(team.dvpGames, 1))
    }

    private var auto: KTeamContext? { model.autoTeams[team.team] }

    var body: some View {
        Form {
            Section {
                Stepper("Spread \(StreamFormat.signed(spread))", value: $spread, in: -25...25, step: 0.5)
                Stepper("Total \(StreamFormat.one(total))", value: $total, in: 30...65, step: 0.5)
            } header: {
                Text("\(team.team) \(team.opponentLabel)")
            } footer: {
                Text("Implied \(StreamFormat.one((total - spread) / 2)) — attempts follow the implied total.")
            }
            Section {
                Picker("Venue", selection: $venue) {
                    ForEach(KVenue.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                Stepper("Wind \(StreamFormat.whole(wind)) mph", value: $wind, in: 0...40, step: 1)
                    .disabled(venue == .dome)
                Stepper("Rain \(StreamFormat.whole(rain))%", value: $rain, in: 0...100, step: 10)
                    .disabled(venue == .dome)
            } header: {
                Text("Conditions")
            } footer: {
                Text("From the forecast. Wind over 12 mph moves 50+ attempts to shorter kicks and cuts long make rates; rain trims every make rate.")
            }
            Section {
                Stepper("K points \(StreamFormat.signed(dvp, places: 0))%", value: $dvp, in: -60...100, step: 5)
                Stepper("Based on \(dvpGames) games", value: $dvpGames, in: 1...17)
            } header: {
                Text("What \(team.opponent) allows to kickers vs average")
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
        var change = KTeamOverride(source: .manual)
        if spread != auto?.spreadOff { change.spreadOff = spread }
        if total != auto?.total { change.total = total }
        if venue != auto?.venue { change.venue = venue }
        if wind != (auto?.windMph ?? 0) { change.windMph = wind }
        if rain != (auto?.precipPct ?? 0) { change.precipPct = rain }
        if dvp != (auto?.dvpPct ?? 0) || dvpGames != auto?.dvpGames { change.dvpPct = dvp; change.dvpGames = dvpGames }
        await model.setTeamOverride(change, team: team.team)
    }
}

struct KPlayerOverrideView: View {
    @ObservedObject var model: KStreamScreenModel
    let row: KProjection
    @Environment(\.dismiss) private var dismiss
    @State private var practice: StreamPractice
    @State private var notes: String

    init(model: KStreamScreenModel, row: KProjection) {
        self.model = model
        self.row = row
        _practice = State(initialValue: row.practice)
        _notes = State(initialValue: row.notes)
    }

    var body: some View {
        Form {
            Section {
                Picker("Status", selection: $practice) {
                    ForEach(StreamPractice.allCases, id: \.self) { Text($0.label).tag($0) }
                }
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
                        let change = KPlayerOverride(practice: practice != row.practice ? practice : nil,
                                                     notes: notes.isEmpty ? nil : notes)
                        await model.setPlayerOverride(change.isEmpty ? nil : change, playerID: row.id)
                        dismiss()
                    }
                }
            }
        }
    }
}
