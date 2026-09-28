/**
 * Beta signup and feedback go to Netlify Forms: no server of our own. Netlify
 * learns each form's fields from the hidden copies in index.html at deploy
 * time, then accepts url-encoded posts carrying the matching `form-name`.
 * Submissions show under the site's Forms tab in Netlify.
 */

export type BetaForm = 'beta-signup' | 'beta-feedback'

/** The same loose check the browser's `type="email"` makes: something@something.something. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
}

export function encodeForm(form: BetaForm, fields: Record<string, string>): string {
  return new URLSearchParams({ 'form-name': form, ...fields }).toString()
}

export async function submitBetaForm(form: BetaForm, fields: Record<string, string>): Promise<void> {
  const response = await fetch(import.meta.env.BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeForm(form, fields),
  })
  if (!response.ok) throw new Error(`Couldn’t send that (${response.status}). Try again in a moment.`)
}
