// Shared-secret check for relay routes that act on a user's league or call the
// local model. The relay runs on a homelab reachable from a phone over the
// tailnet; without this, anyone who learned the address could spend the GPU or
// read and write another person's plan.
//
// Deliberately simple: one token in RELAY_TOKEN, sent as `Authorization: Bearer`.
// When RELAY_TOKEN is unset these routes are disabled (503), never open.

import { timingSafeEqual } from 'crypto'

export function tokenMatches(expected, header) {
  if (!expected) return false
  const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  // timingSafeEqual needs equal lengths; a length mismatch is simply a miss.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Fastify preHandler. `expected` defaults to RELAY_TOKEN, injectable for tests.
 * @returns {(req, reply) => Promise<void>}
 */
export function requireRelayToken(expected = process.env.RELAY_TOKEN) {
  return async function relayAuth(req, reply) {
    if (!expected) {
      return reply.code(503).send({ error: 'RELAY_TOKEN is not set on this server, so this route is disabled.' })
    }
    if (!tokenMatches(expected, req.headers?.authorization)) {
      return reply.code(401).send({ error: 'Missing or wrong relay token.' })
    }
  }
}
