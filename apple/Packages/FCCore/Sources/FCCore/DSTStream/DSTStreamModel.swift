import Foundation

// Team defense streaming model. Sacks, interceptions and fumble recoveries
// take both units, so each rate is the geometric blend of the defense's own
// shrunk rate and the opponent offense's giveaway rate, times the opponent's
// volume. Points allowed come from the betting market — the opponent's
// implied total — and the tier score is its expected value over a normal
// around that, not one bucket. Plus the rest-of-season layer.
//
// Ported from the reference engine (`dst_stream.py`); formulas unchanged so
// the parity tests pin the port.

/// A points- or yards-allowed tier: this many or fewer allowed scores `points`.
public struct DSTTier: Codable, Hashable, Sendable {
    public var upTo: Double
    public var points: Double

    public init(upTo: Double, points: Double) {
        self.upTo = upTo
        self.points = points
    }
}

public struct DSTScoring: Codable, Sendable, Hashable {
    public var sack, interception, fumbleRecovery, forcedFumble, touchdown, safety, block: Double
    public var pointsAllowed: [DSTTier]
    public var yardsAllowed: [DSTTier]

    public init(sack: Double = 0, interception: Double = 0, fumbleRecovery: Double = 0, forcedFumble: Double = 0,
                touchdown: Double = 0, safety: Double = 0, block: Double = 0,
                pointsAllowed: [DSTTier] = [], yardsAllowed: [DSTTier] = []) {
        self.sack = sack; self.interception = interception; self.fumbleRecovery = fumbleRecovery
        self.forcedFumble = forcedFumble; self.touchdown = touchdown; self.safety = safety; self.block = block
        self.pointsAllowed = pointsAllowed; self.yardsAllowed = yardsAllowed
    }

    /// Sleeper's defaults — the reference's placeholder.
    public static let referenceDefaults = DSTScoring(
        sack: 1, interception: 2, fumbleRecovery: 2, forcedFumble: 0, touchdown: 6, safety: 2, block: 2,
        pointsAllowed: [(0, 10), (6, 7), (13, 4), (20, 1), (27, 0), (34, -1), (999, -4)].map { DSTTier(upTo: $0.0, points: $0.1) },
        yardsAllowed: [99, 199, 299, 349, 399, 449, 499, 9999].map { DSTTier(upTo: $0, points: 0) }
    )

    /// A league with no team-defense scoring at all gets Sleeper's defaults,
    /// flagged as a placeholder, rather than a wall of zeros.
    public static func from(sleeperSettings s: [String: Double]) -> DSTScoring {
        guard modelledKeys.contains(where: { (s[$0] ?? 0) != 0 }) else { return referenceDefaults }
        func v(_ key: String) -> Double { s[key] ?? 0 }
        return DSTScoring(
            sack: v("sack"), interception: v("int"), fumbleRecovery: v("fum_rec"), forcedFumble: v("ff"),
            touchdown: v("def_td"), safety: v("safe"), block: v("blk_kick"),
            pointsAllowed: [
                DSTTier(upTo: 0, points: v("pts_allow_0")), DSTTier(upTo: 6, points: v("pts_allow_1_6")),
                DSTTier(upTo: 13, points: v("pts_allow_7_13")), DSTTier(upTo: 20, points: v("pts_allow_14_20")),
                DSTTier(upTo: 27, points: v("pts_allow_21_27")), DSTTier(upTo: 34, points: v("pts_allow_28_34")),
                DSTTier(upTo: 999, points: v("pts_allow_35p")),
            ],
            yardsAllowed: [
                DSTTier(upTo: 99, points: v("yds_allow_0_100")), DSTTier(upTo: 199, points: v("yds_allow_100_199")),
                DSTTier(upTo: 299, points: v("yds_allow_200_299")), DSTTier(upTo: 349, points: v("yds_allow_300_349")),
                DSTTier(upTo: 399, points: v("yds_allow_350_399")), DSTTier(upTo: 449, points: v("yds_allow_400_449")),
                DSTTier(upTo: 499, points: v("yds_allow_450_499")), DSTTier(upTo: 549, points: v("yds_allow_500_549")),
                DSTTier(upTo: 9999, points: v("yds_allow_550p")),
            ]
        )
    }

    public var isReferencePlaceholder: Bool { pointsAllowed == Self.referenceDefaults.pointsAllowed }

    static let modelledKeys: Set<String> = [
        "sack", "int", "fum_rec", "ff", "def_td", "safe", "blk_kick",
        "pts_allow_0", "pts_allow_1_6", "pts_allow_7_13", "pts_allow_14_20", "pts_allow_21_27",
        "pts_allow_28_34", "pts_allow_35p", "yds_allow_0_100", "yds_allow_100_199", "yds_allow_200_299",
        "yds_allow_300_349", "yds_allow_350_399", "yds_allow_400_449", "yds_allow_450_499",
        "yds_allow_500_549", "yds_allow_550p",
    ]

    /// Team-defense keys the league pays that aren't projected, named on screen.
    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        let prefixes = ["def_", "st_", "pts_allow", "yds_allow", "bonus_def", "fum_rec_td", "int_ret", "blk_kick_", "safe"]
        return s.filter { key, value in
            value != 0 && !modelledKeys.contains(key) && prefixes.contains { key.hasPrefix($0) }
        }
        .map(\.key).sorted()
    }
}

// MARK: - Candidate

public struct DSTCandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var opp: String
    public var home: Bool?
    /// This team's spread: positive = underdog.
    public var spreadDef: Double
    public var total: Double
    public var games: Int
    public var sacks, ints, fr, ff, defTd, retTd, safeties, blocks, paTotal, yaTotal, dropbacksFaced, playsFaced: Double
    public var oppGames: Int
    public var oppDropbacks, oppPlays, oppSacksTaken, oppIntsThrown, oppFumLost, oppPpg, oppYpg, oppQbAdj: Double
    /// Fantasy points this opponent's offense allows to D/STs, % vs average.
    public var dvpPct: Double
    public var dvpGames: Int
    public var schedule: [Int: String]
    public var oppDvp: [String: Double]
    /// Opponent → points per game, for the rest-of-season points-allowed shift.
    public var oppPpgMap: [String: Double]
    public var currentWeek: Int
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, opp: String, home: Bool? = nil, spreadDef: Double = 0, total: Double = 45,
                games: Int = 0, sacks: Double = 0, ints: Double = 0, fr: Double = 0, ff: Double = 0, defTd: Double = 0,
                retTd: Double = 0, safeties: Double = 0, blocks: Double = 0, paTotal: Double = 0, yaTotal: Double = 0,
                dropbacksFaced: Double = 0, playsFaced: Double = 0, oppGames: Int = 0, oppDropbacks: Double = 0,
                oppPlays: Double = 0, oppSacksTaken: Double = 0, oppIntsThrown: Double = 0, oppFumLost: Double = 0,
                oppPpg: Double = 22.5, oppYpg: Double = 330, oppQbAdj: Double = 1, dvpPct: Double = 0,
                dvpGames: Int = 0, schedule: [Int: String] = [:], oppDvp: [String: Double] = [:],
                oppPpgMap: [String: Double] = [:], currentWeek: Int = 3, practice: StreamPractice = .none,
                rosterPct: Double? = nil, available: Bool? = nil, notes: String = "", sources: [String] = [],
                dataFlags: [String] = [], playerID: String? = nil) {
        self.name = name; self.team = team; self.opp = opp; self.home = home; self.spreadDef = spreadDef
        self.total = total; self.games = games; self.sacks = sacks; self.ints = ints; self.fr = fr; self.ff = ff
        self.defTd = defTd; self.retTd = retTd; self.safeties = safeties; self.blocks = blocks
        self.paTotal = paTotal; self.yaTotal = yaTotal; self.dropbacksFaced = dropbacksFaced
        self.playsFaced = playsFaced; self.oppGames = oppGames; self.oppDropbacks = oppDropbacks
        self.oppPlays = oppPlays; self.oppSacksTaken = oppSacksTaken; self.oppIntsThrown = oppIntsThrown
        self.oppFumLost = oppFumLost; self.oppPpg = oppPpg; self.oppYpg = oppYpg; self.oppQbAdj = oppQbAdj
        self.dvpPct = dvpPct; self.dvpGames = dvpGames; self.schedule = schedule; self.oppDvp = oppDvp
        self.oppPpgMap = oppPpgMap; self.currentWeek = currentWeek; self.practice = practice
        self.rosterPct = rosterPct; self.available = available; self.notes = notes; self.sources = sources
        self.dataFlags = dataFlags; self.playerID = playerID
    }

    enum CodingKeys: String, CodingKey {
        case name, team, opp, home, spreadDef = "spread_def", total, games, sacks, ints, fr, ff, defTd = "def_td"
        case retTd = "ret_td", safeties, blocks, paTotal = "pa_total", yaTotal = "ya_total"
        case dropbacksFaced = "dropbacks_faced", playsFaced = "plays_faced", oppGames = "opp_games"
        case oppDropbacks = "opp_dropbacks", oppPlays = "opp_plays", oppSacksTaken = "opp_sacks_taken"
        case oppIntsThrown = "opp_ints_thrown", oppFumLost = "opp_fum_lost", oppPpg = "opp_ppg", oppYpg = "opp_ypg"
        case oppQbAdj = "opp_qb_adj", dvpPct = "dvp_pct", dvpGames = "dvp_games", schedule, oppDvp = "opp_dvp"
        case oppPpgMap = "opp_ppg_map", currentWeek = "current_week", practice, rosterPct = "roster_pct"
        case available, notes, sources, dataFlags = "data_flags", playerID = "player_id"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func d(_ k: CodingKeys, _ fallback: Double = 0) throws -> Double { try c.decodeIfPresent(Double.self, forKey: k) ?? fallback }
        name = try c.decode(String.self, forKey: .name)
        team = try c.decode(String.self, forKey: .team)
        opp = try c.decode(String.self, forKey: .opp)
        home = try c.decodeIfPresent(Bool.self, forKey: .home)
        spreadDef = try d(.spreadDef); total = try d(.total, 45)
        games = try c.decodeIfPresent(Int.self, forKey: .games) ?? 0
        sacks = try d(.sacks); ints = try d(.ints); fr = try d(.fr); ff = try d(.ff); defTd = try d(.defTd)
        retTd = try d(.retTd); safeties = try d(.safeties); blocks = try d(.blocks)
        paTotal = try d(.paTotal); yaTotal = try d(.yaTotal)
        dropbacksFaced = try d(.dropbacksFaced); playsFaced = try d(.playsFaced)
        oppGames = try c.decodeIfPresent(Int.self, forKey: .oppGames) ?? 0
        oppDropbacks = try d(.oppDropbacks); oppPlays = try d(.oppPlays); oppSacksTaken = try d(.oppSacksTaken)
        oppIntsThrown = try d(.oppIntsThrown); oppFumLost = try d(.oppFumLost)
        oppPpg = try d(.oppPpg, 22.5); oppYpg = try d(.oppYpg, 330); oppQbAdj = try d(.oppQbAdj, 1)
        dvpPct = try d(.dvpPct); dvpGames = try c.decodeIfPresent(Int.self, forKey: .dvpGames) ?? 0
        schedule = (try c.decodeIfPresent([String: String].self, forKey: .schedule) ?? [:]).intKeyed()
        oppDvp = try c.decodeIfPresent([String: Double].self, forKey: .oppDvp) ?? [:]
        oppPpgMap = try c.decodeIfPresent([String: Double].self, forKey: .oppPpgMap) ?? [:]
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
        try c.encodeIfPresent(home, forKey: .home); try c.encode(spreadDef, forKey: .spreadDef)
        try c.encode(total, forKey: .total); try c.encode(games, forKey: .games)
        try c.encode(sacks, forKey: .sacks); try c.encode(ints, forKey: .ints); try c.encode(fr, forKey: .fr)
        try c.encode(ff, forKey: .ff); try c.encode(defTd, forKey: .defTd); try c.encode(retTd, forKey: .retTd)
        try c.encode(safeties, forKey: .safeties); try c.encode(blocks, forKey: .blocks)
        try c.encode(paTotal, forKey: .paTotal); try c.encode(yaTotal, forKey: .yaTotal)
        try c.encode(dropbacksFaced, forKey: .dropbacksFaced); try c.encode(playsFaced, forKey: .playsFaced)
        try c.encode(oppGames, forKey: .oppGames); try c.encode(oppDropbacks, forKey: .oppDropbacks)
        try c.encode(oppPlays, forKey: .oppPlays); try c.encode(oppSacksTaken, forKey: .oppSacksTaken)
        try c.encode(oppIntsThrown, forKey: .oppIntsThrown); try c.encode(oppFumLost, forKey: .oppFumLost)
        try c.encode(oppPpg, forKey: .oppPpg); try c.encode(oppYpg, forKey: .oppYpg); try c.encode(oppQbAdj, forKey: .oppQbAdj)
        try c.encode(dvpPct, forKey: .dvpPct); try c.encode(dvpGames, forKey: .dvpGames)
        try c.encode(Dictionary(uniqueKeysWithValues: schedule.map { (String($0.key), $0.value) }), forKey: .schedule)
        try c.encode(oppDvp, forKey: .oppDvp); try c.encode(oppPpgMap, forKey: .oppPpgMap)
        try c.encode(currentWeek, forKey: .currentWeek); try c.encode(practice, forKey: .practice)
        try c.encodeIfPresent(rosterPct, forKey: .rosterPct); try c.encodeIfPresent(available, forKey: .available)
        try c.encode(notes, forKey: .notes); try c.encode(sources, forKey: .sources)
        try c.encode(dataFlags, forKey: .dataFlags); try c.encodeIfPresent(playerID, forKey: .playerID)
    }
}

// MARK: - Projection

public struct DSTProjection: StreamROSProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var opponent: String
    public var playerID: String?
    public var expDropbacks: Double
    public var eSacks: Double
    public var eInt: Double
    public var eFr: Double
    public var eTd: Double
    /// Points the opponent is expected to score.
    public var impliedOpp: Double
    public var paMean: Double
    public var paPts: Double
    public var yaMean: Double
    public var yaPts: Double
    public var dvpMult: Double
    public var qbAdj: Double
    public var meanIfPlays: Double
    public var sdIfPlays: Double
    public var pPlay: Double
    public var expPts: Double
    public var floorP25: Double
    public var ceilingP75: Double
    public var utility: Double
    public var neutralMean: Double
    public var ros: StreamROS
    /// Mean points per game of the remaining opponents.
    public var rosAvgOppPpg: Double
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

    public var platform: Position { .def }
    public var roleLabel: String { "D/ST" }
    public var roleConf: Double { 1 }
    public var eTakeaways: Double { eInt + eFr }
}

// MARK: - Engine

public enum DSTStreamEngine {
    typealias M = StreamMath

    public enum League {
        public static let sackRate = 0.065, intRate = 0.022, fumbleLostRate = 0.010
        public static let dropbacks = 37.0, plays = 63.0, ppg = 22.5, ypg = 330.0
        public static let touchdownPerTakeaway = 0.10, returnTouchdownsPerGame = 0.03
        public static let safetiesPerGame = 0.03, blocksPerGame = 0.05
    }

    public enum Knobs {
        public static let volumeShrinkK = 3.0, rateKDefense = 120.0, rateKOffense = 120.0, fumbleK = 100.0
        public static let impliedWeight = 0.70, pointsAllowedSD = 9.5, yardsAllowedSD = 65.0
        public static let pointsAllowedRange = 6.0...45.0
        public static let dvpCap = 0.10, rosCap = 0.15
    }

    /// Expected tier points when the stat is ~Normal(mean, sd), integrated over the buckets.
    public static func tierEV(mean: Double, sd: Double, tiers: [DSTTier]) -> Double {
        var ev = 0.0
        var lo = -Double.infinity
        for tier in tiers {
            let pHi = tier.upTo < 999 ? StreamDecision.normalCDF((tier.upTo + 0.5 - mean) / sd) : 1
            let pLo = lo > -Double.infinity ? StreamDecision.normalCDF((lo + 0.5 - mean) / sd) : 0
            ev += tier.points * max(0, pHi - pLo)
            lo = tier.upTo
        }
        return ev
    }

    struct Core {
        var dropbacks, eSacks, eInt, eFr, eTd, impliedOpp, paMean, yaMean, paPts, yaPts, dvp, qbAdj, mean, sd: Double
        var breakdown: [StreamStatPoints]
    }

    static func core(_ c: DSTCandidate, _ s: DSTScoring, neutral: Bool) -> Core {
        typealias L = League
        typealias K = Knobs
        let g = Double(c.games), og = Double(c.oppGames)
        let oppDB = M.shrink(c.oppGames > 0 ? c.oppDropbacks / og : nil, og, L.dropbacks, K.volumeShrinkK)
        let facedDB = M.shrink(c.games > 0 ? c.dropbacksFaced / g : nil, g, L.dropbacks, K.volumeShrinkK)
        var dropbacks = 0.6 * oppDB + 0.4 * facedDB
        var oppPlays = M.shrink(c.oppGames > 0 ? c.oppPlays / og : nil, og, L.plays, K.volumeShrinkK)
        let defSack = M.shrink(c.dropbacksFaced > 0 ? c.sacks / c.dropbacksFaced : nil, c.dropbacksFaced, L.sackRate, K.rateKDefense)
        var offSack = M.shrink(c.oppDropbacks > 0 ? c.oppSacksTaken / c.oppDropbacks : nil, c.oppDropbacks, L.sackRate, K.rateKOffense)
        let defInt = M.shrink(c.dropbacksFaced > 0 ? c.ints / c.dropbacksFaced : nil, c.dropbacksFaced, L.intRate, K.rateKDefense)
        var offInt = M.shrink(c.oppDropbacks > 0 ? c.oppIntsThrown / c.oppDropbacks : nil, c.oppDropbacks, L.intRate, K.rateKOffense)
        let defFl = M.shrink(c.playsFaced > 0 ? c.fr / c.playsFaced : nil, c.playsFaced, L.fumbleLostRate, K.fumbleK)
        var offFl = M.shrink(c.oppPlays > 0 ? c.oppFumLost / c.oppPlays : nil, c.oppPlays, L.fumbleLostRate, K.fumbleK)
        let qbAdj = neutral ? 1 : c.oppQbAdj
        let m = neutral ? 1 : StreamRestOfSeason.dvpMult(c.dvpPct, games: c.dvpGames, cap: K.dvpCap)
        if neutral {
            offSack = L.sackRate; offInt = L.intRate; offFl = L.fumbleLostRate
            dropbacks = facedDB; oppPlays = L.plays
        }
        let sackRate = (defSack * offSack).squareRoot() * qbAdj
        let intRate = (defInt * offInt).squareRoot() * qbAdj
        let flRate = (defFl * offFl).squareRoot() * qbAdj
        let eSacks = dropbacks * sackRate * m
        let eInt = dropbacks * intRate * m
        let eFr = oppPlays * flRate * m
        let takeaways = eInt + eFr
        let eTd = takeaways * L.touchdownPerTakeaway + L.returnTouchdownsPerGame
            + M.shrink(c.games > 0 ? c.defTd / g : nil, g, 0, 10) * 0.5
        let eSaf = L.safetiesPerGame, eBlk = L.blocksPerGame
        let impliedOpp = (c.total + c.spreadDef) / 2
        let ownPA = M.shrink(c.games > 0 ? c.paTotal / g : nil, g, L.ppg, K.volumeShrinkK)
        let paMean = neutral ? ownPA : M.clamp(K.impliedWeight * impliedOpp + (1 - K.impliedWeight) * ownPA,
                                              K.pointsAllowedRange.lowerBound, K.pointsAllowedRange.upperBound)
        let ownYA = M.shrink(c.games > 0 ? c.yaTotal / g : nil, g, L.ypg, K.volumeShrinkK)
        let oppYA = M.shrink(c.oppGames > 0 ? c.oppYpg : nil, og, L.ypg, K.volumeShrinkK)
        let yaMean = neutral ? ownYA : 0.5 * ownYA + 0.5 * oppYA
        let paPts = tierEV(mean: paMean, sd: K.pointsAllowedSD, tiers: s.pointsAllowed)
        let yaPts = tierEV(mean: yaMean, sd: K.yardsAllowedSD, tiers: s.yardsAllowed)
        let parts: [(String, Double, Double)] = [
            ("Sacks", eSacks, eSacks * s.sack),
            ("Interceptions", eInt, eInt * s.interception),
            ("Fumbles", eFr, eFr * s.fumbleRecovery + eFr * 1.3 * s.forcedFumble),
            ("Touchdowns", eTd, eTd * s.touchdown),
            ("Safeties & blocks", eSaf + eBlk, eSaf * s.safety + eBlk * s.block),
            ("Points allowed", paMean, paPts),
            ("Yards allowed", yaMean, yaPts),
        ]
        let mean = parts.reduce(0) { $0 + $1.2 }
        var v = s.sack * s.sack * eSacks + s.interception * s.interception * eInt
            + s.fumbleRecovery * s.fumbleRecovery * eFr + s.touchdown * s.touchdown * eTd
        v += s.safety * s.safety * eSaf + s.block * s.block * eBlk
        let paSquares = s.pointsAllowed.map { DSTTier(upTo: $0.upTo, points: $0.points * $0.points) }
        v += max(0, tierEV(mean: paMean, sd: K.pointsAllowedSD, tiers: paSquares) - paPts * paPts)
        let yaSquares = s.yardsAllowed.map { DSTTier(upTo: $0.upTo, points: $0.points * $0.points) }
        v += max(0, tierEV(mean: yaMean, sd: K.yardsAllowedSD, tiers: yaSquares) - yaPts * yaPts)
        return Core(dropbacks: dropbacks, eSacks: eSacks, eInt: eInt, eFr: eFr, eTd: eTd, impliedOpp: impliedOpp,
                    paMean: paMean, yaMean: yaMean, paPts: paPts, yaPts: yaPts, dvp: m, qbAdj: qbAdj,
                    mean: mean, sd: v.squareRoot(),
                    breakdown: parts.map { StreamStatPoints(stat: $0.0, count: $0.1, points: $0.2) }.filter { $0.points != 0 })
    }

    public static func project(_ c: DSTCandidate, scoring s: DSTScoring, risk: StreamRiskMode = .neutral,
                               horizon: StreamHorizon = .week) -> DSTProjection {
        let x = core(c, s, neutral: false)
        let n = core(c, s, neutral: true)
        let pPlay = c.practice.playProbability
        let expPts = pPlay * x.mean
        let z = StreamMath.quartileZ
        let base = StreamRestOfSeason.summary(currentWeek: c.currentWeek, schedule: c.schedule, oppDvp: c.oppDvp,
                                              dvpGames: c.dvpGames, neutralMean: n.mean, cap: Knobs.rosCap)
        let remaining = c.schedule.filter { $0.key > c.currentWeek }.sorted { $0.key < $1.key }
            .map { c.oppPpgMap[$0.value] ?? League.ppg }
        let rosOppPpg = remaining.isEmpty ? League.ppg : remaining.reduce(0, +) / Double(remaining.count)
        // The remaining slate's scoring shifts the points-allowed term.
        let tierShift = tierEV(mean: 0.7 * rosOppPpg + 0.3 * n.paMean, sd: Knobs.pointsAllowedSD, tiers: s.pointsAllowed) - n.paPts
        var ros = base
        ros.perGame = base.perGame + tierShift
        ros.total = ros.perGame * Double(base.games)
        let utility = StreamRestOfSeason.blendedUtility(expPts: expPts, sd: x.sd, rosPerGame: ros.perGame,
                                                        pPlay: pPlay, risk: risk, horizon: horizon)
        var flags = c.dataFlags
        if c.games < 3 { flags.append("2-game sample — rates heavily shrunk") }
        if c.schedule.isEmpty { flags.append("no remaining schedule → ROS = neutral") }
        if s.isReferencePlaceholder { flags.append("scoring = Sleeper defaults (placeholder)") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let explain = [
            "\(f(x.dropbacks, 1)) opponent dropbacks → \(f(x.eSacks, 2)) sacks, \(f(x.eInt, 2)) INT; \(f(x.eFr, 2)) fumble recoveries",
            "Opponent implied \(f(x.impliedOpp, 1)) → points allowed ~\(f(x.paMean, 1)) → \(f(x.paPts, 1)) tier pts (expected value)",
            "Yards allowed ~\(f(x.yaMean, 0)) → \(f(x.yaPts, 1)) tier pts · matchup ×\(f(x.dvp, 3)) · QB adj ×\(f(x.qbAdj, 2))",
            "Rest of season \(f(ros.perGame, 1))/g over \(ros.games) games vs offenses scoring \(f(rosOppPpg, 1)) ppg"
                + (ros.byeWeek.map { " (bye W\($0))" } ?? ""),
        ]
        return DSTProjection(
            name: c.name, team: c.team, opponent: c.opp, playerID: c.playerID, expDropbacks: x.dropbacks,
            eSacks: x.eSacks, eInt: x.eInt, eFr: x.eFr, eTd: x.eTd, impliedOpp: x.impliedOpp, paMean: x.paMean,
            paPts: x.paPts, yaMean: x.yaMean, yaPts: x.yaPts, dvpMult: x.dvp, qbAdj: x.qbAdj,
            meanIfPlays: x.mean, sdIfPlays: x.sd, pPlay: pPlay, expPts: expPts,
            floorP25: max(0, pPlay * (x.mean - z * x.sd)), ceilingP75: pPlay * (x.mean + z * x.sd),
            utility: utility, neutralMean: n.mean, ros: ros, rosAvgOppPpg: rosOppPpg, practice: c.practice,
            rosterPct: c.rosterPct, available: c.available, flags: flags, notes: c.notes, sources: c.sources,
            explain: explain, breakdown: x.breakdown.sorted { $0.points > $1.points },
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    static func f(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }
}

public typealias DSTStreamReport = StreamReport<DSTProjection>
