// Validation for POST /api/ai/trade-pitch, kept pure so it can be tested
// without starting Fastify.

export const LIMITS = { facts: 20, factLength: 300, draftLength: 1000 }

/**
 * @returns {{ ok: true, facts: string[], draft: string } | { ok: false, error: string }}
 */
export function validateTradePitchBody(body) {
  const facts = body?.facts
  const draft = body?.draft
  if (!Array.isArray(facts) || facts.length === 0) {
    return { ok: false, error: 'Body must include a non-empty "facts" array.' }
  }
  if (facts.length > LIMITS.facts || facts.some((f) => typeof f !== 'string' || f.length > LIMITS.factLength)) {
    return { ok: false, error: `"facts" must be up to ${LIMITS.facts} strings of ${LIMITS.factLength} characters or fewer.` }
  }
  if (typeof draft !== 'string' || draft.trim() === '' || draft.length > LIMITS.draftLength) {
    return { ok: false, error: `"draft" must be a non-empty string of ${LIMITS.draftLength} characters or fewer.` }
  }
  return { ok: true, facts: facts.map((f) => f.trim()).filter(Boolean), draft: draft.trim() }
}
