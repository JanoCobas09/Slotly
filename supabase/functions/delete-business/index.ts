// ============================================================================
// delete-business
// ============================================================================
// Traducción de exports.deleteBusiness + borrarNegocioInterno en
// functions/index.js. Es definitivo — la confirmación (escribir el nombre
// exacto) la pide el panel, y se vuelve a exigir acá server-side.
//
// A diferencia de Firestore, el borrado en cascada de casi todo (staff,
// servicios, horarios, turnos, tickets, pendientes, billing, promociones)
// lo hacen los `ON DELETE CASCADE` del esquema — ver delete_business_cascade
// en la migración. Lo único que una función de SQL no puede tocar es Auth:
// los custom claims de los usuarios de este negocio viven en
// auth.users.raw_app_meta_data, así que se recorren acá con la Admin API
// (paginada, igual que el listUsers() de Firebase) ANTES de borrar la fila.
import { corsHeaders } from '../_shared/cors.ts';
import { getCaller, isPlatformOwner, supabaseAdmin, clearClaimsForBusiness, errorResponse, jsonResponse, invalidArgument, notFound, failedPrecondition, permissionDenied } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    // Solo el dueño de la plataforma — un moderador no.
    if (!isPlatformOwner(caller)) throw permissionDenied('Solo el dueño de la plataforma.');

    const { businessId, confirmName } = await req.json();
    if (!businessId) throw invalidArgument('Falta el id del negocio.');

    const admin = supabaseAdmin();
    const { data: negocio } = await admin.from('businesses').select('id, name').eq('id', businessId).maybeSingle();
    if (!negocio) throw notFound('Ese negocio no existe.');

    if (String(confirmName || '').trim() !== String(negocio.name || '').trim()) {
      throw failedPrecondition('El nombre no coincide.');
    }

    // 1. Claims de Auth: todos los usuarios cuyo business_id sea este. Se
    // buscan en Auth y no solo en `admins`, porque ese registro puede estar
    // incompleto y el claim es lo que da acceso de verdad.
    const usuarios = await clearClaimsForBusiness(admin, businessId);

    // 2. El negocio y todo lo que cuelga (cascada de SQL).
    const { error: delErr } = await admin.rpc('delete_business_cascade', { p_business_id: businessId });
    if (delErr) throw delErr;

    return jsonResponse({ status: 'deleted', usuarios }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
