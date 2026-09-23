// ============================================================================
// create-business-self-service
// ============================================================================
// Traducción de exports.createBusinessSelfService en functions/index.js.
// Quien entra con Google por primera vez y todavía no tiene negocio arma el
// suyo solo, con ~48hs de prueba gratis. El alta en sí (negocio + billing +
// admin) es atómica del lado de Postgres (create_business_self_service);
// asignar el claim de dueño es un paso aparte porque es una operación de
// Auth, no de la base — si falla, se compensa borrando lo recién creado
// (mismo patrón que el original: nunca dejar un negocio huérfano sin dueño).
//
// GAP CONOCIDO vs. el original: Firebase protegía este endpoint con App
// Check (enforceAppCheck: true) porque es el único callable que cualquier
// cuenta de Google puede invocar sin tener ya un negocio — el blanco más
// fácil para un bot. Supabase no tiene un equivalente directo a App Check;
// evaluar `[auth.captcha]` (hCaptcha/Turnstile) sobre el signup, o un rate
// limit por IP en el Edge Function, antes de exponer esto en producción.
import { corsHeaders } from '../_shared/cors.ts';
import { getCaller, supabaseAdmin, errorResponse, jsonResponse, invalidArgument, unauthenticated, alreadyExists, failedPrecondition, errorDeFuncionSql } from '../_shared/auth.ts';

const CATEGORIAS_VALIDAS = new Set([
  'beauty', 'healthcare', 'wellness', 'automotive', 'education',
  'professional_services', 'pet_services',
]);
const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;
const PLANS: Record<string, { monthlyFee: number; whatsappQuota: number }> = {
  basico: { monthlyFee: 12000, whatsappQuota: 100 },
  pro: { monthlyFee: 22000, whatsappQuota: 500 },
  business: { monthlyFee: 35000, whatsappQuota: 2000 },
};
const DEFAULT_PLAN_ID = 'basico';

function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function sumarDias(fechaISO: string, n: number): string {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    // Una cuenta, un negocio propio. Mismo chequeo que applyPendingClaims/
    // set-business-admin: sin email_verified, la API pública de Auth deja
    // crear cuentas de mail+contraseña sin verificar — acá no debería
    // disparar nunca con Google (siempre viene verificado).
    if (caller.businessId || caller.platform) {
      throw alreadyExists('Esta cuenta ya tiene un negocio asociado.');
    }
    if (!caller.emailVerified) {
      throw failedPrecondition('Tu cuenta no tiene el mail verificado.');
    }
    if (!caller.email) throw unauthenticated();

    const {
      name = '', professionCategory = '', customProfession = '',
      primaryColor = null, planId = DEFAULT_PLAN_ID,
    } = await req.json();

    const nombre = String(name).trim().slice(0, 80);
    if (!nombre) throw invalidArgument('Falta el nombre del negocio.');

    const categoria = CATEGORIAS_VALIDAS.has(professionCategory) ? professionCategory : 'general';
    const profesionPropia = categoria === 'general' ? String(customProfession).trim().slice(0, 80) : '';
    const plan = PLANS[planId] ? planId : DEFAULT_PLAN_ID;
    const { monthlyFee, whatsappQuota } = PLANS[plan];
    const color = primaryColor && COLOR_HEX.test(primaryColor) ? primaryColor : null;

    const hoy = hoyEnArgentina();
    const trialEndsAt = sumarDias(hoy, 2);

    const admin = supabaseAdmin();
    const { data: negocio, error } = await admin.rpc('create_business_self_service', {
      p_name: nombre,
      p_profession_category: categoria,
      p_custom_profession: profesionPropia,
      p_primary_color: color,
      p_plan_id: plan,
      p_monthly_fee: monthlyFee,
      p_whatsapp_quota: whatsappQuota,
      p_trial_ends_at: trialEndsAt,
      p_owner_email: caller.email,
      p_owner_name: '',
    });
    if (error) throw errorDeFuncionSql(error);

    const { error: claimErr } = await admin.auth.admin.updateUserById(caller.id, {
      app_metadata: { business_id: negocio.id, role: 'owner' },
    });
    if (claimErr) {
      // Compensación: si no se pudo dar el permiso, no queda un negocio
      // huérfano que nadie puede administrar.
      await admin.rpc('delete_business_cascade', { p_business_id: negocio.id });
      throw new Error('No se pudo terminar el alta. Probá de nuevo.');
    }

    return jsonResponse(
      { status: 'created', businessId: negocio.id, slug: negocio.slug, trialEndsAt },
      corsHeaders,
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
