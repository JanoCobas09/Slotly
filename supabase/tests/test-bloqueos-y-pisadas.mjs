// Bloqueos del profesional + un profesional nunca en dos lugares a la vez,
// contra el stack local (`npx supabase start`). Ver la migración
// 20261011000000_bloqueos_profesional_y_sin_pisarse.sql.
// Cuentas reales, escribiendo con la sesión de cada rol.
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

/** Próximo lunes (UTC), igual que test-sucursales.mjs. */
function proximoLunes() {
  const hoy = new Date();
  const iso = hoy.getUTCDay() === 0 ? 7 : hoy.getUTCDay();
  const dias = (8 - iso) % 7 || 7;
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias)).toISOString().slice(0, 10);
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const pedro = crypto.randomUUID();
  const ana = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const todos = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '21:00', isActive: true }));

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Pisadas', slug: `negocio-pis-${suffix}`, business_hours: todos, plan_id: 'pro' });
  const { data: principal } = await admin.from('branches').select('*').eq('business_id', bizId).eq('is_main', true).single();
  const { data: norte } = await admin.from('branches').insert({ business_id: bizId, name: 'Norte' }).select('*').single();
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });
  await admin.from('professionals').insert([{ id: pedro, business_id: bizId, name: 'Pedro' }, { id: ana, business_id: bizId, name: 'Ana' }]);
  await admin.from('professional_services').insert([
    { business_id: bizId, professional_id: pedro, service_id: srvId },
    { business_id: bizId, professional_id: ana, service_id: srvId },
  ]);

  const dueno = await usuario('dueno-pis', { business_id: bizId, role: 'owner' });
  const gerenteNorte = await usuario('gerente-pis', { business_id: bizId, role: 'manager', branch_id: norte.id });
  const profPedro = await usuario('pedro-pis', { business_id: bizId, role: 'admin', professional_id: pedro });

  console.log('Horarios: un profesional no se pisa entre sucursales:');
  const { error: e1 } = await dueno.db.from('schedules').insert({ business_id: bizId, professional_id: pedro, day_of_week: 0, start_time: '09:00', end_time: '13:00', branch_id: principal.id });
  ok(!e1, `lunes 9 a 13 en la principal — ${e1?.message || 'ok'}`);
  const { error: e2 } = await gerenteNorte.db.from('schedules').insert({ business_id: bizId, professional_id: pedro, day_of_week: 0, start_time: '12:00', end_time: '15:00', branch_id: norte.id });
  ok(Boolean(e2) && /se pisa/.test(e2.message), `el administrador de Norte le pone 12 a 15 → rechazado — ${e2?.message}`);
  const { error: e3 } = await gerenteNorte.db.from('schedules').insert({ business_id: bizId, professional_id: pedro, day_of_week: 0, start_time: '13:00', end_time: '17:00', branch_id: norte.id });
  ok(!e3, `13 a 17 en Norte (pegado, sin pisarse) → se puede — ${e3?.message || 'ok'}`);
  const { error: e4 } = await dueno.db.from('schedules').insert([
    { business_id: bizId, professional_id: ana, day_of_week: 1, start_time: '09:00', end_time: '12:00' },
    { business_id: bizId, professional_id: ana, day_of_week: 1, start_time: '11:00', end_time: '14:00', branch_id: norte.id },
  ]);
  ok(Boolean(e4) && /se pisa/.test(e4.message), `dos franjas pisadas en el mismo lote → rechazado — ${e4?.message}`);
  await dueno.db.from('schedules').insert({ business_id: bizId, professional_id: ana, day_of_week: 0, start_time: '09:00', end_time: '17:00', branch_id: norte.id });

  const lunes = proximoLunes();

  console.log('Turnos cargados a mano: tampoco se pisan entre sucursales:');
  const manual = (db, prof, desde, hasta, extra = {}) => db.from('appointments').insert({
    business_id: bizId, professional_id: prof, service_id: srvId, appointment_date: lunes,
    start_time: desde, end_time: hasta, status: 'pendiente', type: 'manual', client_name: 'X', price: 1000, user_id: dueno.id, ...extra,
  }).select('id').single();
  const m1 = await manual(dueno.db, pedro, '10:00', '10:30');
  ok(!m1.error, `el dueño agenda a Pedro 10:00 — ${m1.error?.message || 'ok'}`);
  const m2 = await manual(dueno.db, pedro, '10:15', '10:45', { branch_id: norte.id });
  ok(Boolean(m2.error) && /ya tiene un turno/.test(m2.error.message), `otro turno de Pedro 10:15 en Norte → rechazado — ${m2.error?.message}`);
  const m3 = await manual(dueno.db, pedro, '10:30', '11:00');
  ok(!m3.error, `10:30 (pegado) → se puede — ${m3.error?.message || 'ok'}`);
  const m4 = await manual(dueno.db, pedro, '10:00', '10:30', { type: 'walkin' });
  ok(!m4.error, `un "servicio sin turno" a la misma hora → se registra igual — ${m4.error?.message || 'ok'}`);
  await admin.from('appointments').update({ status: 'cancelada' }).eq('id', m3.data.id);
  const m5 = await manual(dueno.db, pedro, '10:30', '11:00', { branch_id: norte.id });
  ok(!m5.error, `cancelado el de las 10:30, el horario se libera (ahora en Norte) — ${m5.error?.message || 'ok'}`);
  const m6 = await manual(dueno.db, pedro, '10:00', '10:30', { branch_id: norte.id });
  ok(Boolean(m6.error), 'el "servicio sin turno" de las 10:00 sí ocupa ese horario');

  console.log('Bloqueos: quién puede cargar cada alcance:');
  const bloq = (db, fila) => db.from('blocked_days').insert({ business_id: bizId, date: lunes, ...fila }).select('id').single();
  const b1 = await bloq(profPedro.db, { professional_id: pedro, start_time: '14:00', end_time: '16:00' });
  ok(!b1.error, `Pedro se bloquea 14 a 16 — ${b1.error?.message || 'ok'}`);
  const b2 = await bloq(profPedro.db, { professional_id: ana });
  ok(Boolean(b2.error), 'Pedro no puede bloquear a Ana');
  const b3 = await bloq(profPedro.db, {});
  ok(Boolean(b3.error), 'Pedro no puede bloquear todo el negocio');
  const b4 = await bloq(profPedro.db, { professional_id: pedro, branch_id: norte.id, start_time: '18:00', end_time: '19:00' });
  ok(Boolean(b4.error), 'el bloqueo de un profesional no lleva sucursal');
  const b5 = await bloq(gerenteNorte.db, { branch_id: principal.id });
  ok(Boolean(b5.error), 'el administrador de Norte no bloquea la principal');
  const b6 = await bloq(gerenteNorte.db, { professional_id: pedro });
  ok(Boolean(b6.error), 'el administrador de Norte no bloquea a un profesional');
  const b7 = await bloq(gerenteNorte.db, { branch_id: norte.id, start_time: '16:00', end_time: '17:00' });
  ok(!b7.error, `el administrador de Norte bloquea su sucursal 16 a 17 — ${b7.error?.message || 'ok'}`);

  console.log('Bloqueos: a quién frenan al reservar:');
  const reservar = async (prof, hora) => {
    const c = await usuario('cliente-pis');
    return admin.rpc('create_appointment', {
      p_business_id: bizId, p_professional_id: prof, p_service_id: srvId, p_appointment_date: lunes,
      p_start_time: hora, p_client_name: 'Cliente', p_client_phone: '1112345678', p_client_email: c.email, p_notes: '', p_user_id: c.id,
    });
  };
  const r1 = await reservar(pedro, '14:30');
  ok(Boolean(r1.error) && /profesional no atiende/.test(r1.error.message), `Pedro 14:30 (su bloqueo) → rechazado — ${r1.error?.message}`);
  const r2 = await reservar(ana, '14:30');
  ok(!r2.error && r2.data.branch_id === norte.id, `Ana 14:30 en Norte → se puede: el bloqueo de Pedro no cierra la sucursal — ${r2.error?.message || 'ok'}`);
  const r3 = await reservar(ana, '16:00');
  ok(Boolean(r3.error) && /negocio no atiende/.test(r3.error.message), `Ana 16:00 en Norte (bloqueo de la sucursal) → rechazado — ${r3.error?.message}`);
  const r4 = await reservar(pedro, '11:00');
  ok(!r4.error && r4.data.branch_id === principal.id, `Pedro 11:00 en la principal (el bloqueo de Norte no la toca) → se puede — ${r4.error?.message || 'ok'}`);

  console.log(`\n${pasaron} ok, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
