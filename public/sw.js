// public/sw.js — Quorum Service Worker
// ─────────────────────────────────────────────────────────────────────────────
// Handles: push notifications + notification click navigation.
// No caching logic — Quorum is a dynamic auth-gated app, not an offline shell.
// Caching would break auth redirects and stale dynamic content.
// ─────────────────────────────────────────────────────────────────────────────

// ── Push: show notification when server sends a push ─────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Quorum', body: event.data.text(), url: '/' };
  }

  const {
    title = 'Quorum',
    body  = '',
    url   = '/',
  } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:               '/icon-192.png',
      badge:              '/icon-192.png',
      data:               { url },
      tag:                'quorum-nudge',  // collapses: new nudge replaces old one
      renotify:           false,
      requireInteraction: false,
    })
  );
});


// ── Notification click: open or focus the app ─────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If Quorum is already open in a tab, navigate it and focus
        for (const client of windowClients) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});


// ── Activate: claim all clients immediately ───────────────────────────────────
// Ensures updated SW takes effect without the user closing all tabs first.
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
