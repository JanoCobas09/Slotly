// Aplica el permiso que quedó pendiente para el mail de la sesión actual.
// Se llama desde el frontend una vez, después de cada login. Traducción de
// exports.applyPendingClaims en functions/index.js.
//
// No necesita guarda extra: getCaller ya exige sesión válida, y solo puede
// reclamar el pendiente dejado para SU propio mail (nunca uno ajeno).
import { corsHeaders } from '../_shared/cors.ts';
import { getCaller, supabaseAdmin, errorResponse, jsonResponse } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const email = (caller.email || '').toLowerCase();
    if (!email) return jsonResponse({ status: 'no-email' }, corsHeaders);

    // Solo con el mail verificado. La API pública de Auth deja crear una
    // cuenta de email+contraseña con cualquier mail sin verificarlo; sin
    // este chequeo, alguien se registraba con el mail de un pendiente
    // (staff, dueño o moderador) y se llevaba el permiso. Google verifica;
    // las cuentas que crea la plataforma nacen verificadas; las de un
    // intruso, no.
    if (!caller.emailVerified) {
      return jsonResponse({ status: 'email-no-verificado' }, corsHeaders);
    }

    const admin = supabaseAdmin();
    const { data: pending } = await admin
      .from('pending_admins')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (!pending) return jsonResponse({ status: 'none' }, corsHeaders);

    // El pendiente puede ser de dos formas: permiso de negocio (business_id
    // + role) o moderador de la plataforma (platform = 'moderator'). Nunca
    // una mezcla — el check constraint de la tabla ya lo garantiza.
    const claims = pending.platform === 'moderator'
      ? { platform: 'moderator' }
      : {
          business_id: pending.business_id,
          role: pending.role,
          professional_id: pending.professional_id ?? null,
        };

    const { error: updateErr } = await admin.auth.admin.updateUserById(caller.id, {
      app_metadata: claims,
    });
    if (updateErr) throw updateErr;

    await admin.from('pending_admins').delete().eq('email', email);

    // El frontend tiene que refrescar la sesión para ver los claims nuevos.
    return jsonResponse({ status: 'applied', ...claims }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
