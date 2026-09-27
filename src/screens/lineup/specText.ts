/** renderToString escapes apostrophes, quotes and ampersands, and splits text with comments. */
export const text = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/<!-- -->/g, '')
