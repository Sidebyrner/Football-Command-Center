import SwiftUI
import FCCore
import FCData

/// Planning — "get ahead of the schedule" (§7.4).
///
/// Phone-first: the user's own weeks come first as a list, the full league grid
/// scrolls horizontally underneath with a pinned team column, and the board
/// below reacts to whichever week is selected. The brief asks for both a
/// scrolling grid and a drill-down to be prototyped; this is the scrolling grid,
/// with the user's row lifted out so the common case needs no scrolling at all.
public struct PlanningView: View {
    @ObservedObject var model: PlanningModel

    public init(model: PlanningModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if model.isLoading {
                    ProgressView("Loading league…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else if let error = model.errorMessage {
                    errorBlock(error)
                } else if model.context != nil {
                    header
                    yourWeeks
                    leagueGrid
                    boardSection
                }
            }
            .padding()
        }
        .navigationTitle("Planning")
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let context = model.context {
                FreshnessBanner(provenance: context.provenance)
            }
            if let warning = model.coverageWarning {
                CoverageNote(text: warning)
            }
        }
    }

    private func errorBlock(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Could not load your league", systemImage: "exclamationmark.triangle")
                .font(.headline)
            Text(error)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - The user's own weeks

    @ViewBuilder
    private var yourWeeks: some View {
        let short = model.userShortWeeks()
        VStack(alignment: .leading, spacing: 8) {
            Text("Your weeks")
                .font(.headline)

            if short.isEmpty {
                Text("You can field a legal lineup in every remaining week.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(short) { cell in
                    Button {
                        model.selectedWeek = model.selectedWeek == cell.week ? nil : cell.week
                    } label: {
                        shortWeekRow(cell)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func shortWeekRow(_ cell: CrunchCell) -> some View {
        let partners = model.tradePartners(week: cell.week)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Week \(cell.week)")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(cell.shortfall) slot\(cell.shortfall == 1 ? "" : "s") short")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.orange)
            }
            if !cell.shortPositions.isEmpty {
                Text(cell.shortPositions.map(\.rawValue).joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            // The rivals worth asking are the ones who are *not* short the same
            // week — that is the point of showing their rows at all (§7.4).
            if !partners.isEmpty {
                Text("\(partners.count) rival\(partners.count == 1 ? "" : "s") are fine that week")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(model.selectedWeek == cell.week
                      ? Color.accentColor.opacity(0.15)
                      : Color.secondary.opacity(0.08))
        )
    }

    // MARK: - League grid

    @ViewBuilder
    private var leagueGrid: some View {
        if let context = model.context {
            VStack(alignment: .leading, spacing: 8) {
                Text("League")
                    .font(.headline)

                ScrollView(.horizontal, showsIndicators: true) {
                    Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 2) {
                        GridRow {
                            Text("Team")
                                .font(.caption.weight(.semibold))
                                .frame(width: 110, alignment: .leading)
                            ForEach(context.remainingWeeks, id: \.self) { week in
                                Text("\(week)")
                                    .font(.caption2)
                                    .frame(width: 30)
                                    .foregroundStyle(model.selectedWeek == week ? Color.accentColor : .secondary)
                            }
                        }
                        ForEach(context.teams) { team in
                            GridRow {
                                Text(team.manager)
                                    .font(.caption)
                                    .lineLimit(1)
                                    .fontWeight(team.isUser ? .bold : .regular)
                                    .frame(width: 110, alignment: .leading)
                                ForEach(context.remainingWeeks, id: \.self) { week in
                                    cellView(model.cell(rosterID: team.rosterID, week: week), week: week)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func cellView(_ cell: CrunchCell?, week: Int) -> some View {
        Button {
            model.selectedWeek = model.selectedWeek == week ? nil : week
        } label: {
            Text(cell.map { $0.shortfall > 0 ? "\($0.shortfall)" : "·" } ?? "–")
                .font(.caption2.weight(cell?.isShort == true ? .bold : .regular))
                .frame(width: 30, height: 22)
                .background(cellColour(cell))
                .foregroundStyle(cell?.isShort == true ? Color.white : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    private func cellColour(_ cell: CrunchCell?) -> Color {
        guard let cell, cell.isShort else { return Color.secondary.opacity(0.06) }
        return cell.shortfall >= 2 ? .red.opacity(0.85) : .orange.opacity(0.85)
    }

    // MARK: - Acquisition board

    @ViewBuilder
    private var boardSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Acquisition board")
                    .font(.headline)
                Spacer()
                if let week = model.selectedWeek {
                    Button("Week \(week) ✕") { model.selectedWeek = nil }
                        .font(.caption)
                }
            }

            if model.selectedWeek != nil {
                Text("Showing players who are not themselves on bye that week.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if model.board.isEmpty {
                Text("No players tripped a signal.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.board.prefix(40)) { row in
                    BoardRowView(row: row)
                }
            }
        }
    }
}

/// One candidate, with the named signals that put him there. Never a blended
/// score — §6 is explicit that a composite was built here and reverted.
struct BoardRowView: View {
    let row: BoardRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.name)
                    .font(.subheadline.weight(.semibold))
                Text(row.position.rawValue)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Color.secondary.opacity(0.15), in: Capsule())
                if let team = row.team {
                    Text(team)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(String(format: "%+.1f", row.valueOverStartLine))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(row.valueOverStartLine >= 0 ? .green : .secondary)
            }

            Text(row.availability.label)
                .font(.caption2)
                .foregroundStyle(.secondary)

            ForEach(row.signals, id: \.signal) { hit in
                Text("\(hit.label) — \(hit.detail)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.06)))
    }
}
