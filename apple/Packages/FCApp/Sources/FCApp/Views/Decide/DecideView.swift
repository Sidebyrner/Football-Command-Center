import SwiftUI
import FCCore

/// Decide — every slot in your lineup as a start call, the close ones first.
/// Opens one slot's head-to-head, with free agents a tap away.
struct DecideView: View {
    let services: AppServices
    @ObservedObject var sitStart: SitStartModel
    @ObservedObject var matchup: MatchupModel
    @ObservedObject var waivers: WaiverBoardModel
    @State private var session: DecideSession?

    init(services: AppServices) {
        self.services = services
        self.sitStart = services.sitStart
        self.matchup = services.matchup
        self.waivers = services.waivers
    }

    var body: some View {
        Group {
            if let context = sitStart.context {
                let slots = services.decide.orderedSlots()
                let close = slots.filter(\.isCloseCall)
                ScreenScaffold {
                    ScreenHero(
                        overline: "Lineup · Decide",
                        systemImage: "scalemass",
                        answer: close.isEmpty ? "No close calls" : "\(close.count) close call\(close.count == 1 ? "" : "s")",
                        detail: close.isEmpty
                            ? "Every slot you can still change has a clear starter this week."
                            : "Slots where the signals don't agree. Tap one to compare, free agents included.",
                        tone: close.isEmpty ? .start : nil
                    ) { EmptyView() }
                } content: {
                    ScreenSection(title: "Slots", systemImage: "list.bullet.rectangle", count: slots.filter(\.canDecide).count) {
                        VStack(spacing: 6) {
                            ForEach(slots) { slot in slotRow(slot, context: context) }
                            ForEach(DecideModel.sharedPicks(slots).sorted { $0.key < $1.key }, id: \.key) { id, tokens in
                                Label {
                                    Text("\(context.playerName(id) ?? id) is the pick at \(tokens.joined(separator: " and ")), but he can only fill one. Sit/Start sets the whole lineup at once.")
                                        .fixedSize(horizontal: false, vertical: true)
                                } icon: {
                                    Image(systemName: "arrow.triangle.branch").foregroundStyle(Palette.caution)
                                }
                                .font(.caption)
                                .padding(.top, 4)
                            }
                        }
                    }
                } about: {
                    FreshnessBanner(provenance: context.provenance)
                    CoverageNote(text: "Each call counts head-to-head wins over separate signals — projected, Command Center, this season, last 4, usage (xFP) and game environment, plus floor or ceiling depending on your matchup. Nothing is blended into one score.")
                    CoverageNote(text: "Game lines come from the schedule file's recorded lines, not live odds. Questionable players are compared on their full value, as in Sit/Start.")
                }
            } else {
                LoadingPlaceholder(label: "Loading your roster…")
            }
        }
        .navigationTitle("Decide")
        .sheet(item: $session) { DecideSheet(services: services, session: $0) }
    }

    @ViewBuilder
    private func slotRow(_ slot: DecideSlot, context: LeagueContext) -> some View {
        let incumbent = slot.incumbentID.map { context.playerName($0) ?? $0 } ?? "Empty"
        Button {
            session = services.decide.session(for: slot)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(slot.token)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: 50, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(slot.hasBenchOption && slot.canDecide ? slot.verdict.headline : incumbent)
                        .font(.subheadline.weight(slot.isCloseCall ? .semibold : .regular))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(detail(slot))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                if slot.isLocked {
                    Image(systemName: "lock.fill").font(.caption2).foregroundStyle(.secondary)
                        .accessibilityLabel("Locked — game started")
                } else {
                    if slot.hasBenchOption { ConfidenceChip(confidence: slot.verdict.confidence) }
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(slot.isCloseCall ? Palette.caution.opacity(0.10) : Color.clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!slot.canDecide)
        .accessibilityIdentifier("decide.slot.\(slot.index)")
    }

    private func detail(_ slot: DecideSlot) -> String {
        if slot.isLocked { return "Kicked off — can't change" }
        if !slot.hasBenchOption { return "No bench option — tap to check free agents" }
        if let incumbent = slot.verdict.blocked.first(where: { $0.id == slot.incumbentID }) {
            return "\(incumbent.name): \(incumbent.reason)"
        }
        let others = slot.candidateIDs.count - 1
        return [slot.verdict.edgeLine, "\(others) other option\(others == 1 ? "" : "s")"].compactMap { $0 }.joined(separator: " · ")
    }
}
