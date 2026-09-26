// Sucursales, contra el stack local (`npx supabase start` + `npx supabase
// functions serve`). Ver supabase/migrations/20261009000000_sucursales.sql.
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
  return { id: data.user.id, email, ...(await sesion(email)) };
}
async function sesion(email) {
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (error) throw error;
  const db = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
  return { token: s.session.access_token, db };
}
async function callFn(name, token, body) {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** Próximo lunes (UTC), igual que test-appointments.mjs. */
function proximoLunes() {
  const hoy = new Date();
  const iso = hoy.getUTCDay() === 0 ? 7 : hoy.getUTCDay();
  const dias = (8 - iso) % 7 || 7;
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias)).toISOString().slice(0, 10);
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const todos = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true }));

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Sucursales', slug: `negocio-suc-${suffix}`, business_hours: todos });

  console.log('Sucursal principal automática:');
  const { data: principal } = await admin.from('branches').select('*').eq('business_id', bizId).eq('is_main', true).single();
  ok(Boolean(principal) && principal.business_hours === null, `el negocio nuevo nace con su "Principal", sin horario propio (hereda) — ${principal?.name}`);

  const dueno = await usuario('dueno-suc', { business_id: bizId, role: 'owner' });

  console.log('El dueño crea una sucursal con horario propio (lunes 14 a 18):');
  const { data: norte, error: eNorte } = await dueno.db.from('branches').insert({
    business_id: bizId, name: 'Norte', address: 'Av. Norte 123',
    business_hours: todos.map((d) => (d.dayOfWeek === 0 ? { ...d, startTime: '14:00', endTime: '18:00' } : d)),
  }).select('*').single();
  ok(!eNorte && norte?.name === 'Norte', `creada — ${eNorte?.message || 'ok'}`);

  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Pedro' });
  await admin.from('professional_services').insert({ business_id: bizId, professional_id: profId, service_id: srvId });
  // Lunes: 9 a 13 en la principal, 15 a 19 en Norte (que cierra a las 18).
  const { error: eSch } = await dueno.db.from('schedules').insert([
    { business_id: bizId, professional_id: profId, day_of_week: 0, start_time: '09:00', end_time: '13:00' },
    { business_id: bizId, professional_id: profId, day_of_week: 0, start_time: '15:00', end_time: '19:00', branch_id: norte.id },
  ]);
  ok(!eSch, `franjas en dos sucursales — ${eSch?.message || 'ok'}`);
  const { data: franjas } = await admin.from('schedules').select('start_time, branch_id').eq('professional_id', profId).order('start_time');
  ok(franjas?.[0]?.branch_id === principal.id, 'la franja sin sucursal va a la principal');

  await dueno.db.from('branch_service_prices').insert({ business_id: bizId, branch_id: norte.id, service_id: srvId, price: 2000 });

  const lunes = proximoLunes();
  const reservar = async (hora) => {
    const c = await usuario('cliente-suc');
    return admin.rpc('create_appointment', {
      p_business_id: bizId, p_professional_id: profId, p_service_id: srvId, p_appointment_date: lunes,
      p_start_time: hora, p_client_name: 'Cliente', p_client_phone: '1112345678', p_client_email: c.email, p_notes: '', p_user_id: c.id,
    });
  };

  console.log('Reservar: la sucursal y el precio salen de la franja:');
  const t10 = await reservar('10:00');
  ok(!t10.error && t10.data.branch_id === principal.id && Number(t10.data.price) === 1000, `10:00 → Principal, $1000 — ${t10.error?.message || ''}`);
  const t16 = await reservar('16:00');
  ok(!t16.error && t16.data.branch_id === norte.id && Number(t16.data.price) === 2000, `16:00 → Norte, precio de la sucursal $2000 — ${t16.error?.message || ''}`);
  const t1830 = await reservar('18:30');
  ok(Boolean(t1830.error) && /fuera del horario/.test(t1830.error.message), `18:30 → rechazado: Norte cierra a las 18 aunque la franja siga — ${t1830.error?.message}`);

  console.log('Día bloqueado solo en Norte:');
  await dueno.db.from('blocked_days').insert({ business_id: bizId, date: lunes, start_time: '16:30', end_time: '17:30', branch_id: norte.id });
  const tBloq = await reservar('17:00');
  ok(Boolean(tBloq.error) && /no atiende/.test(tBloq.error.message), `17:00 en Norte → rechazado — ${tBloq.error?.message}`);
  const t11 = await reservar('11:00');
  ok(!t11.error, 'el mismo día, en la principal → se puede');

  console.log('El dueño asigna un administrador a Norte (Edge Function):');
  const managerEmail = `manager-suc-${suffix}@example.com`;
  await admin.auth.admin.createUser({ email: managerEmail, password: 'Password123!', email_confirm: true });
  const asignar = await callFn('set-business-admin', dueno.token, { email: managerEmail, businessId: bizId, role: 'manager', branchId: norte.id, name: 'Ana' });
  ok(asignar.status === 200 && asignar.data.status === 'applied', `asignado — ${JSON.stringify(asignar.data)}`);
  const sinSucursal = await callFn('set-business-admin', dueno.token, { email: `x-${suffix}@example.com`, businessId: bizId, role: 'manager' });
  ok(sinSucursal.status === 400, 'sin sucursal → rechazado (400)');
  const manager = await sesion(managerEmail);

  console.log('El administrador de Norte:');
  const { data: vistos } = await manager.db.from('appointments').select('id, branch_id').eq('business_id', bizId);
  ok((vistos || []).length > 0 && vistos.every((a) => a.branch_id === norte.id), `ve SOLO los turnos de Norte — ${vistos?.length}`);
  const { data: tocado } = await manager.db.from('appointments').update({ status: 'confirmada' }).eq('id', t10.data.id).select('id');
  ok((tocado || []).length === 0, 'no puede tocar un turno de la principal');
  const { data: confirmado, error: eConf } = await manager.db.from('appointments').update({ status: 'confirmada' }).eq('id', t16.data.id).select('status').single();
  ok(!eConf && confirmado.status === 'confirmada', `confirma un turno de Norte — ${eConf?.message || 'ok'}`);

  const { error: eSchNorte } = await manager.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 2, start_time: '10:00', end_time: '12:00', branch_id: norte.id });
  ok(!eSchNorte, `agrega una franja en Norte — ${eSchNorte?.message || 'ok'}`);
  const { error: eSchPpal } = await manager.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 3, start_time: '10:00', end_time: '12:00', branch_id: principal.id });
  ok(Boolean(eSchPpal), 'no puede agregar una franja en la principal');

  const { error: eBloqN } = await manager.db.from('blocked_days').insert({ business_id: bizId, date: '2099-05-05', branch_id: norte.id });
  ok(!eBloqN, `bloquea un día en Norte — ${eBloqN?.message || 'ok'}`);
  const { error: eBloqT } = await manager.db.from('blocked_days').insert({ business_id: bizId, date: '2099-05-06' });
  ok(Boolean(eBloqT), 'no puede bloquear un día en todo el negocio');

  const { data: hNorte, error: eHor } = await manager.db.from('branches').update({ business_hours: todos }).eq('id', norte.id).select('id');
  ok(!eHor && (hNorte || []).length === 1, `cambia el horario de Norte — ${eHor?.message || 'ok'}`);
  const { error: eNom } = await manager.db.from('branches').update({ name: 'Otro nombre' }).eq('id', norte.id);
  ok(Boolean(eNom), 'no puede cambiar el nombre de la sucursal');
  const { data: hPpal } = await manager.db.from('branches').update({ business_hours: todos }).eq('id', principal.id).select('id');
  ok((hPpal || []).length === 0, 'no puede tocar la principal');

  const { data: avisos } = await manager.db.from('notifications').select('branch_id').eq('business_id', bizId);
  ok((avisos || []).length > 0 && avisos.every((n) => n.branch_id === norte.id), `ve solo los avisos de Norte — ${avisos?.length}`);

  const { data: cancelado } = await manager.db.from('appointments').update({ status: 'cancelada' }).eq('id', t16.data.id).select('cancelled_by, cancelled_by_name').single();
  ok(cancelado?.cancelled_by === 'staff' && /administrador de la sucursal Norte/.test(cancelado?.cancelled_by_name || ''), `al cancelar queda quién fue — ${JSON.stringify(cancelado)}`);

  console.log('Otras reglas:');
  const { error: eBorrar } = await dueno.db.from('branches').delete().eq('id', principal.id);
  ok(Boolean(eBorrar), 'la principal no se puede borrar');
  const { data: mover } = await dueno.db.from('appointments').update({ start_time: '16:00', end_time: '16:30' }).eq('id', t11.data.id).select('branch_id').single();
  ok(mover?.branch_id === norte.id, 'el dueño mueve un turno a las 16:00 → pasa solo a Norte');

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
