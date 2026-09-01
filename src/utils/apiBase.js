// Optional self-hosted API proxy (see server/) for odds and news.
//
// When VITE_API_BASE_URL is unset, every caller behaves exactly as it did
// before B1/B2 existed — this file is inert. When it IS set, callers try the
// proxy first and fall back to their pre-existing direct-fetch path on any
// failure, so a container that is down or unreachable degrades the app
// rather than breaking it. See B2's gate in the deploy plan: stopping the
// container must never take the board down with it.

// Optional chaining on import.meta.env itself, not just the key — Vite always
// provides it, but a non-Vite context (a test runner, SSR) would otherwise
// throw reading a property off undefined rather than degrading to no proxy.
const RAW = import.meta.env?.VITE_API_BASE_URL ?? ''
export const API_BASE = RAW.trim().replace(/\/+$/, '')
export const hasApiProxy = API_BASE.length > 0
