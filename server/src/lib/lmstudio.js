// Thin client for LM Studio's local inference server, which implements the
// OpenAI chat-completions request/response shape. Runs on a separate box on
// the tailnet (not this container) — reachability is the caller's problem to
// surface, not this module's to hide.
//
// Local inference on consumer hardware is meaningfully slower than a REST
// lookup, so this gets a much longer timeout than the Sleeper client
// (src/utils/sleeperApi.js's 8s would kill a real summarization request
// before it finished).

const BASE_URL = process.env.LMSTUDIO_BASE_URL
const MODEL = process.env.LMSTUDIO_MODEL
const TIMEOUT_MS = Number(process.env.LMSTUDIO_TIMEOUT_MS) || 60_000

export const isConfigured = Boolean(BASE_URL && MODEL)

/**
 * @param {{ role: 'system'|'user', content: string }[]} messages
 * @returns {Promise<string>} the assistant's reply text
 * @throws {Error} if not configured, unreachable, or the server errors
 */
export async function chatComplete(messages) {
  if (!isConfigured) {
    throw new Error('LM Studio not configured — set LMSTUDIO_BASE_URL and LMSTUDIO_MODEL.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res
  try {
    res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.2 }),
      signal: controller.signal,
    })
  } catch (err) {
    throw new Error(`Could not reach LM Studio at ${BASE_URL}: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`LM Studio returned ${res.status}`)
  }

  const body = await res.json()
  const text = body?.choices?.[0]?.message?.content
  if (!text) throw new Error('LM Studio returned no completion text.')
  return text
}
