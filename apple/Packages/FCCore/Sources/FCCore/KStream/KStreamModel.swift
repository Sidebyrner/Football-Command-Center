import Foundation

// Kicker streaming model: how many kicks his offense gives him, from where,
// and whether he makes them. Attempts follow the implied total and a "stall"
// factor (offenses that settle for field goals kick more); the distance mix
// is shrunk to the league's; make rates per bucket move with wind, rain, a
// dome and Denver's altitude. Plus the rest-of-season layer, with a venue
// factor per remaining game (domes help, late-season cold hurts).
//
// Ported from the reference engine (`k_stream.py`); formulas unchanged so the
// parity tests pin the port. One generalisation, identical under the
// reference's scoring: a miss can cost a different amount per distance.

public enum KBucket: String, Codable, CaseIterable, Sendable {
    case short = "0_39"
    case forty = "40_49"
    case fifty = "50_59"
    case sixty = "60"

    public var label: String {
        switch self {
        case .short: return "0–39"
        case .forty: return "40–49"
        case .fifty: return "50–59"
        case .sixty: return "60+"
        }
    }

    var leagueMix: Double {
        switch self {
        case .short: return 0.50
        case .forty: return 0.30
        case .fifty: return 0.18
        case .sixty: return 0.02
        }
    }

    var leagueMake: Double {
        switch self {
        case .short: return 0.95
        case .forty: return 0.80
        case .fifty: return 0.66
        case .sixty: return 0.30
        }
    }

    var isLong: Bool { self != .short }
}

public struct KScoring: Codable, Sendable, Hashable {
    /// Points for a make, by bucket.
    public var make: [KBucket: Double]
    /// Points for a miss (usually negative), by bucket.
    public var miss: [KBucket: Double]
    public var extraPoint: Double
    public var extraPointMiss: Double

    public init(make: [KBucket: Double] = [:], miss: [KBucket: Double] = [:], extraPoint: Double = 0, extraPointMiss: Double = 0) {
        self.make = make; self.miss = miss; self.extraPoint = extraPoint; self.extraPointMiss = extraPointMiss
    }

    public func make(_ b: KBucket) -> Double { make[b] ?? 0 }
    public func miss(_ b: KBucket) -> Double { miss[b] ?? 0 }

    /// The reference's values: 50–59 = 12 and 60+ = 15 confirmed, the rest
    /// Sleeper defaults.
    public static let referenceDefaults = KScoring(
        make: [.short: 3, .forty: 4, .fifty: 12, .sixty: 15],
        miss: [.short: -1, .forty: -1, .fifty: -1, .sixty: -1],
        extraPoint: 1, extraPointMiss: -1
    )

    /// Share of 0–39 attempts from 0–19 and 20–29; the rest are 30–39. Sleeper
    /// scores the three ranges separately and the model has one short bucket.
    static let shortSplit = (under20: 0.02, twenties: 0.38)

    /// Sleeper sums every stat a kick records: a made 45-yarder is `fgm` and
    /// `fgm_40_49`, so the per-kick value adds them.
    public static func from(sleeperSettings s: [String: Double]) -> KScoring {
        func v(_ key: String) -> Double { s[key] ?? 0 }
        let (u20, u30) = shortSplit
        let o30 = 1 - u20 - u30
        let every = v("fgm"), everyMiss = v("fgmiss")
        let shortMake = u20 * v("fgm_0_19") + u30 * v("fgm_20_29") + o30 * v("fgm_30_39")
        let shortMiss = u20 * v("fgmiss_0_19") + u30 * v("fgmiss_20_29") + o30 * v("fgmiss_30_39")
        // 50–59 and 60+ may be set as ranges, or as a 50+ threshold.
        let fifty = s["fgm_50_59"] ?? v("fgm_50p")
        let sixty = s["fgm_60p"] ?? v("fgm_50p")
        let fiftyMiss = s["fgmiss_50_59"] ?? v("fgmiss_50p")
        let sixtyMiss = s["fgmiss_60p"] ?? v("fgmiss_50p")
        return KScoring(
            make: [.short: every + shortMake, .forty: every + v("fgm_40_49"), .fifty: every + fifty, .sixty: every + sixty],
            miss: [.short: everyMiss + shortMiss, .forty: everyMiss + v("fgmiss_40_49"),
                   .fifty: everyMiss + fiftyMiss, .sixty: everyMiss + sixtyMiss],
            extraPoint: v("xpm"), extraPointMiss: v("xpmiss")
        )
    }

    public var isReferencePlaceholder: Bool { self == Self.referenceDefaults }

    static let modelledKeys: Set<String> = [
        "fgm", "fgmiss", "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50_59", "fgm_50p", "fgm_60p",
        "fgmiss_0_19", "fgmiss_20_29", "fgmiss_30_39", "fgmiss_40_49", "fgmiss_50_59", "fgmiss_50p", "fgmiss_60p",
        "xpm", "xpmiss",
    ]

    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        s.filter { key, value in
            value != 0 && !modelledKeys.contains(key) && (key.hasPrefix("fg") || key.hasPrefix("xp"))
        }
        .map(\.key).sorted()
    }
}

public enum KVenue: String, Codable, CaseIterable, Sendable {
    case outdoor, dome, retractable

    public var label: String {
        switch self {
        case .outdoor: return "Outdoors"
        case .dome: return "Dome"
        case .retractable: return "Retractable roof"
        }
    }
}

// MARK: - Candidate

public struct KCandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var opp: String
    public var home: Bool?
    public var spreadOff: Double
    public var total: Double
    public var games: Int
    /// Attempts and makes by distance bucket.
    public var fga: [KBucket: Double]
    public var fgm: [KBucket: Double]
    public var xpa: Double
    public var xpm: Double
    public var teamFga: Double
    public var teamOffTd: Double
    public var teamGames: Int
    public var venue: KVenue
    public var windMph: Double
    public var precipPct: Double
    public var altitude: Bool
    public var dvpPct: Double
    public var dvpGames: Int
    public var schedule: [Int: String]
    public var oppDvp: [String: Double]
    /// Week → whether his team is at home, for the rest-of-season venue factors.
    public var homeMap: [Int: Bool]
    public var currentWeek: Int
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, opp: String, home: Bool? = nil, spreadOff: Double = 0, total: Double = 45,
                games: Int = 0, fga: [KBucket: Double] = [:], fgm: [KBucket: Double] = [:], xpa: Double = 0,
                xpm: Double = 0, teamFga: Double = 0, teamOffTd: Double = 0, teamGames: Int = 0,
                venue: KVenue = .outdoor, windMph: Double = 0, precipPct: Double = 0, altitude: Bool = false,
                dvpPct: Double = 0, dvpGames: Int = 0, schedule: [Int: String] = [:], oppDvp: [String: Double] = [:],
                homeMap: [Int: Bool] = [:], currentWeek: Int = 3, practice: StreamPractice = .none,
                rosterPct: Double? = nil, available: Bool? = nil, notes: String = "", sources: [String] = [],
                dataFlags: [String] = [], playerID: String? = nil) {
        self.name = name; self.team = team; self.opp = opp; self.home = home; self.spreadOff = spreadOff
        self.total = total; self.games = games; self.fga = fga; self.fgm = fgm; self.xpa = xpa; self.xpm = xpm
        self.teamFga = teamFga; self.teamOffTd = teamOffTd; self.teamGames = teamGames; self.venue = venue
        self.windMph = windMph; self.precipPct = precipPct; self.altitude = altitude; self.dvpPct = dvpPct
        self.dvpGames = dvpGames; self.schedule = schedule; self.oppDvp = oppDvp; self.homeMap = homeMap
        self.currentWeek = currentWeek; self.practice = practice; self.rosterPct = rosterPct
        self.available = available; self.notes = notes; self.sources = sources; self.dataFlags = dataFlags
        self.playerID = playerID
    }

    enum CodingKeys: String, CodingKey {
        case name, team, opp, home, spreadOff = "spread_off", total, games, fga, fgm, xpa, xpm
        case teamFga = "team_fga", teamOffTd = "team_off_td", teamGames = "team_games", venue, windMph = "wind_mph"
        case precipPct = "precip_pct", altitude, dvpPct = "dvp_pct", dvpGames = "dvp_games", schedule
        case oppDvp = "opp_dvp", homeMap = "home_map", currentWeek = "current_week", practice
        case rosterPct = "roster_pct", available, notes, sources, dataFlags = "data_flags", playerID = "player_id"
    }

    private static func buckets(_ raw: [String: Double]?) -> [KBucket: Double] {
        var out: [KBucket: Double] = [:]
        for (k, v) in raw ?? [:] { if let b = KBucket(rawValue: k) { out[b] = v } }
        return out
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func d(_ k: CodingKeys, _ fallback: Double = 0) throws -> Double { try c.decodeIfPresent(Double.self, forKey: k) ?? fallback }
        name = try c.decode(String.self, forKey: .name)
        team = try c.decode(String.self, forKey: .team)
        opp = try c.decode(String.self, forKey: .opp)
        home = try c.decodeIfPresent(Bool.self, forKey: .home)
        spreadOff = try d(.spreadOff); total = try d(.total, 45)
        games = try c.decodeIfPresent(Int.self, forKey: .games) ?? 0
        fga = Self.buckets(try c.decodeIfPresent([String: Double].self, forKey: .fga))
        fgm = Self.buckets(try c.decodeIfPresent([String: Double].self, forKey: .fgm))
        xpa = try d(.xpa); xpm = try d(.xpm)
        teamFga = try d(.teamFga); teamOffTd = try d(.teamOffTd)
        teamGames = try c.decodeIfPresent(Int.self, forKey: .teamGames) ?? 0
        venue = try c.decodeIfPresent(KVenue.self, forKey: .venue) ?? .outdoor
        windMph = try d(.windMph); precipPct = try d(.precipPct)
        altitude = try c.decodeIfPresent(Bool.self, forKey: .altitude) ?? false
        dvpPct = try d(.dvpPct); dvpGames = try c.decodeIfPresent(Int.self, forKey: .dvpGames) ?? 0
        schedule = (try c.decodeIfPresent([String: String].self, forKey: .schedule) ?? [:]).intKeyed()
        oppDvp = try c.decodeIfPresent([String: Double].self, forKey: .oppDvp) ?? [:]
        homeMap = (try c.decodeIfPresent([String: Bool].self, forKey: .homeMap) ?? [:]).intKeyed()
        currentWeek = try c.decodeIfPresent(Int.self, forKey: .currentWeek) ?? 3
        practice = try c.decodeIfPresent(StreamPractice.self, forKey: .practice) ?? .none
        rosterPct = try c.decodeIfPresent(Double.self, forKey: .rosterPct)
        available = try c.decodeIfPresent(Bool.self, forKey: .available)
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        sources = try c.decodeIfPresent([String].self, forKey: .sources) ?? []
        dataFlags = try c.decodeIfPresent([String].self, forKey: .dataFlags) ?? []
        playerID = try c.decodeIfPresent(String.self, forKey: .playerID)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name); try c.encode(team, forKey: .team); try c.encode(opp, forKey: .opp)
        try c.encodeIfPresent(home, forKey: .home); try c.encode(spreadOff, forKey: .spreadOff)
        try c.encode(total, forKey: .total); try c.encode(games, forKey: .games)
        try c.encode(Dictionary(uniqueKeysWithValues: fga.map { ($0.key.rawValue, $0.value) }), forKey: .fga)
        try c.encode(Dictionary(uniqueKeysWithValues: fgm.map { ($0.key.rawValue, $0.value) }), forKey: .fgm)
        try c.encode(xpa, forKey: .xpa); try c.encode(xpm, forKey: .xpm); try c.encode(teamFga, forKey: .teamFga)
        try c.encode(teamOffTd, forKey: .teamOffTd); try c.encode(teamGames, forKey: .teamGames)
        try c.encode(venue, forKey: .venue); try c.encode(windMph, forKey: .windMph)
        try c.encode(precipPct, forKey: .precipPct); try c.encode(altitude, forKey: .altitude)
        try c.encode(dvpPct, forKey: .dvpPct); try c.encode(dvpGames, forKey: .dvpGames)
        try c.encode(Dictionary(uniqueKeysWithValues: schedule.map { (String($0.key), $0.value) }), forKey: .schedule)
        try c.encode(oppDvp, forKey: .oppDvp)
        try c.encode(Dictionary(uniqueKeysWithValues: homeMap.map { (String($0.key), $0.value) }), forKey: .homeMap)
        try c.encode(currentWeek, forKey: .currentWeek); try c.encode(practice, forKey: .practice)
        try c.encodeIfPresent(rosterPct, forKey: .rosterPct); try c.encodeIfPresent(available, forKey: .available)
        try c.encode(notes, forKey: .notes); try c.encode(sources, forKey: .sources)
        try c.encode(dataFlags, forKey: .dataFlags); try c.encodeIfPresent(playerID, forKey: .playerID)
    }
}

// MARK: - Projection

public struct KProjection: StreamROSProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var opponent: String
    public var playerID: String?
    public var venue: KVenue
    public var implied: Double
    public var eFga: Double
    public var eFgm: Double
    public var eMiss: Double
    public var eXpa: Double
    public var eXpm: Double
    /// Expected attempts of 50+ yards.
    public var e50pAtt: Double
    public var stall: Double
    public var dvpMult: Double
    /// Wind over the 12 mph threshold.
    public var windOver: Double
    public var meanIfPlays: Double
    public var sdIfPlays: Double
    public var pPlay: Double
    public var expPts: Double
    public var floorP25: Double
    public var ceilingP75: Double
    public var utility: Double
    public var neutralMean: Double
    public var ros: StreamROS
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var flags: [String]
    public var notes: String
    public var sources: [String]
    public var explain: [String]
    public var breakdown: [StreamStatPoints]
    public var pBeatIncumbent: Double?
    public var expGain: Double?
    public var bidBand: StreamBidBand?

    public var platform: Position { .k }
    public var roleLabel: String { venue.label }
    public var roleConf: Double { 1 }
}

// MARK: - Engine

public enum KStreamEngine {
    typealias M = StreamMath

    public enum League {
        public static let fgaPerGame = 1.9, xpaPerGame = 2.4, implied = 22.5, xpMake = 0.95
    }

    public enum Knobs {
        public static let fgaK = 4.0, xpaK = 4.0, mixK = 12.0, makeK = 10.0, impliedExponent = 0.5, stallCap = 0.25
        public static let windThreshold = 12.0, windLongPenalty = 0.012, windMixShift = 0.25
        public static let rainPenalty = 0.04, domeBonus = 0.02, altitudeLongBonus = 0.06, altitudeMixBonus = 0.30
        public static let dvpCap = 0.15, rosCap = 0.15, rosDome = 1.03, rosColdLate = 0.94, lateWeek = 13
    }

    /// nflverse codes of teams that play home games under a roof.
    public static let domeHome: Set<String> = ["ATL", "ARI", "DAL", "DET", "HOU", "IND", "LV", "LA", "LAR", "LAC", "MIN", "NO"]
    public static let coldOutdoor: Set<String> = ["BUF", "GB", "CHI", "CLE", "PIT", "NE", "DEN", "KC", "NYJ", "NYG",
                                                  "PHI", "BAL", "WAS", "CIN", "SEA", "TEN"]

    struct Core {
        var implied, eFga, eXpa, eMade, eMiss, eXpm, stall, dvp, wind, mean, sd: Double
        var mix: [KBucket: Double]
        var byBucket: [KBucket: Double]
        var xpPoints: Double
    }

    static func core(_ c: KCandidate, _ s: KScoring, neutral: Bool) -> Core {
        typealias K = Knobs
        typealias L = League
        let g = Double(c.games), tg = Double(c.teamGames)
        let implied = neutral ? L.implied : (c.total - c.spreadOff) / 2
        let baseFga = M.shrink(c.teamGames > 0 ? c.teamFga / tg : nil, tg, L.fgaPerGame, K.fgaK)
        let ratio: Double? = c.teamOffTd > 0 ? c.teamFga / c.teamOffTd : nil
        let stall = 1 + M.clamp((M.shrink(ratio, tg, 0.8, K.fgaK) - 0.8) / 0.8 * 0.5, -K.stallCap, K.stallCap)
        let m = neutral ? 1 : StreamRestOfSeason.dvpMult(c.dvpPct, games: c.dvpGames, cap: K.dvpCap)
        let eFga = baseFga * pow(implied / L.implied, K.impliedExponent) * stall * m
        let eXpa = M.shrink(c.games > 0 ? c.xpa / g : nil, g, L.xpaPerGame, K.xpaK) * (implied / L.implied) / stall.squareRoot()

        let totalAttempts = KBucket.allCases.reduce(0) { $0 + (c.fga[$1] ?? 0) }
        var mix: [KBucket: Double] = [:]
        for b in KBucket.allCases {
            mix[b] = M.shrink(totalAttempts > 0 ? (c.fga[b] ?? 0) / totalAttempts : nil, totalAttempts, b.leagueMix, K.mixK)
        }
        let indoors = c.venue == .dome
        let wind = neutral || indoors ? 0 : max(0, c.windMph - K.windThreshold)
        let rain = neutral || indoors ? 0 : c.precipPct / 100
        let altitude = !neutral && c.altitude
        if wind > 0 {
            let shift = min(K.windMixShift, wind * 0.03)
            let moved = (mix[.fifty]! + mix[.sixty]!) * shift
            mix[.fifty]! *= (1 - shift); mix[.sixty]! *= (1 - shift); mix[.forty]! += moved
        }
        if altitude {
            let bump = mix[.forty]! * K.altitudeMixBonus * 0.5
            mix[.forty]! -= bump; mix[.fifty]! += bump * 0.8; mix[.sixty]! += bump * 0.2
        }
        let mixTotal = KBucket.allCases.reduce(0) { $0 + mix[$1]! }
        for b in KBucket.allCases { mix[b]! /= mixTotal }

        var make: [KBucket: Double] = [:]
        for b in KBucket.allCases {
            let attempts = c.fga[b] ?? 0
            let base = M.shrink(attempts > 0 ? (c.fgm[b] ?? 0) / attempts : nil, attempts, b.leagueMake, K.makeK)
            var adj = 1.0
            if b.isLong {
                adj -= wind * K.windLongPenalty
                if altitude { adj += K.altitudeLongBonus }
            }
            adj -= rain * K.rainPenalty
            if !neutral && indoors { adj += K.domeBonus }
            make[b] = M.clamp(base * adj, 0.10, 0.99)
        }
        let xpMake = M.clamp(M.shrink(c.xpa > 0 ? c.xpm / c.xpa : nil, c.xpa, L.xpMake, K.makeK) - rain * 0.02 - wind * 0.004,
                             0.80, 0.995)

        var byBucket: [KBucket: Double] = [:]
        var eMade = 0.0, eMiss = 0.0, v = 0.0
        for b in KBucket.allCases {
            let att = eFga * mix[b]!, mk = att * make[b]!, ms = att - mk
            let hit = s.make(b), miss = s.miss(b)
            byBucket[b] = mk * hit + ms * miss
            eMade += mk; eMiss += ms
            v += att * make[b]! * (1 - make[b]!) * (hit - miss) * (hit - miss)
                + att * pow(make[b]! * hit + (1 - make[b]!) * miss, 2)
        }
        let eXpm = eXpa * xpMake
        let xpPoints = eXpm * s.extraPoint + (eXpa - eXpm) * s.extraPointMiss
        v += eXpa * s.extraPoint * s.extraPoint
        let mean = KBucket.allCases.reduce(0) { $0 + byBucket[$1]! } + xpPoints
        return Core(implied: implied, eFga: eFga, eXpa: eXpa, eMade: eMade, eMiss: eMiss, eXpm: eXpm, stall: stall,
                    dvp: m, wind: wind, mean: mean, sd: v.squareRoot(), mix: mix, byBucket: byBucket, xpPoints: xpPoints)
    }

    /// Per remaining game: a dome helps, late-season cold outdoors hurts.
    static func venueAdjustments(_ c: KCandidate) -> [Int: Double] {
        var out: [Int: Double] = [:]
        for (week, opponent) in c.schedule where week > c.currentWeek {
            let site = c.homeMap[week] == true ? c.team : opponent.replacingOccurrences(of: "@", with: "")
            var factor = 1.0
            if domeHome.contains(site) {
                factor *= Knobs.rosDome
            } else if week >= Knobs.lateWeek && coldOutdoor.contains(site) {
                factor *= Knobs.rosColdLate
            }
            out[week] = factor
        }
        return out
    }

    public static func project(_ c: KCandidate, scoring s: KScoring, risk: StreamRiskMode = .neutral,
                               horizon: StreamHorizon = .week) -> KProjection {
        let x = core(c, s, neutral: false)
        let n = core(c, s, neutral: true)
        let pPlay = c.practice.playProbability
        let expPts = pPlay * x.mean
        let z = StreamMath.quartileZ
        let ros = StreamRestOfSeason.summary(currentWeek: c.currentWeek, schedule: c.schedule, oppDvp: c.oppDvp,
                                             dvpGames: c.dvpGames, neutralMean: n.mean, venueAdj: venueAdjustments(c),
                                             cap: Knobs.rosCap)
        let utility = StreamRestOfSeason.blendedUtility(expPts: expPts, sd: x.sd, rosPerGame: ros.perGame,
                                                        pPlay: pPlay, risk: risk, horizon: horizon)
        var flags = c.dataFlags
        if c.fga.values.reduce(0, +) < 5 { flags.append("thin FG sample") }
        if c.available == nil { flags.append("availability unverified") }
        if s.make(.short) == 3 && s.make(.forty) == 4 { flags.append("0–39 / 40–49 / XP / miss values are placeholders") }
        if c.schedule.isEmpty { flags.append("no remaining schedule → ROS = neutral") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let e50 = x.eFga * (x.mix[.fifty]! + x.mix[.sixty]!)
        var venue = "Venue \(c.venue.label)"
        if x.wind > 0 { venue += ", wind \(f(x.wind, 0)) mph over 12" }
        if c.precipPct > 0 { venue += ", rain \(f(c.precipPct, 0))%" }
        if c.altitude { venue += ", altitude" }
        var rosLine = "Rest of season \(f(ros.perGame, 1))/g over \(ros.games) games"
        if let bye = ros.byeWeek { rosLine += " (bye W\(bye))" }
        var explain: [String] = [
            "\(f(x.eFga, 2)) field-goal attempts (implied \(f(x.implied, 1)), stall ×\(f(x.stall, 2)), matchup ×\(f(x.dvp, 3))) → \(f(x.eMade, 2)) makes",
            "\(f(e50, 2)) attempts of 50+ yards · \(f(x.eXpa, 2)) extra points",
            venue,
            rosLine,
        ]
        if c.windMph == 0 && c.precipPct == 0 && c.venue != .dome { explain.append("No weather entered — calm and dry assumed.") }
        let breakdown = KBucket.allCases.map { b in
            StreamStatPoints(stat: "FG \(b.label)", count: x.eFga * x.mix[b]!, points: x.byBucket[b]!)
        } + [StreamStatPoints(stat: "Extra points", count: x.eXpa, points: x.xpPoints)]
        return KProjection(
            name: c.name, team: c.team, opponent: c.opp, playerID: c.playerID, venue: c.venue, implied: x.implied,
            eFga: x.eFga, eFgm: x.eMade, eMiss: x.eMiss, eXpa: x.eXpa, eXpm: x.eXpm, e50pAtt: e50, stall: x.stall,
            dvpMult: x.dvp, windOver: x.wind, meanIfPlays: x.mean, sdIfPlays: x.sd, pPlay: pPlay, expPts: expPts,
            floorP25: max(0, pPlay * (x.mean - z * x.sd)), ceilingP75: pPlay * (x.mean + z * x.sd),
            utility: utility, neutralMean: n.mean, ros: ros, practice: c.practice, rosterPct: c.rosterPct,
            available: c.available, flags: flags, notes: c.notes, sources: c.sources, explain: explain,
            breakdown: breakdown.filter { $0.points != 0 }.sorted { $0.points > $1.points },
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    static func f(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }
}

public typealias KStreamReport = StreamReport<KProjection>
