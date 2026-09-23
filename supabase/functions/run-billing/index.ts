// ============================================================================
// run-billing
// ============================================================================
// Traducción de exports.runBilling (procesarFacturacion) en functions/index.js.
// Cobro mensual, suspensión por deuda y borrado de self-service que nunca
// pagaron — corre una vez por día. A diferencia de las demás Edge Functions,
// no la llama una persona desde el panel: la dispara pg_cron (ver el
// `cron.schedule` comentado al final de la migración de facturación, a
// activar en Fase 8 contra el proyecto real). Por eso no hay un `caller` de
// Auth — en su lugar, se exige que quien llama presente la service role key
// como Bearer, igual que cualquier automatización server-to-server.
//
// El trabajo se divide en dos mitades, en el mismo orden que delete-business:
//   1. process_billing() (SQL) hace toda la matemática de deuda/congelamiento
//      y devuelve los negocios self-service candidatos a borrado automático.
//   2. Acá, para cada candidato: se limpian los claims de Auth PRIMERO
//      (clearClaimsForBusiness, la misma Admin API que delete-business —
//      ninguna función de SQL puede tocar auth.users) y recién después se
//      llama a delete_business_cascade.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, clearClaimsForBusiness, errorResponse, jsonResponse, unauthenticated } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto (cron).');
    }

    const admin = supabaseAdmin();
    const { data: candidatos, error } = await admin.rpc('process_billing');
    if (error) throw error;

    let borrados = 0;
    const fallos: string[] = [];
    for (const { business_id, business_name } of candidatos || []) {
      try {
        await clearClaimsForBusiness(admin, business_id);
        const { error: delErr } = await admin.rpc('delete_business_cascade', { p_business_id: business_id });
        if (delErr) throw delErr;
        borrados++;
        console.log(`[run-billing] ${business_id} (${business_name}, self-service, nunca pagó) borrado tras una semana congelada.`);
      } catch (err) {
        fallos.push(business_id);
        console.error(`[run-billing] No se pudo borrar ${business_id}:`, err);
      }
    }

    return jsonResponse({ status: 'processed', borrados, fallos }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
