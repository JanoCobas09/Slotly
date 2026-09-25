// ============================================================================
// mp-oauth-callback
// ============================================================================
// A dónde vuelve el dueño después de autorizar a Slotly en Mercado Pago. Es
// la "URL de redireccionamiento" cargada en la aplicación de MP:
//   https://<proyecto>.supabase.co/functions/v1/mp-oauth-callback
//
// Sin JWT (verify_jwt = false en config.toml): llega como una navegación
// común del browser, sin la sesión de Slotly. Lo que autentica es el `state`:
// solo existe si el dueño apretó "Conectar" desde su panel (mp-conexion), se
// usa una sola vez y vence a los 15 minutos.
import { supabaseAdmin } from '../_shared/auth.ts';
import { canjearCodigo, datosDeCuenta, vencimientoDe, appUrl } from '../_shared/mercadopago.ts';

function volver(base: string, resultado: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/admin/configuracion?mp=${resultado}` },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const admin = supabaseAdmin();
  if (!state) return volver(appUrl(), 'error');

  // Se consume siempre, salga bien o mal: un state no se usa dos veces.
  const { data: pedido } = await admin.from('mp_oauth_states').delete().eq('state', state).select('*').maybeSingle();
  if (!pedido) return volver(appUrl(), 'error');
  const base = pedido.volver_a || appUrl();

  // El dueño tocó "Cancelar" en MP, o el link ya estaba vencido.
  if (!code) return volver(base, 'cancelado');
  if (Date.now() - new Date(pedido.created_at).getTime() > 15 * 60 * 1000) return volver(base, 'error');

  try {
    const token = await canjearCodigo(code);
    let nickname: string | null = null;
    try {
      const cuenta = await datosDeCuenta(token.access_token);
      nickname = cuenta.nickname || cuenta.email || null;
    } catch { /* el nombre es para mostrar, no hace falta para cobrar */ }

    const { error } = await admin.from('mp_connections').upsert({
      business_id: pedido.business_id,
      mp_user_id: String(token.user_id),
      nickname,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      public_key: token.public_key || null,
      expires_at: vencimientoDe(token),
      live_mode: token.live_mode ?? null,
      connected_at: new Date().toISOString(),
    }, { onConflict: 'business_id' });
    if (error) throw error;

    return volver(base, 'conectado');
  } catch (err) {
    console.error('[mp-oauth-callback] No se pudo completar la conexión:', err);
    return volver(base, 'error');
  }
});
