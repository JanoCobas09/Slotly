// Service worker de Firebase Cloud Messaging.
//
// Vive en la raíz a propósito: el scope de un service worker es su propia
// carpeta para abajo, y necesitamos que cubra toda la app (incluida
// /admin/citas, donde termina llevando al usuario un notificationclick).
//
// No lo procesa Vite (es un archivo estático de /public), así que no puede
// leer las VITE_* del build. En vez de hardcodear la config de Firebase acá
// (que además cambiaría por entorno: producción vs. emulador local), la
// recibe por query string al registrarse — ver src/lib/push.js. Son las
// mismas claves públicas que ya viajan en el bundle del cliente; no hay nada
// nuevo que proteger.
/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

const params = new URL(location.href).searchParams;

firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

// Se dispara cuando llega un push y la app NO está en primer plano. Con la
// pestaña abierta y activa, el mensaje llega por onMessage() en el cliente
// (src/lib/push.js) en vez de por acá — así nunca se duplica el aviso.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Nuevo turno', {
    body: body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || {},
  });
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
