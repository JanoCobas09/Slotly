// Avisos de la plataforma a los dueños, contra el stack local (`npx supabase
// start`). Ver la migración 20261015000000_avisos_plataforma.sql.
import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anonimo = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) {
  if (cond) { pasaron++; console.log(`  ok    ${label}`); }
  else { fallaron++; console.log(`  FALLA ${label}`); }
}

async function usuario(prefijo, appMetadata = {}) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (e2) throw e2;
  const c = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
  c.uid = u.user.id;
  return c;
}

async function negocio(nombre) {
  const { data, error } = await admin.from('businesses').insert({
    name: nombre, slug: `${nombre.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}`, plan_id: 'basico', whatsapp_quota: 100,
  }).select('*').single();
  if (error) throw error;
  return data;
}

async function main() {
  const bizA = await negocio('Avisos A');
  const bizB = await negocio('Avisos B');
  const plataforma = await usuario('plat-avisos', { platform: true });
  const moderador = await usuario('mod-avisos', { platform: 'moderator' });
  const duenoA = await usuario('dueno-a-avisos', { business_id: bizA.id, role: 'owner' });
  const duenoB = await usuario('dueno-b-avisos', { business_id: bizB.id, role: 'owner' });
  const staffA = await usuario('staff-a-avisos', { business_id: bizA.id, role: 'admin' });
  const cliente = await usuario('cliente-avisos');

  console.log('Quién escribe:');
  const { data: aviso, error: e1 } = await plataforma.from('avisos_plataforma')
    .insert({ titulo: 'Mantenimiento', mensaje: 'El domingo a la madrugada.' }).select('*').single();
  ok(!e1 && aviso?.activo === true, `la plataforma crea un aviso — ${e1?.message || 'ok'}`);
  const { error: e2 } = await moderador.from('avisos_plataforma').insert({ titulo: 'x', mensaje: 'y' });
  ok(Boolean(e2), 'un moderador no puede crear');
  const { error: e3 } = await duenoA.from('avisos_plataforma').insert({ titulo: 'x', mensaje: 'y' });
  ok(Boolean(e3), 'un dueño no puede crear');
  const { data: upd } = await duenoA.from('avisos_plataforma').update({ activo: false }).eq('id', aviso.id).select('id');
  ok((upd || []).length === 0, 'un dueño no puede archivarlo');
  const { error: e4 } = await plataforma.from('avisos_plataforma').insert({ titulo: '   ', mensaje: 'y' });
  ok(/avisos_plataforma_titulo_valido/.test(e4?.message || ''), 'título vacío rechazado');

  console.log('Quién lee:');
  const lee = async (c) => ((await c.from('avisos_plataforma').select('id').eq('id', aviso.id)).data || []).length === 1;
  ok(await lee(duenoA), 'el dueño lo ve');
  ok(await lee(moderador), 'el moderador lo ve');
  ok(!(await lee(staffA)), 'el staff no lo ve');
  ok(!(await lee(cliente)), 'un cliente no lo ve');
  ok(!(await lee(anonimo)), 'sin sesión no se ve');

  console.log('Aceptar:');
  const { error: e5 } = await duenoA.from('avisos_aceptados')
    .upsert({ aviso_id: aviso.id }, { onConflict: 'aviso_id,user_id', ignoreDuplicates: true });
  ok(!e5, `el dueño A lo acepta — ${e5?.message || 'ok'}`);
  const { error: e6 } = await duenoA.from('avisos_aceptados')
    .upsert({ aviso_id: aviso.id }, { onConflict: 'aviso_id,user_id', ignoreDuplicates: true });
  ok(!e6, `aceptarlo dos veces no es error — ${e6?.message || 'ok'}`);
  const { data: filaA } = await admin.from('avisos_aceptados').select('*').eq('aviso_id', aviso.id).eq('user_id', duenoA.uid);
  ok(filaA?.length === 1 && filaA[0].business_id === bizA.id, 'queda una sola fila, con su negocio');
  const { error: e7 } = await duenoA.from('avisos_aceptados').insert({ aviso_id: aviso.id, user_id: duenoB.uid, business_id: bizB.id });
  ok(Boolean(e7), 'no puede aceptar en nombre de otro dueño');
  const { error: e8 } = await staffA.from('avisos_aceptados').insert({ aviso_id: aviso.id });
  ok(Boolean(e8), 'el staff no puede aceptar');

  console.log('Quién ve las aceptaciones:');
  const { data: vistasB } = await duenoB.from('avisos_aceptados').select('*').eq('aviso_id', aviso.id);
  ok((vistasB || []).length === 0, 'el dueño B no ve la aceptación del A');
  const { data: vistasPlat } = await plataforma.from('avisos_aceptados').select('*').eq('aviso_id', aviso.id);
  ok((vistasPlat || []).length === 1, 'la plataforma la ve');

  console.log('Archivar y borrar:');
  const { error: e9 } = await plataforma.from('avisos_plataforma').update({ activo: false }).eq('id', aviso.id);
  const { data: archivado } = await duenoB.from('avisos_plataforma').select('activo').eq('id', aviso.id).single();
  ok(!e9 && archivado?.activo === false, 'archivado: el dueño lo sigue leyendo, marcado inactivo (el cartel lo filtra)');
  const { error: e10 } = await plataforma.from('avisos_plataforma').delete().eq('id', aviso.id);
  const { data: resto } = await admin.from('avisos_aceptados').select('id').eq('aviso_id', aviso.id);
  ok(!e10 && (resto || []).length === 0, 'al borrarlo se borran sus aceptaciones');

  await admin.from('businesses').delete().in('id', [bizA.id, bizB.id]);

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
