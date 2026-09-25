// ============================================================================
// Helper compartido para hablar con Mercado Pago (seña de turnos)
// ============================================================================
// Modelo OAuth: cada negocio conecta SU cuenta de MP y Slotly guarda el token
// de esa cuenta en `mp_connections` (solo service role). Todo cobro o
// devolución se hace con el token del negocio, así que la plata va y vuelve
// directo entre el cliente y el negocio — Slotly nunca la toca.
//
// Secrets (supabase secrets set ...):
//   MP_CLIENT_ID      N.º de la aplicación de Slotly en developers.mercadopago.com
//   MP_CLIENT_SECRET  Client secret de esa misma aplicación
//   APP_URL           Dónde vive el front (default: el deploy de Vercel)
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { failedPrecondition } from './auth.ts';

const API = 'https://api.mercadopago.com';
const APP_URL_POR_DEFECTO = 'https://slotly-turnos.vercel.app';

export function appUrl(): string {
  return (Deno.env.get('APP_URL') || APP_URL_POR_DEFECTO).replace(/\/$/, '');
}

/**
 * A dónde volver después de MP. Sale del Origin de quien llamó solo si es el
 * front real o un localhost (para poder probar en desarrollo); cualquier otro
 * origen cae en APP_URL — que un tercero no pueda usar el flujo como
 * redirector a su sitio.
 */
export function origenPermitido(req: Request): string {
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  if (origin === appUrl() || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return appUrl();
}

/** URL a la que MP devuelve al dueño después de autorizar. Tiene que coincidir con la cargada en la app de MP. */
export function redirectUriOAuth(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-oauth-callback`;
}

export function mpConfigurado(): boolean {
  return Boolean(Deno.env.get('MP_CLIENT_ID') && Deno.env.get('MP_CLIENT_SECRET'));
}

async function mpFetch(path: string, token: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const texto = await res.text();
  let cuerpo: any = null;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = { raw: texto }; }
  if (!res.ok) {
    console.error(`[mercadopago] ${init.method || 'GET'} ${path} → ${res.status}`, cuerpo);
    const err = new Error(cuerpo?.message || `Mercado Pago respondió ${res.status}`) as Error & { status?: number; cuerpo?: unknown };
    err.status = res.status;
    err.cuerpo = cuerpo;
    throw err;
  }
  return cuerpo;
}

export interface TokenMp {
  access_token: string;
  refresh_token?: string;
  public_key?: string;
  user_id: number | string;
  expires_in?: number;
  live_mode?: boolean;
}

/** Canjea el `code` del OAuth por el token de la cuenta del negocio. */
export function canjearCodigo(code: string): Promise<TokenMp> {
  return mpFetch('/oauth/token', null, {
    method: 'POST',
    body: JSON.stringify({
      client_id: Deno.env.get('MP_CLIENT_ID'),
      client_secret: Deno.env.get('MP_CLIENT_SECRET'),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUriOAuth(),
    }),
  });
}

function renovarToken(refreshToken: string): Promise<TokenMp> {
  return mpFetch('/oauth/token', null, {
    method: 'POST',
    body: JSON.stringify({
      client_id: Deno.env.get('MP_CLIENT_ID'),
      client_secret: Deno.env.get('MP_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
}

export function datosDeCuenta(token: string): Promise<{ nickname?: string; email?: string }> {
  return mpFetch('/users/me', token);
}

export function vencimientoDe(t: TokenMp): string | null {
  return t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
}

/**
 * Token vigente de la cuenta de MP de un negocio. Los tokens de OAuth de MP
 * duran 180 días: si al que hay le quedan menos de 30, se renueva acá mismo
 * con el refresh token, así nunca se vence en el medio de un cobro.
 */
export async function tokenDeNegocio(admin: SupabaseClient, businessId: string): Promise<string> {
  const { data: con, error } = await admin
    .from('mp_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  if (!con) throw failedPrecondition('El negocio no tiene Mercado Pago conectado.');

  const faltaPoco = con.expires_at && new Date(con.expires_at).getTime() - Date.now() < 30 * 24 * 3600 * 1000;
  if (!faltaPoco || !con.refresh_token) return con.access_token;

  try {
    const nuevo = await renovarToken(con.refresh_token);
    await admin.from('mp_connections').update({
      access_token: nuevo.access_token,
      refresh_token: nuevo.refresh_token || con.refresh_token,
      expires_at: vencimientoDe(nuevo),
    }).eq('business_id', businessId);
    return nuevo.access_token;
  } catch (err) {
    // Si todavía no venció, el viejo sigue sirviendo: mejor cobrar con ese
    // que frenar la reserva por un problema al renovar.
    console.error('[mercadopago] No se pudo renovar el token:', err);
    return con.access_token;
  }
}

export interface Preferencia { id: string; init_point: string }

/** Arma el checkout de la seña de un turno, a nombre del negocio. */
export function crearPreferencia(token: string, p: {
  appointmentId: string;
  businessId: string;
  titulo: string;
  monto: number;
  emailCliente: string | null;
  vence: string;
  volverA: string;
}): Promise<Preferencia> {
  return mpFetch('/checkout/preferences', token, {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `sena-${p.appointmentId}` },
    body: JSON.stringify({
      items: [{ id: p.appointmentId, title: p.titulo, quantity: 1, unit_price: p.monto, currency_id: 'ARS' }],
      ...(p.emailCliente ? { payer: { email: p.emailCliente } } : {}),
      external_reference: p.appointmentId,
      // El negocio va en la URL: el webhook necesita saber con qué token
      // consultar el pago (cada pago vive en la cuenta de su negocio).
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook?biz=${p.businessId}&source_news=webhooks`,
      back_urls: { success: p.volverA, failure: p.volverA, pending: p.volverA },
      auto_return: 'approved',
      // Aprobado o rechazado, nunca "pendiente": un pago en efectivo que se
      // acredita en 2 días no sirve para retener un horario 15 minutos.
      binary_mode: true,
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: p.vence,
      statement_descriptor: 'SENA TURNO',
    }),
  });
}

export function obtenerPago(token: string, paymentId: string) {
  return mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, token);
}

/** Devolución total. Idempotente por pago: apretar dos veces no devuelve dos veces. */
export function devolverPago(token: string, paymentId: string) {
  return mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, token, {
    method: 'POST',
    headers: { 'X-Idempotency-Key': `refund-${paymentId}` },
    body: JSON.stringify({}),
  });
}
