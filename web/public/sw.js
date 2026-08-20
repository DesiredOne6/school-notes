// Service worker for reminder notifications.

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

      // Focus an existing tab if the app is already open.
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
