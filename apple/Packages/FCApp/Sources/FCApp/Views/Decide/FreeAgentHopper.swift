import SwiftUI
import FCCore
import FCData

/// Free agents who could take the slot: the few who beat your weakest
/// option this week, and a search for anyone else. Adding one only puts him
/// in this comparison — the claim itself is made on the Waiver Board.
struct FreeAgentHopper: View {
    let decide: DecideModel
    @ObservedObject var session: DecideSession
    @State private var query = ""

    var body: some View {
        let suggestions = decide.suggestions(for: session.slot, excluding: Set(session.ids))
        VStack(alignment: .leading, spacing: 8) {
            Label("From the waiver wire", systemImage: "tray.and.arrow.down")
                .font(.subheadline.weight(.semibold))
            if suggestions.isEmpty {
                Text("No free agent beats your weakest option at \(session.slot.token) this week.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(suggestions) { suggestion in
                row(id: suggestion.id, name: suggestion.row.name,
                    detail: [suggestion.row.position.rawValue, suggestion.row.team].compactMap { $0 }.joined(separator: " · "),
                    reason: suggestion.reason)
            }
            TextField("Search free agents", text: $query)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .accessibilityIdentifier("decide.search")
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                let results = decide.searchFreeAgents(query, slot: session.slot, excluding: session.ids)
                if results.isEmpty {
                    Text("No free agent at \(session.slot.token) matches.").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(results, id: \.id) { player in
                    row(id: player.id, name: player.name,
                        detail: [player.positionCode, player.team].compactMap { $0 }.joined(separator: " · "), reason: nil)
                }
            }
        }
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("decide.hopper")
    }

    private func row(id: String, name: String, detail: String, reason: String?) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(detail).font(.caption2).foregroundStyle(.secondary)
                if let reason { Text(reason).font(.caption2).foregroundStyle(Palette.start) }
            }
            Spacer(minLength: 4)
            addControl(id: id, name: name)
        }
    }

    @ViewBuilder
    private func addControl(id: String, name: String) -> some View {
        if session.isFull {
            Menu {
                ForEach(session.ids.filter(session.canRemoveFromCompare), id: \.self) { other in
                    Button("Replace \(decide.context?.playerName(other) ?? other)") {
                        withAnimation(Motion.snappy) { session.add(id, replacing: other) }
                        query = ""
                    }
                }
            } label: {
                Image(systemName: "plus.circle.fill").font(.title3)
            }
            .accessibilityLabel("Add \(name) in place of another player")
            .accessibilityIdentifier("decide.add.\(id)")
        } else {
            Button {
                withAnimation(Motion.snappy) { session.add(id) }
                query = ""
            } label: {
                Image(systemName: "plus.circle.fill").font(.title3)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.accentColor)
            .accessibilityLabel("Add \(name) to the comparison")
            .accessibilityIdentifier("decide.add.\(id)")
        }
    }
}

/// One slot's decision: the comparison on the this-week lens, with the
/// free-agent hopper underneath.
struct DecideSheet: View {
    let services: AppServices
    @ObservedObject var session: DecideSession

    var body: some View {
        NavigationStack {
            PhoneCompareView(services: services, discovery: services.discovery, source: session, lens: .thisWeek) {
                AnyView(FreeAgentHopper(decide: services.decide, session: session))
            }
        }
        .presentationDetents([.large])
    }
}
