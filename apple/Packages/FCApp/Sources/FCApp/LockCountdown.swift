import Foundation

/// "2h 14m" — how long until a lineup lock, measured on the app's own clock.
///
/// Not SwiftUI's relative date style: that always reads the device clock, and
/// the demo league and tests run on a fixed one.
public enum LockCountdown {
    public static func format(_ seconds: TimeInterval) -> String {
        guard seconds > 0 else { return "now" }
        let minutes = Int(seconds / 60)
        if minutes < 1 { return "<1m" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return minutes % 60 == 0 ? "\(hours)h" : "\(hours)h \(minutes % 60)m" }
        let days = hours / 24
        return hours % 24 == 0 ? "\(days)d" : "\(days)d \(hours % 24)h"
    }

    /// "Sun 4:25 PM", in the device's time zone.
    public static func kickoffLabel(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }
}
