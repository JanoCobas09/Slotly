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
  /** Imagen grande de la notificación (la cuadrada de la derecha en Android): la foto del negocio. */
  icon?: string | null;
}

/**
 * La foto de perfil del negocio, para usarla como ícono de la notificación.
 * Es pública (bucket business-logos, la misma que ve el cliente en el link).
 * Sin foto, null: el service worker usa el ícono de Slotly.
 */
export async function fotoDelNegocio(admin: SupabaseClient, businessId: string): Promise<string | null> {
  const { data } = await admin.from('businesses').select('logo_url').eq('id', businessId).maybeSingle();
  return data?.logo_url || null;
}

function vapidListo(): boolean {
  return Boolean(Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY'));
}

/**
 * Manda el mismo payload a una lista de suscripciones. Un endpoint que ya no
 * sirve (navegador desinstalado, permiso revocado, datos borrados) responde
 * 404/410 para siempre: se marca `baja_at` y no se le vuelve a mandar. No se
 * borra: esa fila es la que le dice a send-push que esa persona quería avisos
 * y tiene que recibirlos por mail mientras no se vuelva a registrar.
 * `entregados` son los endpoints a los que llegó; `caidos`, los que se dieron de baja.
 */
export async function enviarWebPush(admin: SupabaseClient, destinatarios: PushRow[], payload: PushPayload) {
  if (!vapidListo()) {
    console.warn('[webpush] Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY: no se manda nada.');
    return { enviados: 0, fallidos: 0, entregados: [] as string[], caidos: [] as string[] };
  }
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@slotly.app',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );

  let enviados = 0;
  let fallidos = 0;
  const entregados: string[] = [];
  const caidos: string[] = [];
  const cuerpo = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || '/admin/citas', icon: payload.icon || null });

  await Promise.all(destinatarios.map(async (d) => {
    try {
      // urgency 'high' (header Urgency del estándar): sin esto el push sale
      // con prioridad normal y Android, con el teléfono bloqueado y en
      // reposo (Doze), lo retiene hasta que se desbloquea. Con 'high' FCM/
      // APNs despiertan el equipo y la notificación entra en el momento,
      // con sonido, como un WhatsApp.
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth_key } },
        cuerpo,
        { urgency: 'high' },
      );
      enviados++;
      entregados.push(d.endpoint);
    } catch (err) {
      fallidos++;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        console.warn(`[webpush] Suscripción caída (${status}), se marca de baja: ${d.endpoint}`);
        caidos.push(d.endpoint);
        await admin.from('push_subscriptions').update({ baja_at: new Date().toISOString() }).eq('endpoint', d.endpoint);
      } else {
        console.error(`[webpush] No se pudo mandar a ${d.endpoint}:`, err);
      }
    }
  }));

  return { enviados, fallidos, entregados, caidos };
}
