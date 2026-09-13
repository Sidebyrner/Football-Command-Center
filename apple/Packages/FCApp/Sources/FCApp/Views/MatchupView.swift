import SwiftUI
import FCCore
import FCData

/// Matchup — "this week, both sides" (§7.2).
///
/// Phone-first: a head-to-head summary on top, then one side at a time behind a
/// segmented control rather than two cramped columns.
public struct MatchupView: View {
    @ObservedObject var model: MatchupModel

    public init(model: MatchupModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Loading matchup…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load the matchup", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    FreshnessBanner(provenance: context.provenance)
                    if let note = context.statsSeasonNote {
                        CoverageNote(text: note)
                    }
                    header
                    if let reason = model.noOpponentReason {
                        CoverageNote(text: reason)
                    }
                    if model.opponentSide != nil {
                        Picker("Side", selection: $model.showing) {
                            ForEach(MatchupModel.Showing.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    if let side = model.visibleSide {
                        sideSummary(side)
                        ForEach(side.rows) { row in
                            MatchupRowView(row: row)
                                // Contain, so the id lands on the row and not on
                                // every text inside it.
                                .accessibilityElement(children: .contain)
                                .accessibilityIdentifier("matchup.row.\(row.index)")
                        }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        CoverageNote(text: MatchupModel.linesNote)
                        CoverageNote(text: MatchupModel.defenseNote)
                    }
                }
            }
            .padding()
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .navigationTitle("Matchup")
    }

    // MARK: - Head to head

    @ViewBuilder
    private var header: some View {
        if let mine = model.mySide {
            HStack(alignment: .top) {
                teamColumn(mine, alignment: .leading)
                Spacer()
                Text("vs").font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                Spacer()
                if let opponent = model.opponentSide {
                    teamColumn(opponent, alignment: .trailing)
                } else {
                    Text("No opponent").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.08)))
        }
    }

    private func teamColumn(_ side: MatchupSide, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(side.manager)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text(side.livePoints.map { String(format: "%.1f", $0) } ?? "—")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .monospacedDigit()
            if let total = side.environment.total {
                Text(String(format: "%.1f implied", total))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - One side

    @ViewBuilder
    private func sideSummary(_ side: MatchupSide) -> some View {
        let problems = [
            side.emptySlots > 0 ? "\(side.emptySlots) empty slot\(side.emptySlots == 1 ? "" : "s")" : nil,
            side.startersOnBye > 0 ? "\(side.startersOnBye) starter\(side.startersOnBye == 1 ? "" : "s") on bye" : nil,
            side.environment.missingTeams.isEmpty
                ? nil
                : "no line for \(side.environment.missingTeams.joined(separator: ", "))",
        ].compactMap { $0 }

        if !problems.isEmpty {
            Text(problems.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Palette.caution)
        }
    }
}

struct MatchupRowView: View {
    let row: MatchupRow

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(row.slot)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .leading)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if row.isEmptySlot {
                Text("Empty — set this slot on Sleeper")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(row.name ?? "Unknown").font(.subheadline.weight(.semibold)).lineLimit(1)
                        if let position = row.position {
                            PositionChip(position: position)
                        }
                    }
                    Text(gameLine)
                        .font(.caption)
                        .foregroundStyle(row.onBye ? Palette.sit : .secondary)

                    if let season = row.season {
                        Text(seasonText(season))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    } else if !row.hasProductionData {
                        Text("No production data for \(row.position?.rawValue ?? "this position")")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    } else {
                        Text("No season line")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }

                    if let summary = row.defenseSummary {
                        Text(summary)
                            .font(.caption2)
                            .foregroundStyle(defenseColour)
                    }
                }
                Spacer()
                Text(row.livePoints.map { String(format: "%.1f", $0) } ?? "—")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.06)))
    }

    private var gameLine: String {
        guard !row.onBye else { return "\(row.nflTeam ?? "") on bye — scores 0" }
        guard let opponent = row.opponent else { return row.nflTeam ?? "" }
        let venue = row.isHome == true ? "vs" : "@"
        let implied = row.impliedTotal.map { String(format: " · %.1f implied", $0) } ?? ""
        return "\(row.nflTeam ?? "") \(venue) \(opponent)\(implied)"
    }

    private func seasonText(_ season: SeasonLine) -> String {
        var parts = [String(format: "%.1f/gm", season.pointsPerGame)]
        if let form = season.formPointsPerGame { parts.append(String(format: "last 4 %.1f", form)) }
        if let floor = season.floor, let ceiling = season.ceiling {
            parts.append(String(format: "%.1f–%.1f", floor, ceiling))
        }
        parts.append("\(season.games) gm")
        return parts.joined(separator: " · ")
    }

    private var defenseColour: Color {
        guard let delta = row.defense?.vsLeagueAverage else { return .secondary }
        return delta >= 0 ? Palette.start : Palette.sit
    }
}
