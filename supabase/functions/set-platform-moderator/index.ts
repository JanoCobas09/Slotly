// Nombra a alguien moderador de la plataforma (o le saca el rol con
// enabled: false). Traducción de exports.setPlatformModerator en
// functions/index.js. Solo el dueño de la plataforma puede llamarla.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  supabaseAdmin,
  clearClaims,
  isPlatformOwner,
  errorResponse,
  jsonResponse,
  invalidArgument,
  permissionDenied,
  failedPrecondition,
} from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    if (!isPlatformOwner(caller)) throw permissionDenied('Solo el dueño de la plataforma.');

    const { email, enabled = true, name = '' } = await req.json();
    if (!email) throw invalidArgument('Falta el email.');

    const normalizedEmail = String(email).trim().toLowerCase();

    // Nadie se toca a sí mismo desde acá: sacarse el claim de dueño por
    // error dejaría el panel global sin nadie que pueda entrar.
    if (normalizedEmail === (caller.email || '').toLowerCase()) {
      throw failedPrecondition('No podés cambiar tu propio rol.');
    }

    const admin = supabaseAdmin();
    const { data: targetRows } = await admin.rpc('get_user_by_email', {
      lookup_email: normalizedEmail,
    });
    const targetUser = targetRows?.[0] ?? null;

    // Un dueño de plataforma no se degrada a moderador por acá. Si algún
    // día hay más de uno, se decide a mano.
    if (targetUser?.app_metadata?.platform === true) {
      throw permissionDenied('Esa cuenta ya es dueña de la plataforma.');
    }

    if (!enabled) {
      await admin.from('platform_team').delete().eq('email', normalizedEmail);
      await admin.from('pending_admins').delete().eq('email', normalizedEmail);
      if (!targetUser) return jsonResponse({ status: 'not-found' }, corsHeaders);
      // Se le vacían los claims enteros: un moderador no tiene otro rol que
      // conservar. Y se le cortan las sesiones, si no sigue entrando hasta
      // que el token expire solo.
      await clearClaims(admin, targetUser.id);
      await admin.rpc('revoke_user_sessions', { target_id: targetUser.id });
      return jsonResponse({ status: 'revoked' }, corsHeaders);
    }

    // Registro para la UI del panel (la lista de "Equipo" sale de acá).
    await admin.from('platform_team').upsert({ email: normalizedEmail });

    if (!targetUser) {
      // Nunca entró: queda anotado y apply-pending-claims lo aplica en su
      // primer login. Mismo mecanismo que los admins de negocio.
      await admin.from('pending_admins').upsert({
        email: normalizedEmail,
        platform: 'moderator',
        business_id: null,
        role: null,
        professional_id: null,
      });
      return jsonResponse({ status: 'pending', message: 'Se aplicará en su primer login.' }, corsHeaders);
    }

    // Si administraba un negocio, esto lo reemplaza: una cuenta tiene un rol.
    // Los null son explícitos por la misma razón que en set-business-admin:
    // la Admin API mergea app_metadata, así que hay que pisar cada clave
    // vieja a mano o quedaría siendo dueño/staff Y moderador a la vez.
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUser.id, {
      app_metadata: { platform: 'moderator', business_id: null, role: null, professional_id: null },
    });
    if (updateErr) throw updateErr;

    return jsonResponse({ status: 'applied', uid: targetUser.id }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
