import SwiftUI
import FCCore

/// Two to four defenders side by side: a verdict first, then the range of
/// outcomes, where the points come from, the game each plays, recent form and
/// every head-to-head. The best value on each row is tinted.
///
/// Wide windows get a table whose player headers stay pinned while scrolling
/// and whose columns share the width, so nothing scrolls sideways. A phone gets
/// one card per player instead.
struct IDPCompareView: View {
    @ObservedObject var model: IDPStreamScreenModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openPlayerCard) private var openPlayerCard
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var adding = false

    private let labelWidth: CGFloat = 116

    private var isCompact: Bool {
        #if os(iOS)
        return sizeClass == .compact
        #else
        return false
        #endif
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                if let comparison = model.comparison {
                    VStack(alignment: .leading, spacing: 18) {
                        if let verdict = comparison.verdict {
                            verdictCard(verdict, comparison)
                        } else {
                            Text("Add another defender to get a verdict and head-to-head odds.")
                                .font(.footnote).foregroundStyle(.secondary)
                                .card()
                        }
                        rangeBars(comparison)
                        if isCompact {
                            stackedCards(comparison)
                        } else {
                            table(comparison, width: geometry.size.width - 32)
                        }
                        if comparison.players.count > 1 { headToHead(comparison) }
                        flags(comparison)
                        Text("Same model and scoring as the stream list, at the \(model.risk.label.lowercased()) risk setting. Odds include each player's chance of not playing.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    .padding()
                } else {
                    ContentUnavailableView(
                        "Nobody to compare",
                        systemImage: "person.2.slash",
                        description: Text("Add defenders from the list, or search for anyone.")
                    )
                    .padding(.top, 60)
                }
            }
        }
        .navigationTitle("Compare defenders")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Clear", role: .destructive) { model.clearCompare() }
                    .disabled(model.compareIDs.isEmpty)
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    adding = true
                } label: {
                    Label("Add player", systemImage: "plus")
                }
                .disabled(!model.canAddToCompare)
            }
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
        .sheet(isPresented: $adding) {
            NavigationStack { IDPPlayerPickerView(model: model, mode: .compare) }
                #if os(macOS)
                .frame(minWidth: 460, minHeight: 520)
                #endif
        }
    }

    // MARK: - Verdict

    private func verdictCard(_ verdict: IDPComparisonVerdict, _ comparison: IDPComparison) -> some View {
        let leader = comparison.players[verdict.leader]
        let runnerUp = shortName(comparison.players[verdict.runnerUp].name)
        let headline: String
        let tint: Color
        switch verdict.confidence {
        case .clear: headline = "Start \(leader.name)"; tint = Palette.start
        case .lean: headline = "Lean \(leader.name)"; tint = Color.accentColor
        case .tossUp: headline = "Toss-up — \(leader.name) by a nose"; tint = Palette.caution
        }
        let odds = verdict.odds
            .map { "beats \(shortName(comparison.players[$0.index].name)) \(pct($0.pBeats))" }
            .joined(separator: ", ")
        let margin = verdict.margin >= 0
            ? "+\(num(verdict.margin)) pts over \(runnerUp)"
            : "\(num(-verdict.margin)) pts below \(runnerUp)'s projection, but the steadier bet"
        return HStack(alignment: .top, spacing: 12) {
            PlayerAvatar(sleeperID: leader.playerID, name: leader.name, position: leader.platform, size: 40)
            VStack(alignment: .leading, spacing: 4) {
                Text(headline).font(.headline).foregroundStyle(tint)
                Text("\(odds.prefix(1).uppercased())\(odds.dropFirst()). \(margin).")
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                if let flag = leader.flags.first {
                    Label(flag, systemImage: "flag").font(.caption).foregroundStyle(Palette.caution)
                }
            }
        }
        .card(fill: tint.opacity(0.08))
    }

    // MARK: - Range bars

    /// Floor to ceiling on one shared scale, the dot at expected points — the
    /// spread of outcomes the head-to-head odds come from.
    private func rangeBars(_ comparison: IDPComparison) -> some View {
        let top = max(comparison.players.map(\.ceilingP75).max() ?? 1, 1) * 1.08
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Range this week").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                Text("floor · expected · ceiling").font(.caption2).foregroundStyle(.tertiary)
            }
            ForEach(comparison.players) { p in
                HStack(spacing: 10) {
                    Text(shortName(p.name))
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                        .frame(width: 90, alignment: .leading)
                    GeometryReader { bar in
                        let w = bar.size.width
                        let x = { (v: Double) in CGFloat(v / top) * w }
                        ZStack(alignment: .leading) {
                            Capsule().fill(Palette.surface).frame(height: 6)
                            Capsule()
                                .fill(Palette.position(p.platform).opacity(0.45))
                                .frame(width: max(x(p.ceilingP75) - x(p.floorP25), 4), height: 10)
                                .offset(x: x(p.floorP25))
                            Circle()
                                .fill(Palette.position(p.platform))
                                .frame(width: 12, height: 12)
                                .offset(x: x(p.expPts) - 6)
                        }
                        .frame(height: 14)
                    }
                    .frame(height: 14)
                    Text("\(num(p.floorP25)) · \(num(p.expPts)) · \(num(p.ceilingP75))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 118, alignment: .trailing)
                }
            }
        }
        .card()
    }

    // MARK: - Wide table

    private func table(_ comparison: IDPComparison, width: CGFloat) -> some View {
        let players = comparison.players
        let column = max((width - labelWidth - 28) / CGFloat(max(players.count, 1)), 110)
        return LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    group("Projection")
                    metric("E[pts]", players, column) { $0.expPts }
                    metric("Utility", players, column) { $0.utility }
                    metric("P(plays)", players, column, format: pct) { $0.pPlay }
                    metric("Snaps", players, column, format: whole) { $0.expSnaps }
                    metric("Snap share", players, column, format: pct) { $0.snapShare }

                    group("Expected stat line")
                    metric("Solo", players, column) { $0.eSolo }
                    metric("Assist", players, column) { $0.eAst }
                    metric("Sack", players, column, format: two) { $0.eSack }
                    metric("TFL", players, column, format: two) { $0.eTfl }
                    metric("QB hit", players, column, format: two) { $0.eQbHit }
                    metric("Pass def", players, column, format: two) { $0.ePd }

                    group("Points by stat, if he plays")
                    ForEach(statNames(players), id: \.self) { stat in
                        metric(stat, players, column) { p in
                            p.pointsBreakdown(scoring: model.scoring).first { $0.stat == stat }?.points ?? 0
                        }
                    }

                    group("Recent games")
                    recentRows(players, column)

                    group("Game")
                    text("Opponent", players, column) { $0.opponent }
                    text("Spread", players, column) { p in model.teams[p.team].map { signed($0.spreadDef) } ?? "–" }
                    text("Total", players, column) { p in model.teams[p.team].map { num($0.total) } ?? "–" }
                    metric("Tackle matchup ×", players, column, format: three) { $0.tklMult }
                    metric("Pass-pro ×", players, column, format: two) { $0.sackMult }
                    metric("Role confidence", players, column, format: two) { $0.roleConf }
                    text("Status", players, column) { $0.practice.label }
                    text("Season IDP pts/g", players, column) { p in
                        p.playerID.flatMap { model.context?.sleeperPointsPerGame($0) }.map { num($0) } ?? "–"
                    }
                }
                .padding(.top, 6)
            } header: {
                HStack(alignment: .top, spacing: 0) {
                    Color.clear.frame(width: labelWidth, height: 1)
                    ForEach(players) { header($0).frame(width: column, alignment: .leading) }
                }
                .padding(.vertical, 8)
                .background(.bar)
            }
        }
        .card(padding: 12)
    }

    private func header(_ p: IDPProjection) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                PlayerAvatar(sleeperID: p.playerID, name: p.name, position: p.platform, size: 30)
                Spacer()
                removeButton(p)
            }
            Text(p.name).font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
            HStack(spacing: 4) {
                PositionChip(position: p.platform, label: p.position.label)
                Text("\(p.team) \(p.opponent)").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            ownership(p)
            actions(p)
        }
        .padding(.trailing, 8)
    }

    private func group(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 10)
    }

    private func metric(_ label: String, _ players: [IDPProjection], _ column: CGFloat,
                        format: @escaping (Double) -> String = { $0.formatted(.number.precision(.fractionLength(1))) },
                        value: (IDPProjection) -> Double) -> some View {
        let values = players.map(value)
        let top = values.max()
        let distinct = Set(values.map(format)).count > 1
        return HStack(spacing: 0) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: labelWidth, alignment: .leading)
            ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                let best = distinct && v == top
                Text(format(v))
                    .font(.subheadline.monospacedDigit().weight(best ? .semibold : .regular))
                    .foregroundStyle(best ? Palette.start : Color.primary)
                    .frame(width: column, alignment: .leading)
            }
        }
    }

    private func text(_ label: String, _ players: [IDPProjection], _ column: CGFloat,
                      value: @escaping (IDPProjection) -> String) -> some View {
        HStack(spacing: 0) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: labelWidth, alignment: .leading)
            ForEach(players) { p in
                Text(value(p)).font(.subheadline).lineLimit(1).frame(width: column, alignment: .leading)
            }
        }
    }

    private func recentRows(_ players: [IDPProjection], _ column: CGFloat) -> some View {
        let games = players.map { p in p.playerID.map { model.recentGames($0) } ?? [] }
        let rows = games.map(\.count).max() ?? 0
        return VStack(alignment: .leading, spacing: 4) {
            if rows == 0 {
                Text("No completed games this season yet.").font(.caption).foregroundStyle(.tertiary)
            }
            ForEach(0..<rows, id: \.self) { i in
                HStack(spacing: 0) {
                    Text(i == 0 ? "Latest first" : "").font(.caption).foregroundStyle(.secondary)
                        .frame(width: labelWidth, alignment: .leading)
                    ForEach(games.indices, id: \.self) { j in
                        Group {
                            if i < games[j].count { gameCell(games[j][i]) } else { Text("—").foregroundStyle(.tertiary) }
                        }
                        .frame(width: column, alignment: .leading)
                    }
                }
            }
        }
    }

    private func gameCell(_ g: IDPGameLine) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(num(g.points)) pts")
                .font(.subheadline.monospacedDigit().weight(.medium))
            Text(gameDetail(g))
                .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    private func gameDetail(_ g: IDPGameLine) -> String {
        var parts = ["Wk \(g.week)" + (g.opponent.map { " v \($0)" } ?? "")]
        if let share = g.snapShare { parts.append(pct(share)) }
        parts.append("\(whole(g.tackles)) tkl")
        if g.sacks > 0 { parts.append("\(num(g.sacks)) sk") }
        return parts.joined(separator: " · ")
    }

    private func statNames(_ players: [IDPProjection]) -> [String] {
        var seen: [String] = []
        for p in players {
            for part in p.pointsBreakdown(scoring: model.scoring) where !seen.contains(part.stat) { seen.append(part.stat) }
        }
        return seen
    }

    // MARK: - Phone cards

    private func stackedCards(_ comparison: IDPComparison) -> some View {
        let players = comparison.players
        func tint(_ value: (IDPProjection) -> Double, _ p: IDPProjection) -> Color {
            let values = players.map(value)
            return Set(values).count > 1 && value(p) == values.max() ? Palette.start : .primary
        }
        return VStack(spacing: 12) {
            ForEach(players) { p in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 10) {
                        PlayerAvatar(sleeperID: p.playerID, name: p.name, position: p.platform, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(p.name).font(.headline).lineLimit(1)
                                PositionChip(position: p.platform, label: p.position.label)
                            }
                            Text("\(p.team) \(p.opponent) · \(p.practice.label)").font(.caption).foregroundStyle(.secondary)
                            ownership(p)
                        }
                        Spacer()
                        removeButton(p)
                    }
                    HStack(spacing: 16) {
                        StatPill(label: "E[pts]", value: num(p.expPts), tint: tint(\.expPts, p))
                        StatPill(label: "floor", value: num(p.floorP25), tint: tint(\.floorP25, p))
                        StatPill(label: "ceiling", value: num(p.ceilingP75), tint: tint(\.ceilingP75, p))
                        StatPill(label: "snaps", value: whole(p.expSnaps))
                        StatPill(label: "P(plays)", value: pct(p.pPlay))
                    }
                    Text(p.pointsBreakdown(scoring: model.scoring).prefix(4)
                        .map { "\($0.stat) \(num($0.points))" }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                    if let id = p.playerID {
                        let games = model.recentGames(id)
                        if !games.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(games, id: \.week) { g in
                                    Text("\(num(g.points)) pts — \(gameDetail(g))").font(.caption2)
                                }
                            }
                        }
                    }
                    actions(p)
                }
                .card()
            }
        }
    }

    // MARK: - Shared bits

    @ViewBuilder
    private func ownership(_ p: IDPProjection) -> some View {
        if let id = p.playerID, let availability = model.context?.availability(ofSleeperID: id) {
            Text(availability.label)
                .font(.caption2)
                .foregroundStyle(availability == .freeAgent ? Color.secondary : Palette.caution)
        }
    }

    private func removeButton(_ p: IDPProjection) -> some View {
        Button {
            if let id = p.playerID { model.toggleCompare(id) }
        } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
        }
        .buttonStyle(.plain)
        .help("Remove from comparison")
    }

    private func actions(_ p: IDPProjection) -> some View {
        HStack(spacing: 6) {
            if model.report?.incumbent?.id == p.id {
                Text("Starter to beat").font(.caption2.weight(.semibold)).foregroundStyle(Color.accentColor)
            } else {
                Button("Set to beat") { Task { await model.setIncumbent(p.playerID) } }
                    .font(.caption2)
                    .help("Set as the starter to beat")
            }
            if let id = p.playerID, let context = model.context {
                Button("Card") { openPlayerCard(id, context: context) }
                    .font(.caption2)
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
    }

    // MARK: - Head to head

    private func headToHead(_ comparison: IDPComparison) -> some View {
        let players = comparison.players
        let nameWidth: CGFloat = isCompact ? 70 : labelWidth
        return VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Head to head",
                          subtitle: "Chance the row player outscores the column player this week.",
                          systemImage: "arrow.left.arrow.right")
            Grid(horizontalSpacing: 8, verticalSpacing: 6) {
                GridRow {
                    Color.clear.frame(width: nameWidth, height: 1)
                    ForEach(players) {
                        Text(shortName($0.name)).font(.caption.weight(.semibold)).lineLimit(1).frame(maxWidth: .infinity)
                    }
                }
                ForEach(Array(players.enumerated()), id: \.element.id) { i, row in
                    GridRow {
                        Text(shortName(row.name)).font(.caption).lineLimit(1)
                            .frame(width: nameWidth, alignment: .leading)
                        ForEach(players.indices, id: \.self) { j in
                            if let p = comparison.headToHead[i][j] {
                                Text(pct(p))
                                    .font(.subheadline.monospacedDigit().weight(p >= 0.5 ? .semibold : .regular))
                                    .foregroundStyle(p >= 0.6 ? Palette.start : p <= 0.4 ? Palette.sit : Color.primary)
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("—").foregroundStyle(.tertiary).frame(maxWidth: .infinity)
                            }
                        }
                    }
                }
            }
        }
        .card()
    }

    @ViewBuilder
    private func flags(_ comparison: IDPComparison) -> some View {
        let flagged = comparison.players.filter { !$0.flags.isEmpty }
        if !flagged.isEmpty {
            DisclosureGroup("Data flags") {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(flagged) { p in
                        Text("\(p.name): \(p.flags.joined(separator: " · "))")
                            .font(.caption).foregroundStyle(Palette.caution)
                    }
                }
                .padding(.top, 4)
            }
            .font(.footnote)
        }
    }

    // MARK: - Formatting

    private func shortName(_ name: String) -> String {
        let parts = name.split(separator: " ").filter { !["Jr.", "Sr.", "II", "III", "IV"].contains($0) }
        return parts.last.map(String.init) ?? name
    }
    private func pct(_ x: Double) -> String { "\(Int((x * 100).rounded()))%" }
    private func whole(_ x: Double) -> String { "\(Int(x.rounded()))" }
    private func two(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(2))) }
    private func three(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(3))) }
    private func num(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(1))) }
    private func signed(_ x: Double) -> String { (x > 0 ? "+" : "") + num(x) }
}
