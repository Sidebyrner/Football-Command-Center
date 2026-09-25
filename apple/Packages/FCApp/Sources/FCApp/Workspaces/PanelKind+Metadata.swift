import Foundation

public extension PanelKind {
    var title: String {
        switch self {
        case .lineupReadiness: return "Lineup readiness"
        case .sitStart: return "Sit/Start"
        case .matchupScore: return "Matchup"
        case .injuries: return "Injuries"
        case .waiverTargets: return "Waiver targets"
        case .tradePartners: return "Trade partners"
        case .byeWeeks: return "Byes & short weeks"
        case .idpStream: return "IDP Stream"
        case .wrStream: return "WR Stream"
        case .rbStream: return "RB Stream"
        case .news: return "News"
        case .standings: return "Standings"
        case .playerCard: return "Player Card"
        }
    }

    /// The full screen this panel summarises — the panel's "Open" button.
    var fullScreen: RootView.Screen? {
        switch self {
        case .lineupReadiness, .news, .standings: return .dashboard
        case .sitStart: return .sitStart
        case .matchupScore: return .matchup
        case .injuries: return .injuries
        case .waiverTargets: return .waivers
        case .tradePartners: return .trades
        case .byeWeeks: return .planning
        case .idpStream: return .idpStream
        case .wrStream: return .wrStream
        case .rbStream: return .rbStream
        case .playerCard: return nil
        }
    }

    var systemImage: String {
        switch self {
        case .lineupReadiness: return "checkmark.seal"
        case .news: return "newspaper"
        case .standings: return "list.number"
        case .byeWeeks: return "calendar.badge.exclamationmark"
        case .playerCard: return "person.text.rectangle"
        default: return fullScreen?.systemImage ?? "square"
        }
    }

    /// What it's for, one line — shown in the panel library.
    var summary: String {
        switch self {
        case .lineupReadiness: return "Is every slot filled with someone who'll play, and when the next lock is."
        case .sitStart: return "The recommended lineup and the moves that get you there."
        case .matchupScore: return "This week's score, projected and live."
        case .injuries: return "Your injured players, their status and who covers them."
        case .waiverTargets: return "The best free agents for your roster this week."
        case .tradePartners: return "Teams whose surplus fits your need, with their grades."
        case .byeWeeks: return "Upcoming byes and the weeks you'll be short at a slot."
        case .idpStream: return "This week's best defenders to stream."
        case .wrStream: return "This week's best receivers to stream."
        case .rbStream: return "This week's best running backs to stream."
        case .news: return "The latest on your players."
        case .standings: return "The league table."
        case .playerCard: return "Everything on one player. Link it to follow clicks in other panels."
        }
    }

    /// The size it gets when added from the library.
    var defaultSize: GridSize {
        switch self {
        case .lineupReadiness, .matchupScore: return GridSize(w: 6, h: 3)
        case .byeWeeks: return GridSize(w: 6, h: 2)
        case .sitStart: return GridSize(w: 6, h: 4)
        case .injuries, .standings: return GridSize(w: 4, h: 4)
        case .waiverTargets, .idpStream, .wrStream, .rbStream, .playerCard: return GridSize(w: 4, h: 5)
        case .tradePartners: return GridSize(w: 5, h: 6)
        case .news: return GridSize(w: 3, h: 4)
        }
    }

    /// The smallest it can be resized to and still say something.
    var minSize: GridSize {
        switch self {
        case .sitStart, .tradePartners: return GridSize(w: 4, h: 3)
        case .matchupScore: return GridSize(w: 4, h: 2)
        case .waiverTargets, .idpStream, .wrStream, .rbStream, .playerCard: return GridSize(w: 3, h: 3)
        case .lineupReadiness, .injuries, .byeWeeks, .news, .standings: return GridSize(w: 3, h: 2)
        }
    }

    /// Panels that follow a linked selection.
    var consumesLink: Bool {
        self == .playerCard || self == .tradePartners
    }

    /// Panels whose rows publish a player (or team) to their link group.
    var publishesLink: Bool {
        switch self {
        case .sitStart, .injuries, .waiverTargets, .tradePartners, .idpStream, .wrStream, .rbStream, .standings, .matchupScore:
            return true
        case .lineupReadiness, .byeWeeks, .news, .playerCard:
            return false
        }
    }
}
