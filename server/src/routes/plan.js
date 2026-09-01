// Draft plan write-through (B3).
//
// localStorage in the browser stays the source of truth by design — this is
// a best-effort copy, never the only place the plan lives. A failed write
// here costs nothing worse than a stale phone view; it must never be able to
// lose data the user only has here.

import { readPlan, writePlan } from '../lib/store.js'
import { renderPlanPage } from '../lib/planView.js'

// Optional capability-URL token for the human-facing /plan view — this route
// is meant to be opened from an arbitrary phone browser via a bookmark, so
// it is the one place in this server worth gating even though the API
// currently has no auth elsewhere (see the deploy plan's B3 security note:
// Tailscale settles auth for the LAN/tailnet, but this page holds draft
// strategy someone might not want visible to anything else on the network).
const VIEW_TOKEN = process.env.PLAN_AUTH_TOKEN || null

export default async function planRoutes(app) {
  if (!VIEW_TOKEN) {
    app.log.warn('PLAN_AUTH_TOKEN not set — /plan is readable by anything that can reach this server. Set it before relying on this for anything you would not want visible on the LAN.')
  }

  app.get('/api/plan', async () => readPlan())

  app.put('/api/plan', async (req, reply) => {
    const { targets } = req.body ?? {}
    if (!targets || typeof targets !== 'object') {
      return reply.code(400).send({ error: '"targets" object is required' })
    }
    const saved = await writePlan(targets)
    return { ok: true, updatedAt: saved.updatedAt }
  })

  app.get('/plan', async (req, reply) => {
    if (VIEW_TOKEN && req.query.token !== VIEW_TOKEN) {
      return reply.code(403).type('text/plain').send('Forbidden — open this with the ?token=... link, not a bare URL.')
    }
    const { targets, updatedAt } = readPlan()
    reply.type('text/html').send(renderPlanPage(targets, updatedAt))
  })
}
