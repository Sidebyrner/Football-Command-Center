import Foundation

/// Rounding that matches the JavaScript reference implementation exactly.
///
/// `Double.rounded()` breaks ties away from zero; JavaScript's `Math.round`
/// breaks them toward `+∞`. Fantasy points go negative often enough (an
/// incompletion-penalised QB, a fumble) that the difference is reachable, and
/// the scoring correctness gate compares to the cent. Matching the reference is
/// cheaper than arguing about which is nicer.
func roundHalfUp(_ value: Double, places: Int) -> Double {
    guard value.isFinite else { return 0 }
    let factor: Double
    switch places {
    case 0: factor = 1
    case 1: factor = 10
    case 2: factor = 100
    case 3: factor = 1_000
    default: factor = pow(10, Double(places))
    }
    return ((value * factor) + 0.5).rounded(.down) / factor
}

/// A finite `Double` or `0`. The JS reference coerces `NaN`/`Infinity`/missing
/// to zero at every arithmetic site; doing it in one place keeps that honest.
func finite(_ value: Double?) -> Double {
    guard let value, value.isFinite else { return 0 }
    return value
}
