// El aviso de cancelación dice quién canceló (cliente, dueño o profesional),
// contra el stack local (`npx supabase start`; no hacen falta las funciones:
// todo pasa en los triggers). Cuentas reales, UPDATE real desde cada sesión.
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
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Cancela', slug: `negocio-cancela-${suffix}` });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Pedro' });

  const dueno = await usuario('dueno-cancela', { business_id: bizId, role: 'owner' });
  await admin.from('admins').insert({ business_id: bizId, email: dueno.email, name: 'Jano', role: 'owner' });
  const profesional = await usuario('prof-cancela', { business_id: bizId, role: 'admin', professional_id: profId });
  const cliente = await usuario('cliente-cancela');

  let hora = 9;
  async function turno() {
    const { data, error } = await admin.from('appointments').insert({
      business_id: bizId, professional_id: profId, user_id: cliente.id, appointment_date: '2099-01-10',
      start_time: `${String(hora++).padStart(2, '0')}:00`, client_name: 'Juan', service_name: 'Corte', type: 'client',
    }).select('id').single();
    if (error) throw error;
    return data.id;
  }
  async function avisoDe(id) {
    const { data } = await admin.from('notifications').select('title, body').eq('appointment_id', id).eq('type', 'turno_cancelado');
    return data || [];
  }
  const filaDe = async (id) => (await admin.from('appointments').select('cancelled_by, cancelled_by_name, cancelled_at').eq('id', id).single()).data;

  console.log('Cancela el cliente:');
  {
    const id = await turno();
    const { error } = await cliente.db.from('appointments').update({ status: 'cancelada', cancelled_by: 'client' }).eq('id', id);
    const avisos = await avisoDe(id);
    ok(!error && avisos.length === 1 && avisos[0].body === 'Juan canceló Corte · 10/01 09:00', `"Juan canceló Corte…" — ${JSON.stringify(error || avisos)}`);
  }

  console.log('Cancela el dueño desde la agenda de Inicio (solo status, sin cancelled_by — el bug):');
  {
    const id = await turno();
    const { error } = await dueno.db.from('appointments').update({ status: 'cancelada' }).eq('id', id);
    const avisos = await avisoDe(id);
    ok(!error && avisos.length === 1 && avisos[0].title === 'Turno cancelado por el negocio'
      && avisos[0].body.startsWith('Cancelado por el dueño (Jano): turno de Juan'), `dice que canceló el dueño — ${JSON.stringify(error || avisos)}`);
    const f = await filaDe(id);
    ok(f.cancelled_by === 'staff' && f.cancelled_at, `queda cancelled_by=staff con fecha — ${JSON.stringify(f)}`);
  }

  console.log('El dueño no puede hacerse pasar por el cliente (manda cancelled_by=client):');
  {
    const id = await turno();
    await dueno.db.from('appointments').update({ status: 'cancelada', cancelled_by: 'client' }).eq('id', id);
    const avisos = await avisoDe(id);
    ok(avisos.length === 1 && avisos[0].body.startsWith('Cancelado por el dueño'), `igual dice el dueño — ${JSON.stringify(avisos)}`);
  }

  console.log('Cancela el profesional:');
  {
    const id = await turno();
    const { error } = await profesional.db.from('appointments').update({ status: 'cancelada', cancelled_by: 'staff' }).eq('id', id);
    const avisos = await avisoDe(id);
    ok(!error && avisos.length === 1 && avisos[0].body.startsWith('Cancelado por Pedro (profesional): turno de Juan'), `dice Pedro (profesional) — ${JSON.stringify(error || avisos)}`);
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
