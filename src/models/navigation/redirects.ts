import { pathFor } from './screens'

/**
 * Addresses that open somewhere else. The original web app's screens now live
 * in the new app and its tools under /tools, so old bookmarks still land; and
 * the short paths people type or share (/waivers, /injuries) go to the screen
 * they name.
 */
export const REDIRECTS: Readonly<Record<string, string>> = {
  '/classic': '/team',
  '/dashboard': '/team',
  '/matchup': pathFor('matchup'),
  '/sit-start': pathFor('sitStart'),
  '/trade': pathFor('trades'),
  '/planning': pathFor('planning'),
  '/classic/settings': '/settings',
  '/draft': '/tools/draft',
  '/plan': '/tools/draft-plan',
  '/research': '/tools/research',
  '/power-rankings': '/tools/power-rankings',
  '/odds': '/tools/odds',
  // Short paths.
  '/waivers': pathFor('waivers'),
  '/injuries': pathFor('injuries'),
  '/decide': pathFor('decide'),
  '/trades': pathFor('trades'),
  '/discover': pathFor('discovery'),
}
