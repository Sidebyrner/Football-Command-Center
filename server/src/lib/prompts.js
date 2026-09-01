// Grounded prompt builders — pure functions, no network calls, easy to test
// in isolation.
//
// Every prompt here follows one rule: the model only ever summarizes or
// synthesizes data included in the prompt. Nothing here asks it to recall
// football facts from its own training — every claim in a response should
// be traceable back to something listed below it. This app has treated
// fabricated data as a bug everywhere else (the original synthetic
// evaluation engine got replaced for exactly this reason); an ungrounded
// local model inventing stats or injury claims would be the same failure
// wearing an LLM costume.

const GROUNDING_RULE =
  'Only use the information provided below. Do not add outside facts, ' +
  'statistics, player news, or claims that are not explicitly present in ' +
  'the data given to you. If the data does not support a statement, do not ' +
  'make it. Write in plain, direct prose — no headers, no bullet spam.'

/**
 * @param {{ playerName: string|null, title: string, body: string|null, source?: string }[]} articles
 *   Already pre-filtered to articles that mention a specific tracked player
 *   — see matchRelevantPlayer in src/utils/researchAdapters.js.
 * @returns {{ role: string, content: string }[]}
 */
export function buildNewsSummaryPrompt(articles) {
  const listed = articles
    .map((a, i) => (
      `${i + 1}. [${a.playerName ?? 'Unknown player'}] ${a.title}` +
      (a.source ? ` (${a.source})` : '') +
      (a.body ? `\n   ${a.body}` : '')
    ))
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        'You are summarizing recent NFL news for a fantasy football owner, ' +
        'covering only the players they are watching or have targeted in ' +
        'their draft plan. ' + GROUNDING_RULE,
    },
    {
      role: 'user',
      content:
        `Here are ${articles.length} recent article(s) about players this ` +
        `owner is tracking:\n\n${listed}\n\n` +
        'Summarize what is actually new or notable here, organized by ' +
        'player. If two articles say the same thing, do not repeat it ' +
        'twice. If nothing here is actually actionable, say so plainly.',
    },
  ]
}

/**
 * @param {{ name: string, position: string, score: number, tierLabel: string,
 *   adp: number|null, valueDelta: number|null, drafted: boolean }[]} players
 *   The client's own already-computed scores/ADP/value-deltas — this module
 *   never recomputes evaluations, it only narrates numbers the client sends.
 * @returns {{ role: string, content: string }[]}
 */
export function buildStrategyBriefPrompt(players) {
  const byPosition = {}
  for (const p of players) (byPosition[p.position] ??= []).push(p)

  const sections = Object.entries(byPosition)
    .map(([pos, list]) => {
      const rows = list
        .map((p) => {
          const bits = [`score ${p.score}`, p.tierLabel]
          if (p.adp != null) bits.push(`ADP ${p.adp}`)
          if (p.valueDelta != null) bits.push(`value delta ${p.valueDelta > 0 ? '+' : ''}${p.valueDelta}`)
          if (p.drafted) bits.push('DRAFTED')
          return `- ${p.name}: ${bits.join(', ')}`
        })
        .join('\n')
      return `${pos}:\n${rows}`
    })
    .join('\n\n')

  return [
    {
      role: 'system',
      content:
        'You are helping a fantasy football owner understand what their ' +
        "own evaluation model's numbers already say about their draft " +
        'situation. The score, tier, ADP, and value-delta figures below ' +
        'come from a real statistical model already computed for this ' +
        'owner — treat them as ground truth. Value delta is the ' +
        "player's positional ADP rank minus their positional score rank; " +
        "positive means this owner's league values them more than the " +
        'market does. ' + GROUNDING_RULE,
    },
    {
      role: 'user',
      content:
        `Here is the current board, grouped by position:\n\n${sections}\n\n` +
        'Write a short, readable strategy brief explaining what these ' +
        'numbers suggest — where there is depth, where there is a gap, ' +
        'and which players stand out for value (not just top score). Do ' +
        'not invent needs or roster requirements not implied by this data.',
    },
  ]
}
