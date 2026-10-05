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

  const { title = 'Slotly', body = '', url = '/admin/citas', icon = null } = datos;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // La imagen grande (a la derecha en Android): la foto del negocio si
      // cargó una; si no, el ícono de Slotly.
      icon: icon || '/icons/icon-192.png',
      // El circulito chico: Android lo pinta de un color usando solo la
      // transparencia, por eso es el glifo blanco sobre fondo transparente
      // (con el ícono común salía un cuadrado blanco lleno).
      badge: '/icons/badge-96.png',
      // Que suene y vibre siempre (el sonido lo pone el sistema: no hay
      // forma estándar de elegir uno propio). Sin `tag`, cada aviso es una
      // notificación nueva y vuelve a sonar, en vez de pisar la anterior.
      silent: false,
      vibrate: [200, 100, 200],
      // En la compu no desaparece sola a los segundos: queda hasta que el
      // dueño la ve. En Android no cambia nada (ahí siempre queda).
      requireInteraction: true,
      timestamp: Date.now(),
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
