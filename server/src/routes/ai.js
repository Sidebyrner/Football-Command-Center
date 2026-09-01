// Local-LLM summarization, relayed through LM Studio (see lib/lmstudio.js).
//
// The client sends the real data directly — articles it already fetched and
// player-tagged (src/utils/researchAdapters.js), or scores/ADP it already
// computed (src/utils/evaluationEngine.js) — this route only builds a
// grounded prompt from what it's handed and asks the model to narrate it.
// There is no server-side copy of research items or scores to look up:
// unlike the draft plan (server/src/routes/plan.js), those never leave the
// client's own localStorage, so "look up the user's data" isn't a thing
// this route can do — the client has to send it.

import { chatComplete, isConfigured } from '../lib/lmstudio.js'
import { buildNewsSummaryPrompt, buildStrategyBriefPrompt } from '../lib/prompts.js'

export default async function aiRoutes(app) {
  app.post('/api/ai/news-summary', async (req, reply) => {
    if (!isConfigured) {
      return reply.code(503).send({ error: 'LM Studio not configured on this server.' })
    }
    const { articles } = req.body ?? {}
    if (!Array.isArray(articles) || articles.length === 0) {
      return reply.code(400).send({ error: 'Body must include a non-empty "articles" array.' })
    }
    try {
      const summary = await chatComplete(buildNewsSummaryPrompt(articles))
      return { summary }
    } catch (err) {
      return reply.code(502).send({ error: err.message })
    }
  })

  app.post('/api/ai/strategy-brief', async (req, reply) => {
    if (!isConfigured) {
      return reply.code(503).send({ error: 'LM Studio not configured on this server.' })
    }
    const { players } = req.body ?? {}
    if (!Array.isArray(players) || players.length === 0) {
      return reply.code(400).send({ error: 'Body must include a non-empty "players" array.' })
    }
    try {
      const brief = await chatComplete(buildStrategyBriefPrompt(players))
      return { brief }
    } catch (err) {
      return reply.code(502).send({ error: err.message })
    }
  })
}
