/**
 * What the web app collects and where it goes — a static page at /privacy,
 * outside the app shell so it opens without a league or any data loading.
 * Keep it in step with the code: betaForms.ts, netlify/functions/espn.mjs,
 * the storage in secretStore.ts / AppSettings.ts / cache.ts, and index.html.
 */
import { Link } from 'react-router-dom'
import { useTheme } from '@ui/theme'
import './privacy.css'

export function PrivacyPage() {
  const { resolved } = useTheme()
  return (
    <div className="fcc privacy" data-theme={resolved}>
      <main className="privacy-body">
        <p className="t-meta"><Link to="/">← Back to the app</Link></p>
        <h1 className="t-display">Privacy</h1>
        <p className="t-body muted">Football Command Center has no accounts and no analytics. This page lists everything it sends anywhere, and everything it keeps.</p>

        <h2 className="t-section">Kept in your browser</h2>
        <ul className="t-body">
          <li>Your settings — platform, Sleeper username, league and team, accent color, Board layout, workspaces and stream edits — in this browser’s <b>localStorage</b>.</li>
          <li>Tokens and keys you paste in (ESPN cookies, a relay token, an Odds API key) in <b>localStorage</b> too. They are left out of exported setup files.</li>
          <li>A cache of league and player data in <b>IndexedDB</b>, so screens open fast and work offline.</li>
        </ul>
        <p className="t-body muted">Apart from the ESPN cookies (below), none of this is sent to the site. Clearing this site’s data in your browser removes all of it.</p>

        <h2 className="t-section">Forms you choose to send</h2>
        <p className="t-body">Both forms in Settings are handled by <a href="https://docs.netlify.com/forms/setup/" target="_blank" rel="noreferrer">Netlify Forms</a>, the site’s host, and read only by the developer.</p>
        <ul className="t-body">
          <li><b>Beta signup:</b> your email, your name if you give it, and which devices you picked — used only to send a TestFlight invite.</li>
          <li><b>Feedback:</b> your message, your email if you give it, and context to help reproduce problems: your browser’s user agent, your window size, and whether you were in the demo league.</li>
        </ul>

        <h2 className="t-section">ESPN</h2>
        <p className="t-body">For an ESPN league, the two cookies you paste (espn_s2 and SWID) are sent with each request to this site’s ESPN proxy, a Netlify function that forwards them to ESPN’s fantasy API and returns the reply. It stores nothing and logs nothing — the cookies are never saved on the server.</p>

        <h2 className="t-section">Other services the app talks to</h2>
        <ul className="t-body">
          <li><b>Sleeper</b>’s public API (api.sleeper.app) for leagues, rosters, projections and scores, and its image CDN for headshots and team logos. No sign-in; Sleeper sees your username only if you type one.</li>
          <li><b>Public nflverse data</b> (injuries, depth charts, snap counts), prepared ahead of time and served from GitHub.</li>
          <li><b>Google Fonts</b>, for the app’s typefaces. Google receives your IP address when the fonts load.</li>
          <li>Only if you set them up: <b>The Odds API</b> with your own key, and a <b>relay server</b> you run yourself.</li>
        </ul>

        <h2 className="t-section">Questions</h2>
        <p className="t-body">Use the feedback form in <Link to="/settings#beta">Settings</Link> — leave an email if you’d like a reply.</p>
      </main>
    </div>
  )
}
