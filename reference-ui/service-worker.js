// A deliberately simple "app shell" service worker: cache the core files
// on install, serve from cache first (fast, works offline), fall back to
// network for anything not cached. This is NOT a general-purpose offline
// data sync — the app's actual roster data still lives in browser memory
// (see the main file's own JS), so offline mode means "the app opens and
// shows whatever was already loaded," not "you can edit rosters with zero
// internet and it syncs later." That would be a much bigger feature.

const CACHE_NAME = "rosterpro-shell-v1";

// Must succeed for the app to be usable at all — if any of these fail,
// install SHOULD fail (cache.addAll is atomic: all-or-nothing on purpose
// for this list).
const CORE_SHELL_FILES = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

// Nice-to-have — used for Excel/PDF export. Cached individually, each
// wrapped in its own try/catch, so a single CDN hiccup (rate limit,
// temporary outage, a network blip) can NEVER block the service worker
// from installing and the rest of the app from working. This is exactly
// the bug an early version of this file had: using one atomic addAll for
// everything meant a single failed third-party fetch silently prevented
// the service worker from ever activating at all.
const OPTIONAL_CDN_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_SHELL_FILES);
      await Promise.all(
        OPTIONAL_CDN_FILES.map((url) =>
          cache.add(url).catch((err) => console.warn(`Optional cache miss (non-fatal): ${url}`, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return; // never cache POST/PATCH etc.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache a copy of anything new we successfully fetch (same-origin
        // or the CDN libraries above), so the app gets more resilient the
        // more it's used, without needing every possible file listed up front.
        if (response.ok && (event.request.url.startsWith(self.location.origin) || event.request.url.includes("cdnjs.cloudflare.com"))) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached); // offline and not cached: fail gracefully
    })
  );
});
