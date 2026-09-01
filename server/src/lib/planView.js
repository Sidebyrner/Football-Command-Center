// Renders the read-only phone view of the draft plan — plain server-rendered
// HTML, no build step, no client framework. This is the page you actually
// open on your phone during the draft: a bookmark, not an app.

function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

function renderTarget(t, i) {
  const meta = [
    t.playerTeam ?? '',
    t.adp != null ? `ADP ${Math.round(t.adp)}` : '',
    t.bye != null ? `Bye ${t.bye}` : '',
  ].filter(Boolean).join(' · ')

  return `<li>
    <div class="row">
      <span class="rank">${i + 1}</span>
      <span class="name">${esc(t.playerName)}</span>
      <span class="meta">${esc(meta)}</span>
    </div>
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
    ${t.fallbacks?.length ? `<div class="fallbacks">&#8627; ${t.fallbacks.map((f) => esc(f.playerName)).join(', ')}</div>` : ''}
  </li>`
}

export function renderPlanPage(targets, updatedAt) {
  const hasAny = targets && POSITIONS.some((p) => (targets[p] ?? []).length > 0)

  const body = !hasAny
    ? `<p class="empty">No plan synced yet. Open the app and add a target — it appears here automatically.</p>`
    : POSITIONS.map((pos) => {
        const list = targets[pos] ?? []
        if (!list.length) return ''
        return `<section><h2>${pos}</h2><ul>${list.map(renderTarget).join('')}</ul></section>`
      }).join('')

  return `<!doctype html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Draft Plan</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:16px; background:#0a0f1e; color:#f8fafc; font-family:-apple-system,system-ui,sans-serif; -webkit-text-size-adjust:100%; }
  h1 { font-size:18px; margin:0 0 4px; }
  .updated { color:#475569; font-size:12px; margin-bottom:16px; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#94a3b8; border-bottom:1px solid rgba(248,250,252,.08); padding-bottom:4px; margin:20px 0 8px; }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:8px 0; border-bottom:1px solid rgba(248,250,252,.06); }
  .row { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
  .rank { color:#475569; font-size:11px; font-weight:700; width:16px; flex-shrink:0; }
  .name { font-weight:600; }
  .meta { color:#94a3b8; font-size:12px; margin-left:auto; }
  .note { color:#94a3b8; font-size:12px; margin:4px 0 0 24px; }
  .fallbacks { color:#f59e0b; font-size:11px; margin:2px 0 0 24px; }
  .empty { color:#94a3b8; }
</style>
</head><body>
  <h1>Draft Plan</h1>
  <div class="updated">${updatedAt ? 'Synced ' + esc(new Date(updatedAt).toLocaleString()) : 'Never synced'}</div>
  ${body}
</body></html>`
}
