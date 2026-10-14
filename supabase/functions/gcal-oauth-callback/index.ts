// ============================================================================
// gcal-oauth-callback
// ============================================================================
// A dónde vuelve el profesional después de darle el permiso a Slotly en
// Google. Es el "URI de redireccionamiento autorizado" del cliente OAuth:
//   https://<proyecto>.supabase.co/functions/v1/gcal-oauth-callback
//
// Sin JWT (verify_jwt = false en config.toml): llega como una navegación
// común del browser. Lo que autentica es el `state` (gcal-conexion): se usa
// una sola vez y vence a los 15 minutos. Mismo esquema que mp-oauth-callback.
//
// Vuelve a la pantalla de donde salió con ?gcal=conectado | cancelado |
// sin-permiso (destildó el permiso del calendario) | error.
import { supabaseAdmin } from '../_shared/auth.ts';
import { appUrl } from '../_shared/mercadopago.ts';
import { canjearCodigo, emailDeIdToken, revocar, SCOPE_CALENDARIO } from '../_shared/google.ts';

function volver(destino: string, resultado: string): Response {
  const url = new URL(destino);
  url.searchParams.set('gcal', resultado);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const admin = supabaseAdmin();
  const porDefecto = `${appUrl()}/admin/configuracion`;
  if (!state) return volver(porDefecto, 'error');

  // Se consume siempre, salga bien o mal: un state no se usa dos veces.
  const { data: pedido } = await admin.from('google_oauth_states').delete().eq('state', state).select('*').maybeSingle();
  if (!pedido) return volver(porDefecto, 'error');
  const destino = pedido.volver_a || porDefecto;

  // Tocó "Cancelar" en Google (?error=access_denied), o el link ya venció.
  if (!code) return volver(destino, 'cancelado');
  if (Date.now() - new Date(pedido.created_at).getTime() > 15 * 60 * 1000) return volver(destino, 'error');

  try {
    const token = await canjearCodigo(code);
    // Google deja destildar cada permiso: sin el del calendario no hay nada
    // que hacer con esta conexión.
    if (!(token.scope || '').split(' ').includes(SCOPE_CALENDARIO)) {
      await revocar(token.refresh_token || token.access_token);
      return volver(destino, 'sin-permiso');
    }
    if (!token.refresh_token) throw new Error('Google no devolvió refresh_token.');

    const { error } = await admin.from('google_calendar_conexiones').upsert({
      professional_id: pedido.professional_id,
      business_id: pedido.business_id,
      google_email: emailDeIdToken(token.id_token),
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      access_expires_at: new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString(),
      conectado_por: pedido.user_id,
      conectado_at: new Date().toISOString(),
      error: null,
      error_at: null,
    }, { onConflict: 'professional_id' });
    if (error) throw error;

    // Los turnos que ya tenía agendados también van a su calendario.
    const { error: errSync } = await admin.rpc('google_sincronizar_profesional', { p_professional_id: pedido.professional_id });
    if (errSync) console.error('[gcal-oauth-callback] No se pudo encolar la sincronización inicial:', errSync);

    return volver(destino, 'conectado');
  } catch (err) {
    console.error('[gcal-oauth-callback] No se pudo completar la conexión:', err);
    return volver(destino, 'error');
  }
});
