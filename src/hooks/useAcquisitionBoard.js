// Players worth acquiring, ranked by what they have actually produced in this
// league's scoring — not by a forecast.
//
// "Sleeper" here means the market hasn't priced what already happened, or the
// usage is running ahead of the points. Both are reported facts. This app has
// twice built and reverted a blended projection and isn't building a third.
//
// Coverage: the weekly file is QB/RB/WR/TE/K only. DEF and IDP have no
// production rows at all, so they can appear here on trending alone and are
// labelled as such rather than ranked against players the data does cover.

import { useState, useEffect, useMemo } from 'react'
import { loadWeeklySeason, decodeRow } from '../services/weeklyStatsService'
import { loadMarketData } from '../services/marketService'
import { scoreWeeks, distribution } from '../utils/weeklyScoring'
import { toNflverseTeam } from '../utils/nflTeams'
import { isMyTeam } from '../utils/leagueTeams'
import useScoringProfileStore from '../store/useScoringProfileStore'
import { FORM_WEEKS, seasonPaceBaselines, signalsFor } from '../utils/acquisitionSignals'

function mean(xs) {
  const v = xs.filter((x) => typeof x === 'number')
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export function useAcquisitionBoard({ statsSeason, rosters, sleeperUserId, slotTemplate }) {
  const profile = useScoringProfileStore((s) => s.activeProfile)
  const [file, setFile] = useState(null)
  const [ids, setIds] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!statsSeason) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    Promise.all([loadWeeklySeason(statsSeason), loadMarketData()])
      .then(([f, market]) => {
        if (cancelled) return
        setFile(f)
        setIds(market?.idsBySleeper ?? {})
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [statsSeason])

  // Who owns whom. Status decides the ACTION — a free agent is a claim, a
  // player on someone's bench is a trade — so it isn't cosmetic.
  const ownership = useMemo(() => {
    const byPlayer = {}
    for (const t of rosters ?? []) {
      const starters = new Set((t.starterIds ?? []).filter((id) => id && id !== '0'))
      for (const id of t.playerIds ?? []) {
        if (!id || id === '0') continue
        byPlayer[id] = {
          ownerId: t.id,
          ownerName: t.name,
          isMine: isMyTeam(t, sleeperUserId),
          isStarter: starters.has(id),
        }
      }
    }
    return byPlayer
  }, [rosters, sleeperUserId])

  const players = useMemo(() => {
    if (!file?.players || !ids) return []

    // The crosswalk ships sleeper -> gsis; this scan runs the other way.
    const sleeperByGsis = {}
    for (const [sleeperId, rec] of Object.entries(ids)) {
      if (rec?.gsisId) sleeperByGsis[rec.gsisId] = sleeperId
    }

    const out = []
    for (const [gsisId, tuples] of Object.entries(file.players)) {
      const metaRec = file.meta?.[gsisId]
      const position = metaRec?.p
      if (!position) continue

      const rows = tuples.map((t) => decodeRow(file.fields, t)).sort((a, b) => a.week - b.week)
      if (!rows.length) continue

      const season = scoreWeeks(rows, profile, position)
      if (!season.games) continue
      const form = scoreWeeks(rows.slice(-FORM_WEEKS), profile, position)
      const dist = distribution(season.weeks)

      const sleeperId = sleeperByGsis[gsisId] ?? null
      const own = sleeperId ? ownership[sleeperId] : null
      const team = rows[rows.length - 1]?.team ?? null

      out.push({
        gsisId,
        id: sleeperId,
        name: metaRec?.n ?? gsisId,
        position,
        team,
        nflverseTeam: team ? toNflverseTeam(team) : null,
        perGame: season.perGame,
        games: season.games,
        formPerGame: form.perGame,
        floor: dist.floor,
        ceiling: dist.ceiling,
        // Opportunity, straight off the rows. The leading indicator that
        // doesn't require predicting anything: usage already happened.
        tgtShare: mean(rows.map((r) => r.tgt_share)),
        recentTgtShare: mean(rows.slice(-FORM_WEEKS).map((r) => r.tgt_share)),
        ayShare: mean(rows.map((r) => r.ay_share)),
        status: !sleeperId || !own ? 'free' : own.isMine ? 'mine' : own.isStarter ? 'rival-starter' : 'rival-bench',
        owner: own?.ownerName ?? null,
      })
    }
    return out
  }, [file, ids, profile, ownership])

  // Where the startable and replacement lines actually sit, on a SEASON
  // per-game basis.
  //
  // weeklyAggregates' positionBaselines is deliberately not used here. It
  // averages each week's Nth-best single-week score, which is the right
  // comparison for MatchupPlanner (one week against that same week's line) but
  // the wrong one for this page. A different player occupies the Nth rank every
  // week, so the average of weekly Nth-bests sits well above the season pace of
  // the actual Nth-best player — measured on this file, ~29.8 for QB against a
  // real QB8 season average near 22. Comparing a season average to that inflated
  // number made "startable" almost unclearable. These lines are built from the
  // same season averages the rows are ranked on, so both sides match.
  const baselines = useMemo(
    () => seasonPaceBaselines(players, slotTemplate, rosters?.length ?? 0),
    [players, slotTemplate, rosters]
  )

  return { players, baselines, loading, error, profileName: profile?.name ?? null }
}

export { FORM_WEEKS, signalsFor }
