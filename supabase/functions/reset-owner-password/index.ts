// Genera una contraseña nueva para alguien que ya tiene cuenta. Traducción
// de exports.resetOwnerPassword en functions/index.js.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  isPlatformOwner,
  supabaseAdmin,
  errorResponse,
  jsonResponse,
  invalidArgument,
  notFound,
  permissionDenied,
  generarPassword,
} from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    if (!isPlatformOwner(caller)) throw permissionDenied('Solo la plataforma puede restablecer contraseñas.');

    const { email, password: elegida = null } = await req.json();
    if (!email) throw invalidArgument('Falta el email.');
    if (elegida !== null && String(elegida).length < 8) {
      throw invalidArgument('La contraseña tiene que tener al menos 8 caracteres.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const admin = supabaseAdmin();

    const { data: rows } = await admin.rpc('get_user_by_email', { lookup_email: normalizedEmail });
    const user = rows?.[0];
    if (!user) throw notFound('No hay ninguna cuenta con ese mail.');

    // No se le tocan los claims: esto cambia la llave, no el permiso.
    if (user.app_metadata?.platform === true) {
      throw permissionDenied('No se restablece la contraseña de la plataforma desde acá.');
    }

    const password = elegida ? String(elegida) : generarPassword();
    const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, { password });
    if (updateErr) throw updateErr;

    // Las sesiones abiertas con la contraseña vieja dejan de valer.
    await admin.rpc('revoke_user_sessions', { target_id: user.id });

    return jsonResponse({ status: 'reset', email: normalizedEmail, password }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
