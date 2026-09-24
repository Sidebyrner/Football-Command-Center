import SwiftUI
import FCCore

/// Search every defender in the pool — yours, rivals', free agents — to set
/// the starter to beat or add to a comparison.
struct IDPPlayerPickerView: View {
    enum Mode { case incumbent, compare }

    @ObservedObject var model: IDPStreamScreenModel
    let mode: Mode
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section {
                    rows(model.searchDefenders(""))
                } header: {
                    Text("Top projected defenders")
                } footer: {
                    Text("Search to find anyone else, including rivals' players and backups below the stream list's snap floor.")
                }
            } else {
                let results = model.searchDefenders(query)
                if results.isEmpty {
                    Text("No defender matches “\(query)”.").foregroundStyle(.secondary)
                } else {
                    rows(results)
                }
            }
        }
        .searchable(text: $query, prompt: "Defender name")
        .navigationTitle(mode == .incumbent ? "Starter to beat" : "Add to compare")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        }
    }

    private func rows(_ players: [IDPPickerRow]) -> some View {
        ForEach(players) { player in
            Button {
                Task {
                    switch mode {
                    case .incumbent: await model.setIncumbent(player.id)
                    case .compare: model.toggleCompare(player.id)
                    }
                    dismiss()
                }
            } label: {
                HStack(spacing: 10) {
                    PlayerAvatar(sleeperID: player.id, name: player.name, position: player.platform, size: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(player.name).font(.subheadline.weight(.medium))
                            PositionChip(position: player.platform, label: player.alignment?.label)
                        }
                        Text([player.team, player.availability.label].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2)
                            .foregroundStyle(player.availability == .freeAgent ? Color.secondary : Palette.caution)
                    }
                    Spacer()
                    if let projected = player.projected {
                        Text(projected.formatted(.number.precision(.fractionLength(1))))
                            .font(.subheadline.monospacedDigit())
                    }
                    if mode == .compare, model.isComparing(player.id) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(mode == .compare && !model.canAddToCompare && !model.isComparing(player.id))
        }
    }
}
