// Cuando el CLIENTE cancela un turno, el dueño del negocio (fila en `admins`
// con role='owner') tiene que recibir un mail — además del push/campanita que
// ya mandaba handle_turno_cancelado. Mismo espíritu que test-appointments.mjs:
// cuentas reales, HTTP real, Mailpit como buzón de prueba.
import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const MAILPIT_URL = 'http://127.0.0.1:55324';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) {
  if (cond) { pasaron++; console.log(`  ok    ${label}`); }
  else { fallaron++; console.log(`  FALLA ${label}`); }
}

async function callFn(name, accessToken, body) {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken || ANON_KEY}`, apikey: ANON_KEY },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function createConfirmedUser(email, password, appMetadata = {}) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  return data.user;
}

async function signIn(email, password) {
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

function proximoLunes() {
  const hoy = new Date();
  const isoDowUTC = hoy.getUTCDay() === 0 ? 7 : hoy.getUTCDay();
  const dias = (8 - isoDowUTC) % 7 || 7;
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias));
  return d.toISOString().slice(0, 10);
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const clienteEmail = `cliente-cancel-${suffix}@example.com`;
  const dueñoEmail = `dueno-cancel-${suffix}@example.com`;

  await admin.from('businesses').insert({
    id: bizId, name: 'Negocio Cancel Test', slug: `negocio-cancel-${suffix}`,
    business_hours: [{ dayOfWeek: 0, startTime: '08:00', endTime: '20:00', isActive: true }],
  });
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Prof Cancel' });
  await admin.from('professional_services').insert({ business_id: bizId, professional_id: profId, service_id: srvId });
  await admin.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 0, start_time: '09:00', end_time: '18:00' });
  await admin.from('admins').insert({ business_id: bizId, email: dueñoEmail, name: 'Dueño Cancel', role: 'owner' });

  const cliente = await createConfirmedUser(clienteEmail, 'Password123!', {});
  const clienteToken = await signIn(clienteEmail, 'Password123!');
  const fecha = proximoLunes();

  const { status, data } = await callFn('create-appointment', clienteToken, {
    businessId: bizId, professionalId: profId, serviceId: srvId, appointmentDate: fecha, startTime: '10:00',
    clientName: 'Cliente Cancel', clientPhone: '11 1234-5678',
  });
  ok(status === 200, `se crea el turno a cancelar — recibido: ${status} ${JSON.stringify(data)}`);
  const turnoId = data.id;

  // create-appointment manda su propio mail de confirmación al cliente en
  // segundo plano (EdgeRuntime.waitUntil) — hay que darle tiempo de llegar
  // ANTES de limpiar el buzón, si no la limpieza puede ganarle la carrera y
  // el mail aparece recién después, ensuciando la búsqueda de más abajo.
  await new Promise((r) => setTimeout(r, 1500));
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

  console.log('cliente cancela su turno:');
  {
    const { error } = await admin
      .from('appointments')
      .update({ status: 'cancelada', cancelled_at: new Date().toISOString(), cancellation_reason: 'Se me complicó', cancelled_by: 'client' })
      .eq('id', turnoId);
    ok(!error, `update de cancelación sin error — ${error?.message || 'ok'}`);
  }

  console.log('el dueño recibe el mail de aviso:');
  {
    // El trigger dispara notify-cancellation vía pg_net, fire-and-forget.
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(dueñoEmail)}`);
    const search = await res.json();
    const exactos = (search.messages || []).filter((m) => m.To.some((t) => t.Address === dueñoEmail));
    ok(exactos.length === 1, `Mailpit recibió el aviso al dueño — ${JSON.stringify(exactos.length)}`);
    if (exactos.length === 1) {
      ok(exactos[0].Subject.includes('Turno cancelado') && exactos[0].Subject.includes('Cliente Cancel'), `asunto correcto — "${exactos[0].Subject}"`);
    }
  }

  console.log('el cliente NO recibe un segundo mail por su propia cancelación:');
  {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(clienteEmail)}`);
    const search = await res.json();
    const exactos = (search.messages || []).filter((m) => m.To.some((t) => t.Address === clienteEmail));
    ok(exactos.length === 0, `buzón del cliente vacío tras la cancelación — ${JSON.stringify(exactos.length)}`);
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);

  await admin.from('appointments').delete().eq('business_id', bizId);
  await admin.from('admins').delete().eq('business_id', bizId);
  await admin.from('schedules').delete().eq('business_id', bizId);
  await admin.from('professional_services').delete().eq('business_id', bizId);
  await admin.from('professionals').delete().eq('business_id', bizId);
  await admin.from('services').delete().eq('business_id', bizId);
  await admin.from('businesses').delete().eq('id', bizId);
  await admin.auth.admin.deleteUser(cliente.id);

  process.exit(fallaron > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
