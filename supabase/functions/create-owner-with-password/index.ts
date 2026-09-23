// ============================================================================
// create-owner-with-password
// ============================================================================
// Traducción de exports.createOwnerWithPassword en functions/index.js. Para
// el dueño que no usa Gmail o no quiere mezclarlo con lo personal — la
// plataforma le crea una cuenta de mail+contraseña. Devuelve la contraseña
// UNA sola vez: Supabase guarda el hash, no el texto. Si se pierde, se
// genera otra con reset-owner-password.
//
// Crear cuentas es de la plataforma, no del tenant: el dueño de un negocio
// puede dar de alta staff (set-business-admin) pero no fabricar usuarios.
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
  alreadyExists,
  generarPassword,
} from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    if (!isPlatformOwner(caller)) throw permissionDenied('Solo la plataforma puede crear cuentas.');

    const {
      email, businessId, name = '', role = 'owner', professionalId = null,
      password: elegida = null,
    } = await req.json();

    if (!email || !businessId || !['owner', 'admin'].includes(role)) {
      throw invalidArgument('Faltan email, businessId o role válido.');
    }
    if (elegida !== null && String(elegida).length < 8) {
      throw invalidArgument('La contraseña tiene que tener al menos 8 caracteres.');
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const admin = supabaseAdmin();

    const { data: business } = await admin.from('businesses').select('id').eq('id', businessId).maybeSingle();
    if (!business) throw notFound(`El negocio ${businessId} no existe.`);

    // Si ya existe, no se le pisa la contraseña: puede ser alguien que ya
    // venía entrando con Google, y cambiársela en silencio lo dejaría afuera.
    const { data: existentes } = await admin.rpc('get_user_by_email', { lookup_email: normalizedEmail });
    if (existentes?.[0]) {
      throw alreadyExists(
        'Ya existe una cuenta con ese mail. Usá "Agregar administrador" para darle acceso, o restablecele la contraseña.',
      );
    }

    const password = elegida ? String(elegida) : generarPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true, // la cuenta la crea la plataforma, no hay mail que verificar
      user_metadata: name ? { full_name: name } : undefined,
      app_metadata: { business_id: businessId, role, professional_id: professionalId },
    });
    if (createErr) throw createErr;

    await admin.from('admins').upsert({
      business_id: businessId, email: normalizedEmail, name, role, professional_id: professionalId,
    });
    await admin.from('pending_admins').delete().eq('email', normalizedEmail);

    return jsonResponse(
      { status: 'created', uid: created.user.id, email: normalizedEmail, password },
      corsHeaders,
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
