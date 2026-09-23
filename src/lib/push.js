// ============================================================================
// Notificaciones push — Web Push estándar (VAPID)
// ============================================================================
// Reemplaza a Firebase Cloud Messaging. Quién puede llamar a esto: el dueño
// o el staff asignado de un negocio, desde su propio dispositivo. Cada
// llamada registra SOLO ese dispositivo (una suscripción por navegador/
// celular, identificada por su endpoint); activar en el celular no activa
// en la notebook, y viceversa — cada uno se prende por separado, a propósito.
//
// Requiere VITE_VAPID_PUBLIC_KEY (par generado con
// `npx web-push generate-vapid-keys` — ver supabase/functions/.env para la
// privada, que solo usa el servidor). Sin ella, PushManager.subscribe() no
// tiene con qué autenticar el registro y esto falla con un mensaje claro en
// vez de un error críptico del navegador.
//
// Diferencia de fondo con FCM: acá no hay "mensaje en primer plano" — un
// push de Web Push siempre llega al Service Worker (evento `push`) y
// muestra una notificación del sistema, tenga la pestaña foco o no. Por eso
// `enablePushNotifications` sigue aceptando `onForegroundMessage` (nadie lo
// pasa hoy) pero no hace falta cablearlo a nada: no existe un canal
// separado que enrutar.

import { savePushToken, removePushToken } from './repository';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** Base64url (como lo entrega VAPID) → Uint8Array, lo que pide `applicationServerKey`. */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Normal = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Normal);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
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
  const existente = await navigator.serviceWorker.getRegistration('/sw.js');
  if (existente) return existente;
  return navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.error('[push] No se pudo registrar el service worker:', err);
    return null;
  });
}

/**
 * Pide permiso y registra el dispositivo.
 *
 * @param {{businessId: string, uid: string, role: string, professionalId?: string|null, onForegroundMessage?: (payload: any) => void}} args
 * @returns {Promise<{ok: true, endpoint: string} | {ok: false, error: string}>}
 */
export async function enablePushNotifications({ businessId, uid, role, professionalId = null }) {
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, error: 'Falta configurar la clave VAPID (VITE_VAPID_PUBLIC_KEY).' };
  }
  if (!('Notification' in window) || !('PushManager' in window)) {
    return { ok: false, error: 'Este navegador no soporta notificaciones push.' };
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    return { ok: false, error: 'No diste el permiso de notificaciones.' };
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    return { ok: false, error: 'No se pudo activar el service worker.' };
  }

  let suscripcion;
  try {
    suscripcion =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));
  } catch (err) {
    console.error('[push] No se pudo suscribir:', err);
    return { ok: false, error: 'No se pudo registrar este dispositivo para notificaciones.' };
  }

  const json = suscripcion.toJSON();
  await savePushToken(businessId, json, { uid, role, professionalId });

  return { ok: true, endpoint: json.endpoint };
}

/** Apaga las notificaciones en ESTE dispositivo (no en los demás). */
export async function disablePushNotifications({ businessId }) {
  const registration = await navigator.serviceWorker?.getRegistration('/sw.js');
  if (!registration) return;
  const suscripcion = await registration.pushManager.getSubscription();
  if (!suscripcion) return;
  const endpoint = suscripcion.endpoint;
  await suscripcion.unsubscribe();
  await removePushToken(businessId, endpoint);
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
}
