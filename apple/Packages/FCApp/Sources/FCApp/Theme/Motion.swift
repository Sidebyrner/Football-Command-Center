import SwiftUI

/// Every animation in the app goes through here, so Reduce Motion is honoured in
/// one place rather than remembered at every call site.
enum Motion {
    /// Selection changes, toggles, small layout moves.
    static let snappy: Animation = .snappy(duration: 0.28)
    /// Content arriving: cards, lists, sheets.
    static let smooth: Animation = .smooth(duration: 0.4)
    /// Numbers ticking over.
    static let number: Animation = .smooth(duration: 0.5)

    /// `nil` under Reduce Motion, which SwiftUI treats as "no animation".
    static func respecting(_ reduceMotion: Bool, _ animation: Animation) -> Animation? {
        reduceMotion ? nil : animation
    }
}

/// Animates on a value change unless the user has asked for reduced motion.
struct MotionModifier<Value: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let animation: Animation
    let value: Value

    func body(content: Content) -> some View {
        content.animation(Motion.respecting(reduceMotion, animation), value: value)
    }
}

/// Fades and lifts a view in when it first appears, optionally staggered by its
/// position in a list. Nothing moves under Reduce Motion.
struct AppearModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let index: Int
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .onAppear {
                guard !shown else { return }
                withAnimation(Motion.smooth.delay(Double(min(index, 12)) * 0.03)) {
                    shown = true
                }
            }
    }
}

extension View {
    func motion<Value: Equatable>(_ animation: Animation = Motion.snappy, value: Value) -> some View {
        modifier(MotionModifier(animation: animation, value: value))
    }

    /// Staggered entrance for list rows; pass the row's index.
    func appear(index: Int = 0) -> some View {
        modifier(AppearModifier(index: index))
    }
}
