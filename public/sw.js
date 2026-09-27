/*
 * Offline support. Built assets are content-hashed, so they're cached for
 * good; pages come from the network with the last copy as the fallback; the
 * shipped data files are served from cache and refreshed behind. Sleeper and
 * the data branch are never cached here — the app's own IndexedDB cache owns
 * those, with their freshness labels.
 */
const VERSION = 'fcc-v1'
const SHELL = `${VERSION}-shell`
const DATA = `${VERSION}-data`
const scope = new URL(self.registration.scope)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll([scope.href, `${scope.href}manifest.webmanifest`])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  const path = url.pathname.slice(scope.pathname.length)

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL).then((c) => c.put(scope.href, copy))
          return response
        })
        .catch(() => caches.match(scope.href)),
    )
    return
  }
  if (path.startsWith('assets/') || path.startsWith('icons/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(SHELL).then((c) => c.put(request, copy)) }
      return response
    })))
    return
  }
  if (path.startsWith('data/') || path.startsWith('demo/')) {
    event.respondWith(caches.open(DATA).then(async (cache) => {
      const hit = await cache.match(request)
      const fresh = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response }).catch(() => hit)
      return hit ?? fresh
    }))
  }
})
