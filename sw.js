// Minimal service worker — enables background notifications and PWA install
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Tap a notification → focus or open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('tavern-league-worldcup') && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow('/tavern-league-worldcup/');
    })
  );
});
