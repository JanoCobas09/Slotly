// Plan gratis, contra el stack local (`npx supabase start`). Ver la
// migración 20261013000000_plan_gratis.sql. Cuentas reales con su sesión.
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

const dia = (delta) => new Date(Date.now() + delta * 86400000 - 3 * 3600000).toISOString().slice(0, 10);

/** Un negocio con la prueba vencida, un cobro atrasado y suspendido por deuda. */
async function negocioAtrasado(nombre) {
  const { data: b, error } = await admin.from('businesses').insert({
    name: nombre, slug: `${nombre.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`,
    plan_id: 'basico', whatsapp_quota: 100, trial_ends_at: dia(-40), is_frozen: true, frozen_at: dia(-5),
    signup_source: 'self_service',
  }).select('*').single();
  if (error) throw error;
  await admin.from('billing').insert({ business_id: b.id, debt: 12000, monthly_fee: 12000, next_billing_date: dia(-3) });
  return b;
}
const leer = async (id) => {
  const { data: b } = await admin.from('businesses').select('*').eq('id', id).single();
  const { data: f } = await admin.from('billing').select('*').eq('business_id', id).single();
  return { b, f };
};

async function main() {
  const plataforma = await usuario('plat-gratis', { platform: true });
  const moderador = await usuario('mod-gratis', { platform: 'moderator' });

  console.log('Dar plan gratis:');
  const regalo = await negocioAtrasado('Regalado');
  const control = await negocioAtrasado('Control');
  const { error: e1 } = await plataforma.rpc('cambiar_plan', {
    p_business_id: regalo.id, p_plan_id: 'business', p_whatsapp_quota: 1000, p_monthly_fee: 35000, p_gratis: true,
  });
  ok(!e1, `la plataforma le da el plan Business gratis — ${e1?.message || 'ok'}`);
  let { b, f } = await leer(regalo.id);
  ok(b.plan_gratis === true && b.plan_id === 'business' && b.whatsapp_quota === 1000, 'queda con el plan Business marcado como gratis');
  ok(b.is_frozen === false && b.trial_ends_at === null, 'se descongela y termina la prueba');
  ok(Number(f.debt) === 0 && Number(f.monthly_fee) === 0 && f.next_billing_date === null, 'deuda perdonada, abono $0, sin vencimiento');

  console.log('El cobro diario lo saltea:');
  await admin.rpc('process_billing');
  ({ b, f } = await leer(regalo.id));
  ok(b.is_frozen === false && Number(f.debt) === 0, 'sigue activo y sin deuda después del cobro');
  const c = await leer(control.id);
  ok(c.b.is_frozen === true && Number(c.f.debt) === 24000, `un negocio sin plan gratis en la misma situación sí se cobra (deuda ${c.f.debt})`);

  console.log('Quién puede:');
  const dueno = await usuario('dueno-gratis', { business_id: control.id, role: 'owner' });
  const { error: e2 } = await dueno.from('businesses').update({ plan_gratis: true }).eq('id', control.id);
  ok(Boolean(e2), 'el dueño no se puede poner el plan gratis solo');
  const { error: e3 } = await dueno.rpc('cambiar_plan', { p_business_id: control.id, p_plan_id: 'business', p_whatsapp_quota: 1000, p_monthly_fee: 0, p_gratis: true });
  ok(Boolean(e3), 'ni con cambiar_plan');
  const { error: e4 } = await moderador.rpc('cambiar_plan', { p_business_id: control.id, p_plan_id: 'business', p_whatsapp_quota: 1000, p_monthly_fee: 0, p_gratis: true });
  ok(Boolean(e4), 'un moderador tampoco');

  console.log('Sacar el plan gratis:');
  const { error: e5 } = await plataforma.rpc('cambiar_plan', {
    p_business_id: regalo.id, p_plan_id: 'pro', p_whatsapp_quota: 500, p_monthly_fee: 22000, p_gratis: false,
  });
  ok(!e5, `pasa a Pro pago — ${e5?.message || 'ok'}`);
  ({ b, f } = await leer(regalo.id));
  ok(b.plan_gratis === false && b.plan_id === 'pro' && Number(f.monthly_fee) === 22000, 'plan Pro con abono $22.000');
  ok(f.next_billing_date === dia(30) || f.next_billing_date === dia(31) || f.next_billing_date === dia(28) || f.next_billing_date === dia(29),
    `el primer cobro es dentro de un mes (${f.next_billing_date})`);
  await admin.rpc('process_billing');
  ({ b, f } = await leer(regalo.id));
  ok(b.is_frozen === false && Number(f.debt) === 0, 'no se le cobra retroactivo lo que fue gratis');

  console.log('Un cambio de plan común (sin gratis) sigue andando:');
  const { error: e6 } = await plataforma.rpc('cambiar_plan', {
    p_business_id: control.id, p_plan_id: 'pro', p_whatsapp_quota: 500, p_monthly_fee: 22000, p_gratis: false,
  });
  const c2 = await leer(control.id);
  ok(!e6 && c2.b.plan_id === 'pro' && Number(c2.f.monthly_fee) === 22000 && Number(c2.f.debt) === 24000,
    `cambia plan y abono, la deuda queda como estaba — ${e6?.message || 'ok'}`);

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
