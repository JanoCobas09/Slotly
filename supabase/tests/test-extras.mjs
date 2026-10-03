// Extras de la plataforma sin cambiar el plan, contra el stack local
// (`npx supabase start`). Ver 20261016000000_extras_plataforma.sql.
import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) {
  if (cond) { pasaron++; console.log(`  ok    ${label}`); }
  else { fallaron++; console.log(`  FALLA ${label}`); }
}

async function usuario(prefijo, appMetadata = {}) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { error } = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (e2) throw e2;
  return createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}

async function main() {
  const plataforma = await usuario('plat-extras', { platform: true });
  const moderador = await usuario('mod-extras', { platform: 'moderator' });

  const { data: biz, error } = await admin.from('businesses').insert({
    name: 'Basico Con Extra', slug: `basico-extra-${Date.now()}`, plan_id: 'basico', whatsapp_quota: 100,
  }).select('*').single();
  if (error) throw error;
  const dueno = await usuario('dueno-extras', { business_id: biz.id, role: 'owner' });
  const nueva = (name) => dueno.from('branches').insert({ business_id: biz.id, name }).select('*').single();

  console.log('Sin extras, el Básico tiene solo la principal:');
  const { error: e0 } = await nueva('Norte');
  ok(Boolean(e0) && /permite hasta 1 sucursal/.test(e0.message), `no puede sumar una segunda — ${e0?.message}`);

  console.log('Quién da extras:');
  const { error: eD } = await dueno.from('businesses').update({ extra_sucursales: 1 }).eq('id', biz.id);
  ok(Boolean(eD), 'el dueño no se los puede dar solo');
  await moderador.from('businesses').update({ extra_sucursales: 1 }).eq('id', biz.id);
  let { data: b } = await admin.from('businesses').select('*').eq('id', biz.id).single();
  ok(b.extra_sucursales === 0, 'un moderador tampoco');
  const { error: eNeg } = await plataforma.from('businesses').update({ extra_sucursales: -1 }).eq('id', biz.id);
  ok(Boolean(eNeg), 'no se aceptan extras negativos');
  const { data: dP, error: eP } = await plataforma.from('businesses').update({ extra_sucursales: 1 }).eq('id', biz.id).select('*');
  ok(!eP && dP?.[0]?.extra_sucursales === 1, `la plataforma le da +1 sucursal — ${eP?.message || 'ok'}`);
  ok(dP?.[0]?.plan_id === 'basico', 'el plan sigue siendo Básico');

  console.log('El dueño usa el extra como quiera:');
  const { data: norte, error: e1 } = await nueva('Norte');
  ok(!e1 && norte, `crea la segunda — ${e1?.message || 'ok'}`);
  const { error: e2 } = await nueva('Sur');
  ok(Boolean(e2) && /permite hasta 2 sucursales/.test(e2.message), `una tercera no — ${e2?.message}`);
  const { error: eEd } = await dueno.from('branches').update({ name: 'Norte Centro' }).eq('id', norte.id);
  ok(!eEd, 'la edita');
  await dueno.from('branches').update({ is_active: false }).eq('id', norte.id);
  const { data: sur, error: e3 } = await nueva('Sur');
  ok(!e3 && sur, 'desactivada la primera, crea otra en su lugar');
  const { error: e4 } = await dueno.from('branches').update({ is_active: true }).eq('id', norte.id);
  ok(Boolean(e4), 'y no puede reactivar la vieja por encima del tope');
  const { error: eBorrar } = await dueno.from('branches').delete().eq('id', sur.id);
  ok(!eBorrar, `la borra — ${eBorrar?.message || 'ok'}`);
  const { error: e5 } = await dueno.from('branches').update({ is_active: true }).eq('id', norte.id);
  ok(!e5, 'y vuelve a tener lugar para reactivar la vieja');

  console.log('Sacar el extra no borra nada:');
  await plataforma.from('businesses').update({ extra_sucursales: 0 }).eq('id', biz.id);
  const { data: activas } = await admin.from('branches').select('id').eq('business_id', biz.id).eq('is_active', true);
  ok(activas.length === 2, 'las dos activas siguen');
  const { error: e6 } = await nueva('Oeste');
  ok(Boolean(e6), 'pero no puede sumar');

  console.log('Profesionales (tope de interfaz, el dato se guarda igual):');
  const { data: dPr, error: ePr } = await plataforma.from('businesses').update({ extra_profesionales: 2 }).eq('id', biz.id).select('extra_profesionales');
  ok(!ePr && dPr?.[0]?.extra_profesionales === 2, 'la plataforma le da +2 profesionales');
  const { error: ePrD } = await dueno.from('businesses').update({ extra_profesionales: 5 }).eq('id', biz.id);
  ok(Boolean(ePrD), 'el dueño no se los cambia');

  await admin.from('businesses').delete().eq('id', biz.id);
  console.log(`\n${pasaron} ok, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
