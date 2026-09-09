// The Odds API returns full team names ("Buffalo Bills"); every other data
// source in this app (Sleeper players, rosters) keys on Sleeper's team
// abbreviation ("BUF"). This is the crosswalk between the two — static
// reference data, not something that needs fetching or refreshing.

const TEAM_ABBR_BY_NAME = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
}

export function abbrFromOddsTeamName(name) {
  return TEAM_ABBR_BY_NAME[name] ?? null
}

// Reverse of abbrFromOddsTeamName. Built from the same table so the two can
// never drift apart.
const TEAM_NAME_BY_ABBR = Object.fromEntries(
  Object.entries(TEAM_ABBR_BY_NAME).map(([name, abbr]) => [abbr, name])
)

export function teamNameFromAbbr(abbr) {
  if (!abbr) return null
  // Accepts either dialect. The name table is keyed on The Odds API's codes
  // (LAR), but callers routinely hold an nflverse code (LA), so fall back
  // through the alias map rather than returning null and rendering a bare
  // abbreviation where a team name belongs.
  if (TEAM_NAME_BY_ABBR[abbr]) return TEAM_NAME_BY_ABBR[abbr]
  for (const [alias, canonical] of Object.entries(NFLVERSE_ALIASES)) {
    if (canonical === abbr && TEAM_NAME_BY_ABBR[alias]) return TEAM_NAME_BY_ABBR[alias]
  }
  return null
}

/**
 * Sleeper (and The Odds API) team codes -> the codes used by every
 * nflverse-derived file in public/data.
 *
 * There is exactly one live disagreement — Sleeper says LAR for the Rams,
 * nflverse says LA — verified by diffing the two code sets. It is one team, but
 * without this every Rams player silently falls through to "bye, no game" and
 * gets no defense-vs-position matchup, which looks like missing data rather
 * than a join bug. The relocated-franchise codes are here so historical seasons
 * join too.
 */
const NFLVERSE_ALIASES = {
  LAR: 'LA',
  STL: 'LA',
  SD: 'LAC',
  OAK: 'LV',
}

export function toNflverseTeam(abbr) {
  if (!abbr) return null
  return NFLVERSE_ALIASES[abbr] ?? abbr
}
