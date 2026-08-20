// Service worker: reminder notifications plus a minimal offline shell.

const CACHE = 'school-notes-v1';
const OFFLINE_URL = '/offline';

// Only the offline fallback and icons are precached. Application pages are
// deliberately not precached: they are server-rendered per user, and a stale
// copy could show another session's state or long-gone assignments.
const PRECACHE = [OFFLINE_URL, '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // A failed precache must not block activation, or a single missing file
      // would leave the app with no service worker at all.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses: they carry live data and auth state.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Pages: always try the network so content is current, and fall back to the
  // offline page only when the network genuinely fails.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      }),
    );
    return;
  }

  // Build output is content-hashed, so serving it from cache is always safe.
  if (url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'School Notes', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'School Notes', {
      body: payload.body ?? '',
      // Reusing the tag collapses repeat reminders for the same assignment
      // instead of stacking them.
      tag: payload.tag,
      data: { url: payload.url ?? '/' },
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Focus an existing window if the app is already open.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }

      await self.clients.openWindow(target);
    })(),
  );
});
