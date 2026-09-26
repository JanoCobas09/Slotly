// Principio de privacidad y limpieza de permisos huérfanos, contra el stack
// local (`npx supabase start` + `npx supabase functions serve`). Ver
// 20261012000000_principio_de_privacidad.sql y la función
// limpiar-claims-huerfanos. Cuentas reales, con la sesión de cada rol.
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
async function callFn(name, token) {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: '{}',
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function negocio(nombre, rubro) {
  const { data, error } = await admin.from('businesses')
    .insert({ name: nombre, slug: `${nombre.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`, profession_category: rubro })
    .select('*').single();
  if (error) throw error;
  return data;
}

async function main() {
  console.log('Por defecto según el rubro:');
  const salud = await negocio('Consultorio', 'healthcare');
  const terapias = await negocio('Terapias', 'wellness');
  const estudio = await negocio('Estudio contable', 'professional_services');
  const barberia = await negocio('Barberia', 'beauty');
  ok(salud.privacidad_clientes === true, 'salud → activado');
  ok(terapias.privacidad_clientes === true, 'bienestar y terapias → activado');
  ok(estudio.privacidad_clientes === true, 'servicios profesionales → activado');
  ok(barberia.privacidad_clientes === false, 'belleza → desactivado');

  const turno = async (biz) => {
    const { data: prof } = await admin.from('professionals').insert({ business_id: biz.id, name: 'Dra. López' }).select('id').single();
    const { error } = await admin.from('appointments').insert({
    business_id: biz.id, professional_id: prof.id, appointment_date: '2030-01-07', start_time: '10:00', end_time: '10:30', status: 'confirmada',
    type: 'manual', client_name: 'Juana Secreta', client_phone: '1112345678', client_email: 'juana@example.com', notes: 'Motivo: ansiedad',
    });
    if (error) throw error;
  };
  await turno(salud);
  await turno(barberia);
  await admin.from('notifications').insert([
    { business_id: salud.id, type: 'nuevo_turno', title: 'Nuevo turno', body: 'Juana Secreta reservó' },
    { business_id: barberia.id, type: 'nuevo_turno', title: 'Nuevo turno', body: 'Juana Secreta reservó' },
  ]);

  const plataforma = await usuario('plat-priv', { platform: true });
  const moderador = await usuario('mod-priv', { platform: 'moderator' });
  const duenoSalud = await usuario('dueno-priv', { business_id: salud.id, role: 'owner' });

  console.log('La plataforma y los datos del cliente:');
  const p1 = await plataforma.db.from('appointments').select('client_name').eq('business_id', salud.id);
  ok(!p1.error && p1.data.length === 0, 'negocio con privacidad → la plataforma no lee los turnos');
  const m1 = await moderador.db.from('appointments').select('client_name').eq('business_id', salud.id);
  ok(!m1.error && m1.data.length === 0, `tampoco un moderador — ${m1.error?.message || JSON.stringify(m1.data)}`);
  const p2 = await plataforma.db.from('appointments').select('client_name').eq('business_id', barberia.id);
  ok(p2.data?.[0]?.client_name === 'Juana Secreta', 'negocio sin privacidad → la plataforma los ve como siempre');
  const n1 = await plataforma.db.from('notifications').select('body').eq('business_id', salud.id);
  ok(!n1.error && n1.data.length === 0, 'los avisos (llevan el nombre del cliente) tampoco');

  const r1 = await plataforma.db.rpc('turnos_sin_cliente', { p_business_id: salud.id });
  const fila = r1.data?.[0];
  ok(!r1.error && r1.data.length === 1 && fila.start_time === '10:00', 'turnos_sin_cliente → la plataforma ve el turno (fecha, hora)');
  ok(fila && !('client_name' in fila) && !('client_phone' in fila) && !('client_email' in fila) && !('notes' in fila) && !('user_id' in fila),
    'sin nombre, teléfono, mail, notas ni cuenta del cliente');
  const r2 = await duenoSalud.db.rpc('turnos_sin_cliente', { p_business_id: salud.id });
  ok(!r2.error && r2.data.length === 0, 'turnos_sin_cliente no le sirve a nadie que no sea de la plataforma');

  console.log('El dueño:');
  const d1 = await duenoSalud.db.from('appointments').select('client_name').eq('business_id', salud.id);
  ok(d1.data?.[0]?.client_name === 'Juana Secreta', 've a sus clientes como siempre');
  const c1 = await plataforma.db.from('businesses').update({ privacidad_clientes: false }).eq('id', salud.id);
  ok(Boolean(c1.error) && /Solo el dueño/.test(c1.error.message), `la plataforma no puede desactivarlo — ${c1.error?.message}`);
  const c2 = await duenoSalud.db.from('businesses').update({ privacidad_clientes: false }).eq('id', salud.id).select('privacidad_clientes');
  ok(!c2.error && c2.data?.[0]?.privacidad_clientes === false, `el dueño lo desactiva — ${c2.error?.message || 'ok'}`);
  const p3 = await plataforma.db.from('appointments').select('client_name').eq('business_id', salud.id);
  ok(p3.data?.[0]?.client_name === 'Juana Secreta', 'desactivado, la plataforma vuelve a ver todo');

  console.log('Permisos huérfanos (limpiar-claims-huerfanos):');
  const { data: sucursal } = await admin.from('branches').select('id').eq('business_id', barberia.id).single();
  const gerente = await usuario('gerente-huerfano', { business_id: barberia.id, role: 'manager', branch_id: sucursal.id });
  const vigente = await callFn('limpiar-claims-huerfanos', gerente.token);
  ok(vigente.status === 200 && vigente.data.status === 'ok', `con el negocio vivo no toca nada — ${JSON.stringify(vigente.data)}`);
  await admin.rpc('delete_business_cascade', { p_business_id: barberia.id });
  const huerfano = await callFn('limpiar-claims-huerfanos', gerente.token);
  ok(huerfano.status === 200 && huerfano.data.status === 'cleared', `negocio borrado → se limpian — ${JSON.stringify(huerfano.data)}`);
  const { data: u } = await admin.auth.admin.getUserById(gerente.id);
  ok(!u.user.app_metadata.business_id && !u.user.app_metadata.role && !u.user.app_metadata.branch_id, 'la cuenta queda sin negocio, sin rol y sin sucursal');
  const otro = await usuario('dueno-vivo', { business_id: salud.id, role: 'owner' });
  const noToca = await callFn('limpiar-claims-huerfanos', otro.token);
  const { data: u2 } = await admin.auth.admin.getUserById(otro.id);
  ok(noToca.data.status === 'ok' && u2.user.app_metadata.business_id === salud.id, 'a un dueño con negocio vivo no le toca nada');

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
