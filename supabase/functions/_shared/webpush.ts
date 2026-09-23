// ============================================================================
// Helper compartido para mandar Web Push (VAPID)
// ============================================================================
// Usado por send-push (triggers de negocio: nuevo turno/cancelación) y por
// enviar-push-de-prueba (el botón "mandame una notificación de prueba").
// Nunca puede tirar abajo a quien llama: si falla el push, lo que sea que
// ya pasó (el turno guardado, la notificación in-app ya escrita) sigue
// valiendo — un error acá se loguea y se sigue, igual que enviarPush en
// el functions/index.js original.
import webpush from 'npm:web-push@3';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface PushRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

function vapidListo(): boolean {
  return Boolean(Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY'));
}

/**
 * Manda el mismo payload a una lista de suscripciones. Un endpoint que ya no
 * sirve (navegador desinstalado, permiso revocado) responde 404/410 para
 * siempre si no se limpia solo — se borra de la tabla apenas se detecta.
 */
export async function enviarWebPush(admin: SupabaseClient, destinatarios: PushRow[], payload: PushPayload) {
  if (!vapidListo()) {
    console.warn('[webpush] Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY: no se manda nada.');
    return { enviados: 0, fallidos: 0 };
  }
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@slotly.app',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  let enviados = 0;
  let fallidos = 0;
  const cuerpo = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || '/admin/citas' });

  await Promise.all(destinatarios.map(async (d) => {
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth_key } },
        cuerpo,
      );
      enviados++;
    } catch (err) {
      fallidos++;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', d.endpoint);
      } else {
        console.error(`[webpush] No se pudo mandar a ${d.endpoint}:`, err);
      }
    }
  }));

  return { enviados, fallidos };
}
