// Avisos por WhatsApp (marcas de enviado), contra el stack local (`npx
// supabase start`). Ver 20261017000000_avisos_whatsapp.sql.
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

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const otroProfId = crypto.randomUUID();
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio WhatsApp', slug: `negocio-wa-${suffix}` });
  await admin.from('professionals').insert([
    { id: profId, business_id: bizId, name: 'Pedro' },
    { id: otroProfId, business_id: bizId, name: 'Laura' },
  ]);

  const dueno = await usuario('dueno-wa', { business_id: bizId, role: 'owner' });
  const profesional = await usuario('prof-wa', { business_id: bizId, role: 'admin', professional_id: profId });
  const otroProfesional = await usuario('prof2-wa', { business_id: bizId, role: 'admin', professional_id: otroProfId });
  const cliente = await usuario('cliente-wa');

  let hora = 9;
  async function turno() {
    const { data, error } = await admin.from('appointments').insert({
      business_id: bizId, professional_id: profId, user_id: cliente.id, appointment_date: '2099-01-10',
      start_time: `${String(hora++).padStart(2, '0')}:00`, client_name: 'Juan', client_phone: '1123456789', service_name: 'Corte', type: 'client',
    }).select('id').single();
    if (error) throw error;
    return data.id;
  }
  const fila = async (id) => (await admin.from('appointments').select('*').eq('id', id).single()).data;
  const ahora = () => new Date().toISOString();

  console.log('Quién marca:');
  const id = await turno();
  const { error: e1 } = await dueno.db.from('appointments').update({ whatsapp_confirmacion_at: ahora() }).eq('id', id);
  ok(!e1 && (await fila(id)).whatsapp_confirmacion_at, `el dueño marca la confirmación — ${e1?.message || 'ok'}`);
  const { error: e2 } = await profesional.db.from('appointments').update({ whatsapp_recordatorio_at: ahora() }).eq('id', id);
  ok(!e2 && (await fila(id)).whatsapp_recordatorio_at, `el profesional del turno marca el recordatorio — ${e2?.message || 'ok'}`);

  const id2 = await turno();
  await otroProfesional.db.from('appointments').update({ whatsapp_confirmacion_at: ahora() }).eq('id', id2);
  ok(!(await fila(id2)).whatsapp_confirmacion_at, 'otro profesional no puede marcar un turno ajeno');
  const { error: e3 } = await cliente.db.from('appointments').update({ whatsapp_confirmacion_at: ahora() }).eq('id', id2);
  ok(Boolean(e3) && !(await fila(id2)).whatsapp_confirmacion_at, `el cliente no se lo marca — ${e3?.message}`);
  const { error: e4 } = await cliente.db.from('appointments').update({ status: 'cancelada', cancelled_by: 'client', whatsapp_recordatorio_at: ahora() }).eq('id', id2);
  ok(Boolean(e4), 'ni de paso al cancelar');
  const { error: e5 } = await cliente.db.from('appointments').update({ status: 'cancelada', cancelled_by: 'client' }).eq('id', id2);
  ok(!e5, `cancelar sin tocar los avisos sigue andando — ${e5?.message || 'ok'}`);

  console.log('Cambiar día u hora reinicia los avisos:');
  const { error: e6 } = await dueno.db.from('appointments').update({ notes: 'trae a su hijo' }).eq('id', id);
  let f = await fila(id);
  ok(!e6 && f.whatsapp_confirmacion_at && f.whatsapp_recordatorio_at, 'editar otra cosa no los toca');
  const { error: e7 } = await dueno.db.from('appointments').update({ start_time: '18:00', end_time: '18:30' }).eq('id', id);
  f = await fila(id);
  ok(!e7 && !f.whatsapp_confirmacion_at && !f.whatsapp_recordatorio_at, `mover la hora borra las dos marcas — ${e7?.message || 'ok'}`);
  await dueno.db.from('appointments').update({ whatsapp_confirmacion_at: ahora() }).eq('id', id);
  const { error: e8 } = await dueno.db.from('appointments').update({ appointment_date: '2099-01-11' }).eq('id', id);
  f = await fila(id);
  ok(!e8 && !f.whatsapp_confirmacion_at, `mover el día también — ${e8?.message || 'ok'}`);

  await admin.from('businesses').delete().eq('id', bizId);
  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
