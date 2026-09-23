// Le quita todo acceso administrativo a un mail. Traducción de
// exports.revokeBusinessAdmin en functions/index.js.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  supabaseAdmin,
  clearClaims,
  guards,
  errorResponse,
  jsonResponse,
  invalidArgument,
} from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { email, businessId } = await req.json();
    if (!email || !businessId) throw invalidArgument('Faltan email o businessId.');

    const callerScope = guards.assertCanManageAdmins(caller, businessId);
    const normalizedEmail = String(email).trim().toLowerCase();
    const admin = supabaseAdmin();

    // Igual que en set-business-admin: primero se mira a quién se está por
    // tocar. Revocar es tan destructivo como asignar — dejar entrar acá al
    // mail de la plataforma le vaciaría los claims y nadie podría abrir el
    // panel global.
    const { data: targetRows } = await admin.rpc('get_user_by_email', {
      lookup_email: normalizedEmail,
    });
    const targetUser = targetRows?.[0] ?? null;

    guards.assertTargetEnAlcance(callerScope, targetUser?.app_metadata ?? null, businessId);

    await admin.from('admins').delete().eq('business_id', businessId).eq('email', normalizedEmail);
    await admin.from('pending_admins').delete().eq('email', normalizedEmail);

    if (!targetUser) return jsonResponse({ status: 'not-found' }, corsHeaders);

    await clearClaims(admin, targetUser.id);

    // Corta las sesiones abiertas: sin esto, su token actual sigue siendo
    // válido hasta que expire solo.
    await admin.rpc('revoke_user_sessions', { target_id: targetUser.id });

    return jsonResponse({ status: 'revoked' }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
