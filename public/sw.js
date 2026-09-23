// Service worker de Web Push (VAPID) — reemplaza a firebase-messaging-sw.js.
//
// Vive en la raíz a propósito: el scope de un service worker es su propia
// carpeta para abajo, y necesitamos que cubra toda la app (incluida
// /admin/citas, donde termina llevando al usuario un notificationclick).
//
// A diferencia del SW de Firebase Messaging, este no necesita config del
// proyecto (ni API key ni query params al registrarse): Web Push estándar
// no tiene "backend" propio como FCM, el servidor le manda el payload
// directo al navegador contra el endpoint que devolvió PushManager.subscribe().
/* eslint-disable no-undef */

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { title: 'Nuevo turno', body: event.data ? event.data.text() : '' };
  }

  const { title = 'Slotly', body = '', url = '/admin/citas' } = datos;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    })
  );
});

// Tocar la notificación enfoca una pestaña ya abierta en esa página en vez
// de amontonar pestañas nuevas cada vez.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin/citas';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// Un fetch handler (aunque no haga nada) es parte de los criterios de
// instalabilidad de un PWA en varios navegadores.
self.addEventListener('fetch', () => {});
