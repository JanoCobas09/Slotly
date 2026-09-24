// Prueba de punta a punta de create-appointment y get-busy-slots contra el
// stack local (`npx supabase start` + `npx supabase functions serve`).
// Mismo espíritu que test-claims.mjs y scripts/test-reservas-emulador.mjs
// del lado de Firebase: cuentas reales, HTTP real, sin mocks.
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

async function signIn(email, password) {
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

async function createConfirmedUser(email, password, appMetadata = {}) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  return data.user;
}

/**
 * Bug real encontrado corriendo esto de madrugada: mezclaba el día de la
 * semana en huso HORARIO LOCAL de la máquina (`getDay()`) con la fecha en
 * UTC (`toISOString()`) — cerca de la medianoche UTC, con una máquina en
 * un huso detrás de UTC (como Argentina, UTC-3), esas dos "hoy" no
 * coinciden, y el lunes calculado terminaba siendo martes de verdad. Todo
 * en UTC de punta a punta, mismo criterio que dia_de_la_semana() del lado
 * de la base.
 */
function proximoLunes() {
  const hoy = new Date();
  const isoDowUTC = hoy.getUTCDay() === 0 ? 7 : hoy.getUTCDay(); // 1=lunes..7=domingo
  const dias = (8 - isoDowUTC) % 7 || 7; // si hoy es lunes, el PRÓXIMO (no hoy)
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias));
  return d.toISOString().slice(0, 10);
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const clienteEmail = `cliente-edge-${suffix}@example.com`;

  await admin.from('businesses').insert({
    id: bizId, name: 'Negocio Edge Test', slug: `negocio-edge-${suffix}`,
    business_hours: [{ dayOfWeek: 0, startTime: '08:00', endTime: '20:00', isActive: true }],
  });
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Prof Edge' });
  await admin.from('professional_services').insert({ business_id: bizId, professional_id: profId, service_id: srvId });
  await admin.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 0, start_time: '09:00', end_time: '18:00' });
  const cliente = await createConfirmedUser(clienteEmail, 'Password123!', {});
  const clienteToken = await signIn(clienteEmail, 'Password123!');

  const fecha = proximoLunes();

  console.log('get-busy-slots, sin turnos todavía:');
  {
    const { status, data } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: profId, appointmentDate: fecha });
    ok(status === 200 && Array.isArray(data.ocupados) && data.ocupados.length === 0, 'devuelve ocupados: [] (200, sin auth)');
  }

  console.log('create-appointment, cliente sin sesión -> 401:');
  {
    const { status } = await callFn('create-appointment', null, {
      businessId: bizId, professionalId: profId, serviceId: srvId, appointmentDate: fecha, startTime: '10:00',
      clientName: 'Cliente', clientPhone: '1112345678',
    });
    ok(status === 401, 'rechazado sin sesión (401)');
  }

  // La búsqueda de Mailpit matchea por tokens, no por dirección exacta — se
  // arranca con el buzón limpio (mismo criterio que test-reminders.mjs).
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

  let turnoId;
  console.log('create-appointment, reserva válida:');
  {
    const { status, data } = await callFn('create-appointment', clienteToken, {
      businessId: bizId, professionalId: profId, serviceId: srvId, appointmentDate: fecha, startTime: '10:00',
      clientName: 'Cliente Edge', clientPhone: '11 1234-5678',
    });
    ok(status === 200 && data.status === 'created' && data.price === 1000 && data.endTime === '10:30', `se crea (200, price=1000, endTime=10:30) — recibido: ${JSON.stringify(data)}`);
    turnoId = data.id;
  }

  console.log('la reserva manda un mail de confirmación al toque (no espera al recordatorio):');
  {
    // mandarConfirmacion corre en segundo plano (EdgeRuntime.waitUntil) para
    // no demorar la respuesta HTTP — se le da un margen antes de mirar Mailpit.
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(clienteEmail)}`);
    const search = await res.json();
    const exactos = (search.messages || []).filter((m) => m.To.some((t) => t.Address === clienteEmail));
    ok(exactos.length === 1, `Mailpit recibió la confirmación — ${JSON.stringify(exactos.length)}`);
    if (exactos.length === 1) {
      ok(exactos[0].Subject.includes('Turno confirmado') && exactos[0].Subject.includes('Negocio Edge Test'), `asunto correcto — "${exactos[0].Subject}"`);
    }
  }

  console.log('get-busy-slots, ahora SÍ muestra el turno recién creado:');
  {
    const { status, data } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: profId, appointmentDate: fecha });
    ok(status === 200 && data.ocupados.length === 1 && data.ocupados[0].startTime === '10:00', `muestra 1 ocupado 10:00-10:30 — recibido: ${JSON.stringify(data)}`);
  }

  console.log('create-appointment, mismo cliente mismo día otra vez -> already-exists:');
  {
    const { status, data } = await callFn('create-appointment', clienteToken, {
      businessId: bizId, professionalId: profId, serviceId: srvId, appointmentDate: fecha, startTime: '15:00',
      clientName: 'Cliente Edge', clientPhone: '11 1234-5678',
    });
    ok(status === 409 && data.error?.code === 'already-exists', `rechazado (409 already-exists) — recibido: ${status} ${JSON.stringify(data)}`);
  }

  console.log('create-appointment, fecha inválida -> invalid-argument:');
  {
    const { status, data } = await callFn('create-appointment', clienteToken, {
      businessId: bizId, professionalId: profId, serviceId: srvId, appointmentDate: '2020-01-01', startTime: '10:00',
      clientName: 'Cliente Edge', clientPhone: '11 1234-5678',
    });
    ok(status === 400 && data.error?.code === 'invalid-argument', `rechazado (400 invalid-argument) — recibido: ${status} ${JSON.stringify(data)}`);
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);

  // Limpieza
  await admin.from('appointments').delete().eq('business_id', bizId);
  await admin.from('schedules').delete().eq('business_id', bizId);
  await admin.from('professional_services').delete().eq('business_id', bizId);
  await admin.from('professionals').delete().eq('business_id', bizId);
  await admin.from('services').delete().eq('business_id', bizId);
  await admin.from('businesses').delete().eq('id', bizId);
  await admin.auth.admin.deleteUser(cliente.id);

  process.exit(fallaron > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
