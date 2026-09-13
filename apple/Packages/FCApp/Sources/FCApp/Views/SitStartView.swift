import SwiftUI
import FCCore
import FCData

/// Sit/Start — "who do I actually play" (§7.3).
///
/// One basis at a time, always named. The proposed swaps and their gain come
/// first because they are the answer; the full lineup and the players the basis
/// could not value follow, stated rather than hidden.
public struct SitStartView: View {
    @ObservedObject var model: SitStartModel

    public init(model: SitStartModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if model.isLoading {
                    ProgressView("Loading your roster…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else if let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your roster", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    FreshnessBanner(provenance: context.provenance)
                    if let note = context.statsSeasonNote {
                        CoverageNote(text: note)
                    }
                    basisPicker
                    recommendation
                    if !model.disagreeingBases.isEmpty {
                        disagreement
                    }
                    lineupSection
                    unrankedSection(context: context)
                    CoverageNote(text: SitStartModel.modelBasisNote)
                }
            }
            .padding()
        }
        .navigationTitle("Sit/Start")
    }

    // MARK: - Basis

    private var basisPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Optimize by").font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(LineupBasis.allCases) { basis in
                        Button {
                            model.basis = basis
                        } label: {
                            Text(basis.label)
                                .font(.caption.weight(model.basis == basis ? .semibold : .regular))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(
                                    Capsule().fill(model.basis == basis
                                                   ? Color.accentColor.opacity(0.18)
                                                   : Color.secondary.opacity(0.10))
                                )
                                .foregroundStyle(model.basis == basis ? Color.accentColor : .primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Text(model.basis.hint).font(.caption2).foregroundStyle(.tertiary)
        }
    }

    // MARK: - The answer

    @ViewBuilder
    private var recommendation: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.swaps.isEmpty {
                Label {
                    Text("Your lineup is already the best one by **\(model.basis.label)**.")
                } icon: {
                    Image(systemName: "checkmark.circle").foregroundStyle(.green)
                }
                .font(.subheadline)
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text("By **\(model.basis.label)**, \(model.swaps.count) change\(model.swaps.count == 1 ? "" : "s")")
                        .font(.subheadline)
                    Spacer()
                    if let gain = model.gain {
                        Text(String(format: "%+.1f", gain))
                            .font(.title3.weight(.bold).monospacedDigit())
                            .foregroundStyle(gain >= 0 ? .green : .red)
                    }
                }
                ForEach(model.swaps) { swap in
                    HStack(spacing: 8) {
                        Text(swap.slot)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 48, alignment: .leading)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Text(swap.outName ?? "empty")
                            .font(.caption)
                            .strikethrough()
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Image(systemName: "arrow.right").imageScale(.small).foregroundStyle(.tertiary)
                        Text(swap.inName).font(.caption.weight(.semibold)).lineLimit(1)
                        Spacer()
                        Text(String(format: "%+.1f", swap.delta))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(swap.delta >= 0 ? .green : .red)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.08)))
    }

    private var disagreement: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange).imageScale(.small)
            Text("\(model.disagreeingBases.map(\.label).joined(separator: ", ")) pick\(model.disagreeingBases.count == 1 ? "s" : "") a different lineup. The measures disagree about these players, so this is a judgement call, not a calculation.")
                .font(.caption)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Lineup

    private var lineupSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Proposed lineup").font(.headline)
            ForEach(model.lineup) { slot in
                HStack(spacing: 8) {
                    Text(slot.slot)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 48, alignment: .leading)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(slot.name ?? "Empty")
                        .font(.caption)
                        .fontWeight(slot.changed ? .semibold : .regular)
                        .foregroundStyle(slot.playerID == nil ? .orange : .primary)
                        .lineLimit(1)
                    if slot.keptBecauseUnvalued {
                        Text("kept — can't be valued")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                    Text(slot.value.map { String(format: "%.1f", $0) } ?? "—")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 3)
                .padding(.horizontal, 6)
                .background(slot.changed ? Color.accentColor.opacity(0.10) : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 5))
            }
        }
    }

    // MARK: - Unranked

    @ViewBuilder
    private func unrankedSection(context: LeagueContext) -> some View {
        let unranked = model.unranked
        if unranked.total > 0 {
            VStack(alignment: .leading, spacing: 6) {
                Text("Left out — never scored as zero").font(.headline)
                group("On bye this week", unranked.onBye)
                group("No production data (DEF and IDP aren't in the stats)", unranked.noProductionData)
                group("No \(model.basis.label.lowercased()) value in \(context.statsSeason) (rookies, missed games, or not matched)", unranked.noSeasonLine)
                group("No recorded line for their game", unranked.noGameLine)
            }
        }
    }

    @ViewBuilder
    private func group(_ title: String, _ names: [String]) -> some View {
        if !names.isEmpty {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Text(names.joined(separator: ", "))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
