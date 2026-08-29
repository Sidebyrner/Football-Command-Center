// Minimal RSS 2.0 / Atom parser — no XML library dependency, per the B1 scope
// decision to keep server/package.json dependency-free beyond Fastify.
//
// Deliberately tolerant rather than spec-complete: sports news feeds are not
// adversarial input, and a missed edge case here degrades to "item skipped,"
// not a crash. If a real feed exceeds what this handles, that is the signal
// to add a proper XML parser — not to harden this by hand.
//
// Output is intentionally NOT shaped as a ResearchItem. That mapping
// (source: 'rss', sourceId, tags, isSaved, …) is a client concern — it lives
// in src/utils/researchStore.js's createItem(), applied when B2 wires
// fetchRSSFeed() to call this server. The server stays a dumb, stateless relay.

function decodeEntities(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, '') // strip any residual inline HTML tags
    .trim()
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? decodeEntities(m[1]) : null
}

function extractAtomLink(block) {
  const m = block.match(/<link[^>]*\shref="([^"]+)"/i)
  return m ? m[1] : extractTag(block, 'link')
}

function extractBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const blocks = []
  let m
  while ((m = re.exec(xml)) !== null) blocks.push(m[0])
  return blocks
}

/**
 * Parse RSS 2.0 or Atom XML into a flat list of normalized items.
 * @param {string} xml
 * @returns {{ title: string, body: string|null, url: string|null, publishedAt: string|null, sourceId: string|null }[]}
 */
export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml)
  const blocks = extractBlocks(xml, isAtom ? 'entry' : 'item')

  return blocks.map((block) => {
    const title = extractTag(block, 'title') ?? '(untitled)'
    const url = isAtom ? extractAtomLink(block) : extractTag(block, 'link')
    const body = isAtom
      ? (extractTag(block, 'summary') ?? extractTag(block, 'content'))
      : (extractTag(block, 'description') ?? extractTag(block, 'content:encoded'))
    const publishedAtRaw = isAtom
      ? (extractTag(block, 'updated') ?? extractTag(block, 'published'))
      : extractTag(block, 'pubDate')
    const sourceId = extractTag(block, isAtom ? 'id' : 'guid') ?? url

    let publishedAt = null
    if (publishedAtRaw) {
      const d = new Date(publishedAtRaw)
      if (!isNaN(d.getTime())) publishedAt = d.toISOString()
    }

    return { title, body, url, publishedAt, sourceId }
  })
}
