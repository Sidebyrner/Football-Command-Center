/**
 * The crosswalk between the team dialects the app touches — a port of FCCore
 * `NFLTeams`. The Odds API uses full names; Sleeper its own abbreviations;
 * every nflverse-derived file a third set that differs from Sleeper's on
 * exactly one live team.
 */
const abbreviationsByName: Record<string, string> = {
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

/** Built from the same table so the two directions can never drift apart. */
const namesByAbbreviation: Record<string, string> = Object.fromEntries(
  Object.entries(abbreviationsByName).map(([name, abbr]) => [abbr, name]),
)

/**
 * Sleeper (and Odds API) codes → the codes every nflverse file uses. The one
 * live disagreement is `LAR` vs `LA`; without it every Rams player reads as on
 * bye. The relocated codes let historical seasons join too.
 */
export const NFLVERSE_ALIASES: Readonly<Record<string, string>> = { LAR: 'LA', STL: 'LA', SD: 'LAC', OAK: 'LV' }

export function abbreviationForOddsName(name: string | null | undefined): string | undefined {
  return name ? abbreviationsByName[name] : undefined
}

/** Accepts either dialect (`LAR` or `LA`). */
export function teamName(abbreviation: string | null | undefined): string | undefined {
  if (!abbreviation) return undefined
  const direct = namesByAbbreviation[abbreviation]
  if (direct) return direct
  for (const [alias, canonical] of Object.entries(NFLVERSE_ALIASES)) {
    if (canonical === abbreviation && namesByAbbreviation[alias]) return namesByAbbreviation[alias]
  }
  return undefined
}

/** Sleeper team code → nflverse. Apply before any join between the two. */
export function nflverseTeam(abbreviation: string | null | undefined): string | undefined {
  if (!abbreviation) return undefined
  return NFLVERSE_ALIASES[abbreviation] ?? abbreviation
}
