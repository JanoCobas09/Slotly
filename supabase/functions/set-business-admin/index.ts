// ============================================================================
// set-business-admin
// ============================================================================
// Le da a un mail acceso al panel de un negocio. Traducción directa de
// exports.setBusinessAdmin en functions/index.js.
//
// Cómo funciona: los claims van pegados al uid de auth.users, que existe
// recién cuando la persona entra por primera vez. Así que:
//   - si ya entró alguna vez → se le aplican los claims al toque
//   - si nunca entró        → se deja el permiso "pendiente" en
//                             pending_admins, y se aplica solo en su primer
//                             login (ver apply-pending-claims)
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  supabaseAdmin,
  guards,
  errorResponse,
  jsonResponse,
  invalidArgument,
  notFound,
  permissionDenied,
  failedPrecondition,
} from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { email, businessId, role, professionalId = null, name = '' } = await req.json();

    if (!email || !businessId || !['owner', 'admin'].includes(role)) {
      throw invalidArgument('Faltan email, businessId o role válido.');
    }

    const callerScope = guards.assertCanManageAdmins(caller, businessId);
    if (callerScope !== 'platform' && role !== 'admin') {
      throw permissionDenied('Solo la plataforma puede designar dueños.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const claims = { business_id: businessId, role, professional_id: professionalId };

    const admin = supabaseAdmin();

    const { data: business } = await admin
      .from('businesses')
      .select('id')
      .eq('id', businessId)
      .maybeSingle();
    if (!business) throw notFound(`El negocio ${businessId} no existe.`);

    // Se busca al destinatario ANTES de escribir nada: si está fuera del
    // alcance de quien llama hay que rechazar sin dejar la operación a
    // medio hacer.
    const { data: targetRows } = await admin.rpc('get_user_by_email', {
      lookup_email: normalizedEmail,
    });
    const targetUser = targetRows?.[0] ?? null;

    guards.assertTargetEnAlcance(callerScope, targetUser?.app_metadata ?? null, businessId);

    // Misma razón que en apply-pending-claims: una cuenta que existe pero no
    // tiene el mail verificado puede ser de cualquiera que se registró por
    // la API pública con ese mail. No se le dan permisos.
    if (targetUser && !targetUser.email_confirmed) {
      throw failedPrecondition(
        'Ya existe una cuenta con ese mail pero no está verificada. Escribinos y lo revisamos.',
      );
    }

    // Registro para la UI (la lista de /admin/admins sale de acá).
    await admin.from('admins').upsert({
      business_id: businessId,
      email: normalizedEmail,
      name,
      role,
      professional_id: professionalId,
    });

    // Nunca entró: su uid todavía no existe, el permiso queda anotado y se
    // aplica solo en el primer login (ver apply-pending-claims).
    if (!targetUser) {
      await admin.from('pending_admins').upsert({
        email: normalizedEmail,
        business_id: businessId,
        role,
        professional_id: professionalId,
      });
      return jsonResponse(
        { status: 'pending', message: 'Se aplicará en su primer login.' },
        corsHeaders,
      );
    }

    // Un usuario pertenece a un solo negocio. Si ya administraba otro, esto
    // lo reemplaza: es intencional, evita accesos cruzados olvidados.
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUser.id, {
      app_metadata: claims,
    });
    if (updateErr) throw updateErr;

    // El token del cliente sigue teniendo los claims viejos hasta que se
    // refresca. El frontend tiene que refrescar sesión para que tomen efecto.
    return jsonResponse({ status: 'applied', uid: targetUser.id }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
