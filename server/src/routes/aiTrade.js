// POST /api/ai/trade-pitch — polish a trade message on the local model.
// Token-protected: it spends the homelab GPU.

import { chatComplete, isConfigured } from '../lib/lmstudio.js'
import { buildTradePitchPrompt } from '../lib/prompts.js'
import { requireRelayToken } from '../lib/relayAuth.js'
import { validateTradePitchBody } from '../lib/tradePitch.js'

export default async function aiTradeRoutes(app) {
  app.post('/api/ai/trade-pitch', { preHandler: requireRelayToken() }, async (req, reply) => {
    if (!isConfigured) {
      return reply.code(503).send({ error: 'LM Studio not configured on this server.' })
    }
    const parsed = validateTradePitchBody(req.body)
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error })
    try {
      const pitch = await chatComplete(buildTradePitchPrompt(parsed.facts, parsed.draft))
      return { pitch }
    } catch (err) {
      return reply.code(502).send({ error: err.message })
    }
  })
}
