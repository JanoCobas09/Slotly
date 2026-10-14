// ============================================================================
// Helper compartido para hablar con Google Calendar
// ============================================================================
// Cada profesional conecta SU cuenta de Google (gcal-conexion →
// gcal-oauth-callback) y Slotly guarda el refresh_token en
// google_calendar_conexiones (solo service role). Con eso:
//   · sincronizar-google escribe, mueve y borra el evento de cada turno.
//   · get-busy-slots / create-appointment leen lo ocupado en su calendario.
//
// Permiso pedido: SOLO `calendar.events` (ver y editar eventos) + `openid
// email` (para mostrar con qué cuenta quedó conectado). Es un permiso
// "sensible" de Google: hasta que Google verifique la app, la pantalla de
// permiso muestra "app no verificada" y hay tope de 100 usuarios.
//
// El id de cada evento sale del id del turno (`idDeEvento`): así guardar es
// idempotente (dos sincronizaciones del mismo turno no duplican el evento) y
// no hace falta guardar en ningún lado qué evento corresponde a qué turno.
//
// Secrets (supabase secrets set ...):
//   GOOGLE_CLIENT_ID      Cliente OAuth "Aplicación web" del proyecto de Google Cloud de Slotly
//   GOOGLE_CLIENT_SECRET  Su secret
//   GOOGLE_REDIRECT_URI   A dónde vuelve Google (opcional). En producción:
//                         https://slotly-turnos.vercel.app/api/google-calendar/callback
//                         — vercel.json la reenvía a gcal-oauth-callback. Así la
//                         dirección es del dominio de la app y no de supabase.co,
//                         que Google pide verificar como propio para aprobar la app.
// Solo para los tests locales (apuntan a un Google falso):
//   GOOGLE_TOKEN_URL, GOOGLE_REVOKE_URL, GOOGLE_CALENDAR_API
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { appUrl } from './mercadopago.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl = () => Deno.env.get('GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token';
const revokeUrl = () => Deno.env.get('GOOGLE_REVOKE_URL') || 'https://oauth2.googleapis.com/revoke';
const calendarApi = () => (Deno.env.get('GOOGLE_CALENDAR_API') || 'https://www.googleapis.com/calendar/v3').replace(/\/$/, '');

export const SCOPE_CALENDARIO = 'https://www.googleapis.com/auth/calendar.events';

// Las fechas y horas de los turnos son hora de Argentina ('YYYY-MM-DD' +
// 'HH:MM', igual que en todo el esquema). Argentina no tiene horario de
// verano desde 2009, así que el desfase es fijo.
const ZONA = 'America/Argentina/Buenos_Aires';
const DESFASE = '-03:00';

export const MENSAJE_REVOCADO = 'Google ya no da acceso a este calendario. Volvé a conectarlo.';

export function googleConfigurado(): boolean {
  return Boolean(Deno.env.get('GOOGLE_CLIENT_ID') && Deno.env.get('GOOGLE_CLIENT_SECRET'));
}

/** A dónde vuelve Google después del permiso. Tiene que estar cargada, igual, en el cliente OAuth. */
export function redirectUriGoogle(): string {
  return Deno.env.get('GOOGLE_REDIRECT_URI') || `${Deno.env.get('SUPABASE_URL')}/functions/v1/gcal-oauth-callback`;
}

export function urlDeAutorizacion(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', Deno.env.get('GOOGLE_CLIENT_ID')!);
  url.searchParams.set('redirect_uri', redirectUriGoogle());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid email ${SCOPE_CALENDARIO}`);
  // offline + consent: que Google SIEMPRE devuelva refresh_token, también
  // cuando la persona ya había dado el permiso antes (reconectar).
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

export class ErrorGoogle extends Error {
  status: number;
  /** El refresh_token ya no sirve (la persona sacó el permiso, cambió la contraseña...). */
  revocado: boolean;
  constructor(status: number, mensaje: string, revocado = false) {
    super(mensaje);
    this.status = status;
    this.revocado = revocado;
  }
}

async function pedirToken(params: Record<string, string>) {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      ...params,
    }),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[google] token ${params.grant_type} → ${res.status}`, cuerpo);
    throw new ErrorGoogle(res.status, cuerpo?.error_description || cuerpo?.error || `Google respondió ${res.status}`, cuerpo?.error === 'invalid_grant');
  }
  return cuerpo as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
}

/** Canjea el `code` del OAuth por los tokens de la cuenta del profesional. */
export function canjearCodigo(code: string) {
  return pedirToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUriGoogle() });
}

/**
 * El mail de la cuenta, del id_token que devuelve Google junto con el token.
 * Sin verificar la firma a propósito: llega directo del endpoint de Google
 * por HTTPS en la misma respuesta, y se usa solo para mostrarlo.
 */
export function emailDeIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).email || null;
  } catch {
    return null;
  }
}

/** Le avisa a Google que Slotly deja de usar el permiso. Si falla no importa: el token se borra igual. */
export async function revocar(token: string) {
  try {
    await fetch(`${revokeUrl()}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    console.error('[google] No se pudo revocar el token:', err);
  }
}

export interface Conexion {
  professional_id: string;
  business_id: string;
  google_email: string | null;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  calendar_id: string;
  error: string | null;
}

/** La conexión del profesional, solo si anda (sin error pendiente). */
export async function conexionDe(admin: SupabaseClient, professionalId: string): Promise<Conexion | null> {
  const { data } = await admin.from('google_calendar_conexiones').select('*')
    .eq('professional_id', professionalId).is('error', null).maybeSingle();
  return (data as Conexion) || null;
}

export async function marcarError(admin: SupabaseClient, professionalId: string, mensaje: string) {
  await admin.from('google_calendar_conexiones')
    .update({ error: mensaje, error_at: new Date().toISOString(), access_token: null, access_expires_at: null })
    .eq('professional_id', professionalId);
}

/**
 * Access token vigente (dura 1 hora). Usa el guardado si le queda más de un
 * minuto; si no, pide otro con el refresh_token. Si Google lo rechaza para
 * siempre (invalid_grant), la conexión queda marcada con error para que el
 * panel pida reconectar, y deja de intentarse.
 */
async function tokenDeAcceso(admin: SupabaseClient, c: Conexion, forzar = false): Promise<string> {
  if (!forzar && c.access_token && c.access_expires_at && new Date(c.access_expires_at).getTime() > Date.now() + 60_000) {
    return c.access_token;
  }
  try {
    const t = await pedirToken({ grant_type: 'refresh_token', refresh_token: c.refresh_token });
    const vence = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString();
    c.access_token = t.access_token;
    c.access_expires_at = vence;
    await admin.from('google_calendar_conexiones')
      .update({ access_token: t.access_token, access_expires_at: vence })
      .eq('professional_id', c.professional_id);
    return t.access_token;
  } catch (err) {
    if (err instanceof ErrorGoogle && err.revocado) await marcarError(admin, c.professional_id, MENSAJE_REVOCADO);
    throw err;
  }
}

/** Llamada a la API de Calendar con el token del profesional (renueva una vez si da 401). */
async function calendario(admin: SupabaseClient, c: Conexion, path: string, init: RequestInit = {}) {
  let token = await tokenDeAcceso(admin, c);
  for (let intento = 0; intento < 2; intento++) {
    const res = await fetch(`${calendarApi()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && intento === 0) {
      token = await tokenDeAcceso(admin, c, true);
      continue;
    }
    const texto = await res.text();
    let cuerpo: any = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = { raw: texto }; }
    return { status: res.status, ok: res.ok, cuerpo };
  }
  throw new ErrorGoogle(401, 'Google rechazó el token.');
}

const rutaEventos = (c: Conexion) => `/calendars/${encodeURIComponent(c.calendar_id)}/events`;

/**
 * Id del evento de un turno. Google acepta ids propios hechos de 0-9 y a-v
 * (base32hex), de 5 a 1024 caracteres: el uuid del turno sin guiones ya lo
 * cumple (hexadecimal).
 */
export function idDeEvento(appointmentId: string): string {
  return `sl${appointmentId.replace(/-/g, '').toLowerCase()}`;
}

export interface TurnoParaEvento {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string | null;
  client_name: string | null;
  client_phone: string | null;
  service_name: string | null;
  notes: string | null;
}

function cuerpoDelEvento(t: TurnoParaEvento, negocio: { name?: string; address?: string | null }) {
  const lineas = [
    t.client_name ? `Cliente: ${t.client_name}` : null,
    t.client_phone ? `Teléfono: ${t.client_phone}` : null,
    t.notes ? `Notas: ${t.notes}` : null,
    '',
    `Turno de ${negocio.name || 'Slotly'}. Si lo cambiás acá no se cambia en Slotly: movelo o cancelalo desde el panel.`,
  ].filter((l) => l !== null);
  return {
    summary: [t.service_name || 'Turno', t.client_name].filter(Boolean).join(' · '),
    description: lineas.join('\n'),
    location: negocio.address || undefined,
    start: { dateTime: `${t.appointment_date}T${t.start_time}:00${DESFASE}`, timeZone: ZONA },
    end: { dateTime: `${t.appointment_date}T${t.end_time || t.start_time}:00${DESFASE}`, timeZone: ZONA },
    status: 'confirmed',
    transparency: 'opaque',
    source: { title: 'Slotly', url: `${appUrl()}/admin/citas` },
    extendedProperties: { private: { slotly: '1', appointmentId: t.id } },
  };
}

/**
 * Crea o actualiza el evento del turno. `update` primero: también revive un
 * evento que se había borrado (turno cancelado y vuelto a activar). Si no
 * existe, `insert` con el id fijo; si justo lo creó otra sincronización en
 * paralelo (409), `update` de nuevo.
 */
export async function guardarEvento(admin: SupabaseClient, c: Conexion, t: TurnoParaEvento, negocio: { name?: string; address?: string | null }) {
  const id = idDeEvento(t.id);
  const cuerpo = JSON.stringify({ id, ...cuerpoDelEvento(t, negocio) });
  let r = await calendario(admin, c, `${rutaEventos(c)}/${id}`, { method: 'PUT', body: cuerpo });
  if (r.status === 404) {
    r = await calendario(admin, c, rutaEventos(c), { method: 'POST', body: cuerpo });
    if (r.status === 409) r = await calendario(admin, c, `${rutaEventos(c)}/${id}`, { method: 'PUT', body: cuerpo });
  }
  if (!r.ok) throw new ErrorGoogle(r.status, r.cuerpo?.error?.message || `Google respondió ${r.status}`);
}

/** Borra el evento del turno. Que ya no exista (404 / 410) cuenta como hecho. */
export async function borrarEvento(admin: SupabaseClient, c: Conexion, appointmentId: string) {
  const r = await calendario(admin, c, `${rutaEventos(c)}/${idDeEvento(appointmentId)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    throw new ErrorGoogle(r.status, r.cuerpo?.error?.message || `Google respondió ${r.status}`);
  }
}

function aHora(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function siguienteDia(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Lo ocupado en el calendario del profesional ese día, con la forma de
 * get-busy-slots ({ startTime, endTime } en hora de Argentina). Se saltean:
 * los eventos que puso Slotly (ya son turnos), los marcados "Disponible"
 * (transparent — así vienen, por ejemplo, los de todo el día por defecto),
 * los cancelados y las invitaciones que la persona rechazó. Un evento que
 * cruza la medianoche se recorta al día.
 *
 * Sin conexión, o si Google falla, devuelve [] — mejor ofrecer la grilla de
 * Slotly que dejar al negocio sin reservas porque Google no contestó.
 */
export async function ocupadoEnGoogle(admin: SupabaseClient, professionalId: string, fecha: string): Promise<{ startTime: string; endTime: string }[]> {
  const c = await conexionDe(admin, professionalId);
  if (!c) return [];
  try {
    const params = new URLSearchParams({
      timeMin: `${fecha}T00:00:00${DESFASE}`,
      timeMax: `${siguienteDia(fecha)}T00:00:00${DESFASE}`,
      singleEvents: 'true',
      maxResults: '250',
    });
    const r = await calendario(admin, c, `${rutaEventos(c)}?${params}`);
    if (!r.ok) throw new ErrorGoogle(r.status, r.cuerpo?.error?.message || `Google respondió ${r.status}`);

    const inicioDelDia = Date.parse(`${fecha}T00:00:00${DESFASE}`);
    const ocupado: { startTime: string; endTime: string }[] = [];
    for (const e of r.cuerpo?.items || []) {
      if (e.status === 'cancelled' || e.transparency === 'transparent') continue;
      if (e.extendedProperties?.private?.slotly === '1') continue;
      if ((e.attendees || []).some((a: any) => a.self && a.responseStatus === 'declined')) continue;

      let desde: number, hasta: number;
      if (e.start?.date) {
        // De todo el día: `end.date` es el día siguiente al último (exclusivo).
        if (!(e.start.date <= fecha && fecha < e.end?.date)) continue;
        desde = 0;
        hasta = 1440;
      } else {
        desde = Math.max(0, Math.round((Date.parse(e.start?.dateTime) - inicioDelDia) / 60000));
        hasta = Math.min(1440, Math.round((Date.parse(e.end?.dateTime) - inicioDelDia) / 60000));
        if (!(hasta > desde)) continue;
      }
      ocupado.push({ startTime: aHora(desde), endTime: aHora(hasta) });
    }
    return ocupado;
  } catch (err) {
    console.error(`[google] No se pudo leer el calendario del profesional ${professionalId}:`, err);
    return [];
  }
}

/** ¿Choca [inicio, fin) ('HH:MM') con algo de su calendario ese día? */
export async function ocupadoEnGoogleEntre(admin: SupabaseClient, professionalId: string, fecha: string, inicio: string, fin: string): Promise<boolean> {
  const ocupado = await ocupadoEnGoogle(admin, professionalId, fecha);
  return ocupado.some((o) => inicio < o.endTime && fin > o.startTime);
}
