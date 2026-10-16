// ============================================================================
// publicar-instagram
// ============================================================================
// Publica en el Instagram de Slotly (@slotly.turnos) lo que la cola
// `ig_publicaciones` tiene programado para ahora o antes, con la API oficial
// (Instagram Login, graph.instagram.com). Es el marketing de la plataforma:
// no toca nada de los negocios.
//
// Cada publicación pasa por:
//   pendiente → (se crea el contenedor en Instagram) → procesando
//   → (Instagram terminó de procesar) → publicada
// Las imágenes suelen quedar listas en segundos y se publican en la misma
// corrida; un video puede tardar minutos y se publica en una corrida
// siguiente (el cron llama cada 15 minutos mientras haya algo procesando).
// Si falla, se reintenta hasta 3 veces; a la tercera queda en 'error' y se
// avisa por mail a INSTAGRAM_AVISO_MAIL (si está configurado).
//
// También renueva el token (vence a los 60 días) cuando le quedan menos de
// 15. El cron `instagram-token` la llama una vez por día para eso aunque la
// cola esté vacía.
//
// La llaman los crons de 20261028000000_instagram_publicaciones.sql con la
// service role key como Bearer, igual que actualizar-feriados.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated } from '../_shared/auth.ts';
import { enviarMail } from '../_shared/mail.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// INSTAGRAM_API_URL solo existe para las pruebas locales (una API simulada).
const API = Deno.env.get('INSTAGRAM_API_URL') || 'https://graph.instagram.com/v24.0';
const BUCKET = 'instagram';
const MAX_INTENTOS = 3;
const DIA_MS = 24 * 60 * 60 * 1000;
/** Lo que espera una corrida a que Instagram procese antes de dejarlo para la próxima. */
const ESPERA_MS = 30_000;
/** Un video que sigue procesando después de esto se da por trabado. */
const PROCESO_MAX_MS = 2 * 60 * 60 * 1000;

type Cuenta = { ig_user_id: string; token: string; token_vence_at: string };
type Publicacion = {
  id: string;
  clave: string;
  tipo: 'post' | 'carrusel' | 'historia' | 'reel';
  medios: string[];
  texto: string;
  portada: string | null;
  estado: 'pendiente' | 'procesando';
  contenedor_id: string | null;
  tomada_at: string | null;
  intentos: number;
};

class ErrorInstagram extends Error {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!bearer || bearer !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto.');
    }

    const admin = supabaseAdmin();
    const { data: cuenta, error: errCuenta } = await admin
      .from('ig_cuenta').select('ig_user_id, token, token_vence_at').eq('id', 1).maybeSingle();
    if (errCuenta) throw errCuenta;
    if (!cuenta) return jsonResponse({ ok: false, motivo: 'Falta conectar la cuenta (ig_cuenta vacía).' }, corsHeaders);

    const token = await renovarTokenSiHaceFalta(admin, cuenta as Cuenta);

    const { data: cola, error: errCola } = await admin
      .from('ig_publicaciones')
      .select('id, clave, tipo, medios, texto, portada, estado, contenedor_id, tomada_at, intentos')
      .in('estado', ['pendiente', 'procesando'])
      .lte('publicar_at', new Date().toISOString())
      .order('publicar_at')
      .limit(10);
    if (errCola) throw errCola;

    const resultados: Record<string, string> = {};
    for (const p of (cola ?? []) as Publicacion[]) {
      resultados[p.clave] = await procesar(admin, cuenta.ig_user_id, token, p);
    }
    return jsonResponse({ ok: true, resultados }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});

// ─── Una publicación ────────────────────────────────────────────────────────

async function procesar(admin: SupabaseClient, igUserId: string, token: string, p: Publicacion): Promise<string> {
  const ahora = Date.now();
  try {
    let contenedor = p.contenedor_id;

    if (p.estado === 'pendiente' || !contenedor) {
      // Otra corrida la tiene tomada y todavía no creó el contenedor: dejarla.
      if (p.estado === 'procesando' && p.tomada_at && ahora - Date.parse(p.tomada_at) < 10 * 60 * 1000) {
        return 'la está publicando otra corrida';
      }
      // Tomarla solo si sigue como la leímos (dos corridas no la toman las dos).
      const { data: tomada, error } = await admin
        .from('ig_publicaciones')
        .update({ estado: 'procesando', tomada_at: new Date().toISOString(), error: null })
        .eq('id', p.id).eq('estado', p.estado).is('contenedor_id', null)
        .select('id');
      if (error) throw error;
      if (!tomada?.length) return 'la tomó otra corrida';

      contenedor = await crearContenedor(igUserId, token, p);
      await admin.from('ig_publicaciones').update({ contenedor_id: contenedor }).eq('id', p.id);
    } else if (p.tomada_at && ahora - Date.parse(p.tomada_at) > PROCESO_MAX_MS) {
      throw new ErrorInstagram('Instagram no terminó de procesar el video en 2 horas.');
    }

    const estado = await esperarProceso(contenedor, token);
    if (estado === 'IN_PROGRESS') return 'Instagram sigue procesando; se publica en la próxima corrida';
    if (estado !== 'FINISHED') throw new ErrorInstagram(`Instagram no pudo procesar el archivo (${estado}).`);

    const publicado = await graph('POST', `/${igUserId}/media_publish`, token, { creation_id: contenedor });
    const mediaId = String(publicado.id);
    let permalink: string | null = null;
    try {
      permalink = (await graph('GET', `/${mediaId}`, token, { fields: 'permalink' })).permalink ?? null;
    } catch { /* el link es un extra: si no viene, igual quedó publicada */ }

    await admin.from('ig_publicaciones').update({
      estado: 'publicada', ig_media_id: mediaId, permalink, publicada_at: new Date().toISOString(), error: null,
    }).eq('id', p.id);
    return 'publicada';
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    const intentos = p.intentos + 1;
    const final = intentos >= MAX_INTENTOS;
    await admin.from('ig_publicaciones').update({
      estado: final ? 'error' : 'pendiente',
      contenedor_id: null,
      tomada_at: null,
      intentos,
      error: mensaje.slice(0, 1000),
    }).eq('id', p.id);
    if (final) await avisarError(p, mensaje);
    return `${final ? 'error' : 'reintenta'}: ${mensaje}`;
  }
}

/** Crea el contenedor de Instagram para la publicación y devuelve su id. */
async function crearContenedor(igUserId: string, token: string, p: Publicacion): Promise<string> {
  const urls = p.medios.map(urlPublica);
  const esVideo = (u: string) => /\.mp4$/i.test(u);
  const caption = p.texto || undefined;

  if (p.tipo === 'carrusel') {
    if (urls.length < 2) throw new ErrorInstagram('Un carrusel necesita de 2 a 10 archivos.');
    const hijos: string[] = [];
    for (const u of urls) {
      const hijo = await graph('POST', `/${igUserId}/media`, token, esVideo(u)
        ? { media_type: 'VIDEO', video_url: u, is_carousel_item: 'true' }
        : { image_url: u, is_carousel_item: 'true' });
      hijos.push(String(hijo.id));
    }
    // Los videos de un carrusel tienen que terminar de procesar antes de armarlo.
    for (const h of hijos) {
      const estado = await esperarProceso(h, token, 90_000);
      if (estado !== 'FINISHED') throw new ErrorInstagram(`Un archivo del carrusel no se pudo procesar (${estado}).`);
    }
    return String((await graph('POST', `/${igUserId}/media`, token, {
      media_type: 'CAROUSEL', children: hijos.join(','), caption,
    })).id);
  }

  const [u] = urls;
  if (p.tipo === 'historia') {
    return String((await graph('POST', `/${igUserId}/media`, token, esVideo(u)
      ? { media_type: 'STORIES', video_url: u }
      : { media_type: 'STORIES', image_url: u })).id);
  }
  if (p.tipo === 'reel') {
    if (!esVideo(u)) throw new ErrorInstagram('Un reel necesita un video MP4.');
    return String((await graph('POST', `/${igUserId}/media`, token, {
      media_type: 'REELS', video_url: u, caption, share_to_feed: 'true',
      cover_url: p.portada ? urlPublica(p.portada) : undefined,
    })).id);
  }
  if (esVideo(u)) throw new ErrorInstagram('Un post lleva una imagen JPEG; para video usá un reel.');
  return String((await graph('POST', `/${igUserId}/media`, token, { image_url: u, caption })).id);
}

/** Espera a que el contenedor deje de estar IN_PROGRESS (o se acabe el tiempo). */
async function esperarProceso(contenedor: string, token: string, espera = ESPERA_MS): Promise<string> {
  const hasta = Date.now() + espera;
  for (;;) {
    const { status_code } = await graph('GET', `/${contenedor}`, token, { fields: 'status_code' });
    if (status_code !== 'IN_PROGRESS' || Date.now() > hasta) return String(status_code);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

// ─── Token ──────────────────────────────────────────────────────────────────

async function renovarTokenSiHaceFalta(admin: SupabaseClient, cuenta: Cuenta): Promise<string> {
  if (Date.parse(cuenta.token_vence_at) - Date.now() > 15 * DIA_MS) return cuenta.token;
  const res = await fetch(
    `${API.replace(/\/v[\d.]+$/, '')}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(cuenta.token)}`,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Si no se pudo, se sigue con el viejo (mañana se reintenta) y se avisa
    // cuando ya está por vencer.
    console.error('[publicar-instagram] No se pudo renovar el token:', body?.error?.message ?? res.status);
    if (Date.parse(cuenta.token_vence_at) - Date.now() < 3 * DIA_MS) {
      await avisar('El token de Instagram de Slotly está por vencer',
        `No se pudo renovar solo (${body?.error?.message ?? res.status}). Generá uno nuevo en la app de Meta y cargalo con video/scripts/instagram-cola.mjs conectar.`);
    }
    return cuenta.token;
  }
  const vence = new Date(Date.now() + Number(body.expires_in || 60 * 24 * 3600) * 1000).toISOString();
  await admin.from('ig_cuenta').update({
    token: body.access_token, token_vence_at: vence, actualizado_at: new Date().toISOString(),
  }).eq('id', 1);
  return body.access_token;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function urlPublica(ruta: string): string {
  const base = Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '');
  return `${base}/storage/v1/object/public/${BUCKET}/${ruta.split('/').map(encodeURIComponent).join('/')}`;
}

// deno-lint-ignore no-explicit-any
async function graph(metodo: 'GET' | 'POST', ruta: string, token: string, params: Record<string, string | undefined>): Promise<any> {
  const limpios = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>;
  const query = new URLSearchParams({ ...limpios, access_token: token });
  const res = metodo === 'GET'
    ? await fetch(`${API}${ruta}?${query}`)
    : await fetch(`${API}${ruta}`, { method: 'POST', body: query });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    throw new ErrorInstagram(`Instagram: ${e.error_user_msg || e.message || `HTTP ${res.status}`}${e.code ? ` (código ${e.code})` : ''}`);
  }
  return body;
}

async function avisarError(p: Publicacion, mensaje: string) {
  await avisar(`No se pudo publicar en Instagram: ${p.clave}`,
    `La publicación "${p.clave}" (${p.tipo}) falló ${MAX_INTENTOS} veces y quedó en error.\n\nÚltimo error: ${mensaje}\n\nPara reintentarla, corregí el problema y volvé a cargarla con video/scripts/instagram-cola.mjs.`);
}

async function avisar(subject: string, text: string) {
  const to = Deno.env.get('INSTAGRAM_AVISO_MAIL');
  if (to) await enviarMail({ to, subject, text, fromName: 'Instagram de Slotly' });
}
