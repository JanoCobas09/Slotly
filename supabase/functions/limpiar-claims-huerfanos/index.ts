// Limpia los permisos de la sesión actual si apuntan a algo que ya no existe:
// el negocio (lo borraron), la sucursal del administrador de sucursal o el
// perfil de profesional del staff. Se llama desde el frontend al entrar,
// solo cuando detecta alguno de esos casos (ver AuthContext).
//
// Sin esto, la cuenta queda con el rol viejo: al entrar la app la manda al
// panel de un negocio que no existe (queda vacío) en vez de ofrecerle crear
// el suyo. borrar un negocio ya limpia los permisos de sus usuarios
// (clearClaimsForBusiness), pero un resto por cualquier otro camino dejaba a
// la persona trabada sin salida.
//
// Solo toca la cuenta de quien llama y solo si de verdad está huérfana: se
// vuelve a verificar todo acá con la service role, no se confía en el browser.
import { corsHeaders } from '../_shared/cors.ts';
import { getCaller, supabaseAdmin, clearClaims, errorResponse, jsonResponse } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    // La plataforma no depende de un negocio; sin negocio no hay nada que limpiar.
    if (caller.platform || !caller.businessId) return jsonResponse({ status: 'ok' }, corsHeaders);

    const admin = supabaseAdmin();
    const existe = async (tabla: string, id: string, extra: Record<string, string> = {}) => {
      let q = admin.from(tabla).select('id').eq('id', id);
      for (const [col, val] of Object.entries(extra)) q = q.eq(col, val);
      const { data } = await q.maybeSingle();
      return Boolean(data);
    };

    let huerfana = !(await existe('businesses', caller.businessId));
    if (!huerfana && caller.role === 'manager' && caller.branchId) {
      huerfana = !(await existe('branches', caller.branchId, { business_id: caller.businessId }));
    }
    if (!huerfana && caller.role === 'admin' && caller.professionalId) {
      huerfana = !(await existe('professionals', caller.professionalId, { business_id: caller.businessId }));
    }
    if (!huerfana) return jsonResponse({ status: 'ok' }, corsHeaders);

    await clearClaims(admin, caller.id);
    return jsonResponse({ status: 'cleared' }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
