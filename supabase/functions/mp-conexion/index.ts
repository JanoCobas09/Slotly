// ============================================================================
// mp-conexion
// ============================================================================
// El botón "Conectar / Desconectar Mercado Pago" de Configuración. Solo el
// dueño del negocio (o la plataforma): conectar es decidir a qué cuenta va
// la plata de las señas.
//
//   { action: 'conectar', businessId }    → { url } de autorización de MP.
//       El dueño entra a MP, autoriza a Slotly y MP lo devuelve a
//       mp-oauth-callback, que guarda el token.
//   { action: 'desconectar', businessId } → borra el token y apaga la seña
//       (sin cuenta conectada no hay cómo cobrarla).
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller, supabaseAdmin, errorResponse, jsonResponse,
  invalidArgument, permissionDenied, failedPrecondition, isPlatformOwner,
} from '../_shared/auth.ts';
import { mpConfigurado, redirectUriOAuth, origenPermitido } from '../_shared/mercadopago.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { action, businessId } = await req.json();
    if (!businessId) throw invalidArgument('Falta el negocio.');
    if (!isPlatformOwner(caller) && !(caller.role === 'owner' && caller.businessId === businessId)) {
      throw permissionDenied('Solo el dueño del negocio puede conectar Mercado Pago.');
    }

    const admin = supabaseAdmin();

    if (action === 'desconectar') {
      await admin.from('mp_connections').delete().eq('business_id', businessId);
      await admin.from('businesses').update({ deposit_enabled: false }).eq('id', businessId);
      return jsonResponse({ status: 'desconectado' }, corsHeaders);
    }

    if (action !== 'conectar') throw invalidArgument('Acción desconocida.');
    if (!mpConfigurado()) {
      throw failedPrecondition('Mercado Pago todavía no está configurado en la plataforma. Escribinos por soporte.');
    }

    // Estados viejos que nadie usó (el dueño abrió MP y cerró la pestaña).
    await admin.from('mp_oauth_states').delete().lt('created_at', new Date(Date.now() - 3600 * 1000).toISOString());

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await admin.from('mp_oauth_states').insert({
      state, business_id: businessId, user_id: caller.id, volver_a: origenPermitido(req),
    });
    if (error) throw error;

    const url = new URL('https://auth.mercadopago.com/authorization');
    url.searchParams.set('client_id', Deno.env.get('MP_CLIENT_ID')!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUriOAuth());
    return jsonResponse({ url: url.toString() }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
