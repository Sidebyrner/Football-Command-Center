import SwiftUI
import FCCore

/// Where Sleeper hosts player and team imagery — the same images the Sleeper app
/// shows.
enum SleeperImages {
    static func headshot(sleeperID: String) -> URL? {
        URL(string: "https://sleepercdn.com/content/nfl/players/thumb/\(sleeperID).jpg")
    }

    /// Sleeper spells teams its own way and lowercases them here (`lar`, `kc`).
    static func teamLogo(_ code: String) -> URL? {
        let sleeper = code == "LA" ? "lar" : code.lowercased()
        return URL(string: "https://sleepercdn.com/images/team_logos/nfl/\(sleeper).png")
    }
}

/// A player's headshot, falling back to initials on the position colour — so an
/// offline launch, or a player Sleeper has no photo for, still looks deliberate.
/// A team defense shows its team logo.
struct PlayerAvatar: View {
    let sleeperID: String?
    let name: String?
    let position: Position?
    var size: CGFloat = 32

    var body: some View {
        ZStack {
            Circle().fill(Palette.position(position).opacity(0.22))
            if let url {
                // Headshots have transparent backgrounds, so the initials must be
                // the placeholder, not a layer underneath — otherwise they show
                // through around the player.
                AsyncImage(url: url, transaction: Transaction(animation: Motion.smooth)) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .scaledToFill()
                            .transition(.opacity)
                    } else {
                        initialsText
                    }
                }
                .clipShape(Circle())
            } else {
                initialsText
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
        .accessibilityHidden(true)
    }

    private var initialsText: some View {
        Text(initials)
            .font(.system(size: size * 0.36, weight: .semibold, design: .rounded))
            .foregroundStyle(Palette.position(position))
    }

    private var url: URL? {
        guard let sleeperID, sleeperID != "0" else { return nil }
        if position == .def { return SleeperImages.teamLogo(sleeperID) }
        return SleeperImages.headshot(sleeperID: sleeperID)
    }

    private var initials: String {
        guard let name, !name.isEmpty else { return position?.rawValue ?? "?" }
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

/// An NFL team logo.
struct TeamLogo: View {
    let code: String?
    var size: CGFloat = 20

    var body: some View {
        ZStack {
            if let code, let url = SleeperImages.teamLogo(code) {
                CachedImage(url: url) { $0.resizable().scaledToFit() }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Loads a remote image and shows nothing until it arrives — the caller draws
/// the fallback underneath. Phase J swaps in a disk-backed cache.
struct CachedImage<Content: View>: View {
    let url: URL
    let content: (Image) -> Content

    init(url: URL, @ViewBuilder content: @escaping (Image) -> Content) {
        self.url = url
        self.content = content
    }

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: Motion.smooth)) { phase in
            if case .success(let image) = phase {
                content(image).transition(.opacity)
            }
        }
    }
}
