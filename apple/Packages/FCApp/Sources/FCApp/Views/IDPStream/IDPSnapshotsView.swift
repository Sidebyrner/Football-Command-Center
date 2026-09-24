import SwiftUI
import FCCore

/// Frozen runs, newest first. One a day is saved automatically; frozen ones
/// are the Tuesday-night and Sunday-morning runs saved by hand.
struct IDPSnapshotsView: View {
    @ObservedObject var model: IDPStreamScreenModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if model.snapshots.isEmpty {
                Text("No snapshots yet. One is saved the first time the screen loads each day.")
                    .foregroundStyle(.secondary)
            }
            ForEach(groupedWeeks, id: \.0) { key, rows in
                Section(key) {
                    ForEach(rows) { summary in
                        NavigationLink {
                            IDPSnapshotDetailView(model: model, summary: summary)
                        } label: {
                            HStack {
                                Label(summary.asOf.formatted(date: .abbreviated, time: .shortened),
                                      systemImage: summary.pinned ? "snowflake" : "clock")
                                Spacer()
                                if summary.pinned {
                                    Text("frozen").font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .contextMenu {
                            Button("Delete", role: .destructive) {
                                Task { await model.deleteSnapshot(id: summary.id) }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Snapshots")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
    }

    private var groupedWeeks: [(String, [IDPSnapshotSummary])] {
        let groups = Dictionary(grouping: model.snapshots) { "\($0.season) · Week \($0.week)" }
        return groups
            .map { ($0.key, $0.value.sorted { $0.asOf > $1.asOf }) }
            .sorted { ($0.1.first?.asOf ?? .distantPast) > ($1.1.first?.asOf ?? .distantPast) }
    }
}

/// A frozen run, read-only, exactly as it was on screen.
struct IDPSnapshotDetailView: View {
    @ObservedObject var model: IDPStreamScreenModel
    let summary: IDPSnapshotSummary
    @State private var snapshot: IDPStreamSnapshot?
    @State private var missing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let snapshot {
                    Text("As of \(snapshot.asOf.formatted(date: .complete, time: .shortened)) · \(snapshot.risk.label)")
                        .font(.caption).foregroundStyle(.secondary)
                    if let inc = snapshot.report.incumbent {
                        Text("Starter to beat: \(inc.name) (\(inc.team) \(inc.opponent)) — \(f1(inc.expPts)) pts")
                            .font(.subheadline.weight(.semibold))
                            .card()
                    }
                    ForEach(Array(snapshot.report.ranked.filter { $0.available != false }.prefix(30).enumerated()), id: \.element.id) { offset, row in
                        HStack {
                            Text("\(offset + 1)").font(.caption.monospacedDigit()).foregroundStyle(.secondary).frame(width: 22, alignment: .trailing)
                            PositionChip(position: row.platform, label: row.position.label)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(row.name).font(.subheadline.weight(.medium))
                                Text("\(row.team) \(row.opponent)").font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let p = row.pBeatIncumbent {
                                Text("\(Int((p * 100).rounded()))%").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                            Text(f1(row.expPts)).font(.subheadline.monospacedDigit().weight(.semibold))
                        }
                        .padding(.vertical, 2)
                    }
                    Text("Free agents at the time. Actuals and backtest scoring against these snapshots come in a later build.")
                        .font(.caption2).foregroundStyle(.secondary)
                } else if missing {
                    Text("This snapshot could not be read.").foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle("Week \(summary.week)")
        .task {
            snapshot = await model.loadSnapshot(id: summary.id)
            missing = snapshot == nil
        }
    }

    private func f1(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(1))) }
}
