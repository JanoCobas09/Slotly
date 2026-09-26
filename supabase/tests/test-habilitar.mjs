// Habilitar / suspender una cuenta desde el panel global, contra el stack
// local (`npx supabase start`). Ver 20261014000000_habilitar_cuenta.sql.
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
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (e2) throw e2;
  const db = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
  return { id: data.user.id, email, db };
}

const dia = (delta) => new Date(Date.now() + delta * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
const leer = async (id) => {
  const { data: b } = await admin.from('businesses').select('*').eq('id', id).single();
  const { data: f } = await admin.from('billing').select('*').eq('business_id', id).single();
  return { b, f };
};

/** Próximo lunes (UTC), igual que test-sucursales.mjs. */
function proximoLunes() {
  const hoy = new Date();
  const iso = hoy.getUTCDay() === 0 ? 7 : hoy.getUTCDay();
  const dias = (8 - iso) % 7 || 7;
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias)).toISOString().slice(0, 10);
}

async function main() {
  // Alta self-service con la prueba vencida hace rato, un cobro atrasado,
  // suspendida hace 5 días y sin ningún pago registrado.
  const todos = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '20:00', isActive: true }));
  const { data: biz } = await admin.from('businesses').insert({
    name: 'Cuenta Vencida', slug: `vencida-${Date.now()}`, plan_id: 'pro', whatsapp_quota: 500, business_hours: todos,
    trial_ends_at: dia(-40), is_frozen: true, frozen_at: dia(-5), signup_source: 'self_service',
  }).select('*').single();
  await admin.from('billing').insert({ business_id: biz.id, debt: 22000, monthly_fee: 22000, next_billing_date: dia(-3) });
  const { data: prof } = await admin.from('professionals').insert({ business_id: biz.id, name: 'Ana' }).select('id').single();
  const { data: srv } = await admin.from('services').insert({ business_id: biz.id, name: 'Corte', duration_minutes: 30, price: 1000 }).select('id').single();
  await admin.from('professional_services').insert({ business_id: biz.id, professional_id: prof.id, service_id: srv.id });
  await admin.from('schedules').insert({ business_id: biz.id, professional_id: prof.id, day_of_week: 0, start_time: '09:00', end_time: '13:00' });

  const plataforma = await usuario('plat-hab', { platform: true });
  const moderador = await usuario('mod-hab', { platform: 'moderator' });
  const dueno = await usuario('dueno-hab', { business_id: biz.id, role: 'owner' });

  const reservar = async (hora) => {
    const c = await usuario('cliente-hab');
    return admin.rpc('create_appointment', {
      p_business_id: biz.id, p_professional_id: prof.id, p_service_id: srv.id, p_appointment_date: proximoLunes(),
      p_start_time: hora, p_client_name: 'Cliente', p_client_phone: '1112345678', p_client_email: c.email, p_notes: '', p_user_id: c.id,
    });
  };

  console.log('Suspendida:');
  const r0 = await reservar('09:00');
  ok(Boolean(r0.error), `un cliente no puede reservar — ${r0.error?.message}`);

  console.log('Habilitar:');
  const { error: e1 } = await plataforma.db.rpc('habilitar_cuenta', { p_business_id: biz.id });
  ok(!e1, `la plataforma la habilita — ${e1?.message || 'ok'}`);
  let { b, f } = await leer(biz.id);
  ok(b.is_frozen === false && b.trial_ends_at === null, 'queda activa y sin prueba (el dueño ya no ve "Se terminó tu prueba")');
  ok(b.plan_id === 'pro', 'conserva su plan (Pro)');
  ok(f.next_billing_date >= dia(28) && f.habilitada_hasta === f.next_billing_date && f.habilitada_el === dia(0),
    `próximo cobro y gracia hasta dentro de un mes (${f.next_billing_date})`);
  const r1 = await reservar('09:00');
  ok(!r1.error, `ya se puede reservar — ${r1.error?.message || 'ok'}`);
  const { data: suc, error: eSuc } = await dueno.db.from('branches').insert({ business_id: biz.id, name: 'Segunda' }).select('id').single();
  ok(!eSuc && suc, `el dueño usa lo de su plan: suma una segunda sucursal (Pro permite 3) — ${eSuc?.message || 'ok'}`);

  console.log('El cobro de la noche no la vuelve a suspender:');
  await admin.rpc('process_billing');
  ({ b, f } = await leer(biz.id));
  ok(b.is_frozen === false, 'sigue activa aunque tenga deuda');
  ok(Number(f.debt) === 22000, `no se le suma de nuevo lo atrasado (deuda ${f.debt})`);

  console.log('Pasado el mes, si sigue debiendo:');
  await admin.from('billing').update({ next_billing_date: dia(-1), habilitada_hasta: dia(-1) }).eq('business_id', biz.id);
  await admin.rpc('process_billing');
  ({ b, f } = await leer(biz.id));
  ok(b.is_frozen === true && Number(f.debt) === 44000, `se cobra el mes y se suspende (deuda ${f.debt})`);
  await admin.from('businesses').update({ frozen_at: dia(-10) }).eq('id', biz.id);
  const { data: aBorrar } = await admin.rpc('process_billing');
  ok(!(aBorrar || []).some((r) => r.business_id === biz.id), 'aunque lleve 10 días suspendida, no entra en el borrado automático (la habilitaron a mano)');

  console.log('Quién puede:');
  const { error: e2 } = await moderador.db.rpc('habilitar_cuenta', { p_business_id: biz.id });
  ok(Boolean(e2), 'un moderador no');
  const { error: e3 } = await dueno.db.rpc('habilitar_cuenta', { p_business_id: biz.id });
  ok(Boolean(e3), 'el dueño del negocio no');

  console.log('Suspender:');
  await plataforma.db.rpc('habilitar_cuenta', { p_business_id: biz.id });
  const { error: e4 } = await plataforma.db.rpc('suspender_cuenta', { p_business_id: biz.id });
  ({ b, f } = await leer(biz.id));
  ok(!e4 && b.is_frozen === true && f.habilitada_hasta === null, `la suspende y le corta la gracia — ${e4?.message || 'ok'}`);

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
