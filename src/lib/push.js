// ============================================================================
// Notificaciones push (FCM) — activación desde el navegador
// ============================================================================
// Quién puede llamar a esto: el dueño o el staff asignado de un negocio,
// desde su propio dispositivo. Cada llamada registra SOLO ese dispositivo
// (un token distinto por navegador/celular); activar en el celular no activa
// en la notebook, y viceversa — cada uno se prende por separado, a propósito.
//
// Requiere VITE_FIREBASE_VAPID_KEY (clave pública, Firebase Console → Project
// Settings → Cloud Messaging → "Certificados push web" → generar par de
// claves). Sin ella, `getToken` no tiene con qué autenticar el registro y
// esto falla con un mensaje claro en vez de un error críptico del SDK.

import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingIfSupported } from './firebase';
import { savePushToken, removePushToken } from './repository';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

function swQueryParams() {
  return new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  }).toString();
}

/**
 * Registra el Service Worker. Se llama desde main.jsx al arrancar la app
 * (no recién cuando el usuario activa el push): un service worker activo
 * controlando la página es uno de los requisitos de instalabilidad de un
 * PWA, así que sin esto el navegador nunca ofrece "Instalar app" aunque el
 * usuario nunca haya tocado el botón de notificaciones.
 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  // Mismo SW ya registrado (por ejemplo, en una recarga) → se reusa en vez de
  // registrar dos veces.
  const existente = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
  if (existente) return existente;
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swQueryParams()}`).catch((err) => {
    console.error('[push] No se pudo registrar el service worker:', err);
    return null;
  });
}

/**
 * Pide permiso, registra el dispositivo y deja armado el listener de
 * mensajes en primer plano (pestaña abierta y activa).
 *
 * @param {{businessId: string, uid: string, role: string, professionalId?: string|null, onForegroundMessage?: (payload: any) => void}} args
 * @returns {Promise<{ok: true, token: string} | {ok: false, error: string}>}
 */
export async function enablePushNotifications({ businessId, uid, role, professionalId = null, onForegroundMessage }) {
  if (!VAPID_KEY) {
    return { ok: false, error: 'Falta configurar la clave VAPID de Firebase (VITE_FIREBASE_VAPID_KEY).' };
  }
  if (!('Notification' in window)) {
    return { ok: false, error: 'Este navegador no soporta notificaciones.' };
  }

  const messaging = await getMessagingIfSupported();
  if (!messaging) {
    return { ok: false, error: 'Este navegador no soporta notificaciones push.' };
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    return { ok: false, error: 'No diste el permiso de notificaciones.' };
  }

  const registration = await registerServiceWorker();
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration || undefined });
  if (!token) {
    return { ok: false, error: 'No se pudo generar el token de notificaciones.' };
  }

  await savePushToken(businessId, token, { uid, role, professionalId });

  // Con la pestaña abierta y enfocada, FCM entrega acá en vez de al Service
  // Worker (por eso showNotification() también lo maneja el que llama, no
  // este módulo: acá sería el mismo tab que generó el turno el que se
  // autonotifica en pantallas de más de un admin abierto).
  if (onForegroundMessage) {
    onMessage(messaging, onForegroundMessage);
  }

  return { ok: true, token };
}

/** Apaga las notificaciones en ESTE dispositivo (no en los demás). */
export async function disablePushNotifications({ businessId }) {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  const registration = await navigator.serviceWorker?.getRegistration('/firebase-messaging-sw.js');
  if (!registration) return;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration }).catch(() => null);
  if (token) await removePushToken(businessId, token);
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'Notification' in window;
}
