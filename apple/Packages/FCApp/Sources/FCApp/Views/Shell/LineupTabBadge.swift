import SwiftUI

/// The Lineup tab's badge: starters the recommended lineup would change, plus
/// starters injury rules out — everything in the tab waiting on you. Observes
/// only the two models it counts, so the shell still observes nothing else.
struct LineupTabBadge<Content: View>: View {
    @ObservedObject var sitStart: SitStartModel
    @ObservedObject var injuries: InjuryCenterModel
    @ViewBuilder let content: Content

    static func count(changes: Int, blocked: Int) -> Int { changes + blocked }

    private var blocked: Int {
        guard let context = injuries.context else { return 0 }
        return injuries.roster.filter { $0.isStarter && StartAvailability.of($0.id, context: context).blocksStart }.count
    }

    var body: some View {
        content.badge(Self.count(changes: sitStart.starts.count, blocked: blocked))
    }
}
