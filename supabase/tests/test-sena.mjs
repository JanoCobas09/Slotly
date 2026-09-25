// Seña obligatoria con Mercado Pago, contra el stack local (`npx supabase
// start` + `npx supabase functions serve --env-file <.env con MP_CLIENT_ID y
// MP_CLIENT_SECRET>`). Mismo espíritu que test-appointments.mjs: cuentas
// reales, HTTP real, sin mocks.
//
// Lo que NO cubre (necesita la API real de MP con una cuenta de prueba
// conectada de verdad): que el checkout cobre y que el webhook confirme un
// pago aprobado. Acá el token de MP es falso a propósito, así que se prueba
// el camino de error de esos pasos (se suelta el horario, el webhook pide
// reintento) y todo lo que vive en la base y en las Edge Functions.
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

async function callFn(name, accessToken, body, { query = '', redirect = 'follow', method = 'POST' } = {}) {
  const res = await fetch(`${API_URL}/functions/v1/${name}${query}`, {
    method,
    redirect,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken || ANON_KEY}`, apikey: ANON_KEY, Origin: 'http://localhost:5173' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, location: res.headers.get('location') };
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
  return { id: data.user.id, email, token: s.session.access_token, db };
}

function manana() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 2)).toISOString().slice(0, 10);
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const otroBizId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const todosLosDias = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '20:00', isActive: true }));

  await admin.from('businesses').insert([
    { id: bizId, name: 'Negocio Seña', slug: `negocio-sena-${suffix}`, business_hours: todosLosDias },
    { id: otroBizId, name: 'Otro Negocio', slug: `otro-sena-${suffix}`, business_hours: todosLosDias },
  ]);
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Prof Seña' });
  await admin.from('professional_services').insert({ business_id: bizId, professional_id: profId, service_id: srvId });
  await admin.from('schedules').insert([0, 1, 2, 3, 4, 5, 6].map((d) => ({
    business_id: bizId, professional_id: profId, day_of_week: d, start_time: '08:00', end_time: '20:00',
  })));

  const dueno = await usuario('dueno-sena', { business_id: bizId, role: 'owner' });
  const otroDueno = await usuario('otro-dueno-sena', { business_id: otroBizId, role: 'owner' });
  const fecha = manana();

  const reservarRpc = (cliente, hora) => admin.rpc('create_appointment', {
    p_business_id: bizId, p_professional_id: profId, p_service_id: srvId, p_appointment_date: fecha,
    p_start_time: hora, p_client_name: 'Cliente Seña', p_client_phone: '1112345678',
    p_client_email: cliente.email, p_notes: '', p_user_id: cliente.id,
  });
  const reservarEdge = (cliente, hora) => callFn('create-appointment', cliente.token, {
    businessId: bizId, professionalId: profId, serviceId: srvId, appointmentDate: fecha, startTime: hora,
    clientName: 'Cliente Seña', clientPhone: '1112345678',
  });

  console.log('Seña apagada por defecto:');
  {
    const { data: b } = await admin.from('businesses').select('deposit_enabled').eq('id', bizId).single();
    ok(b.deposit_enabled === false, 'un negocio nuevo arranca con deposit_enabled = false');
  }

  await admin.from('businesses').update({ deposit_enabled: true, deposit_type: 'percent', deposit_value: 30 }).eq('id', bizId);

  console.log('Seña activada pero SIN Mercado Pago conectado -> se reserva como siempre:');
  {
    const c = await usuario('c1');
    const { status, data } = await reservarEdge(c, '09:00');
    ok(status === 200 && data.status === 'created', `turno normal (200 created) — ${JSON.stringify(data)}`);
    const { data: t } = await admin.from('appointments').select('deposit_status').eq('id', data.id).single();
    ok(t?.deposit_status === null, 'sin seña (deposit_status null)');
  }

  // Conexión falsa: el trigger solo mira que exista la fila.
  await admin.from('mp_connections').insert({ business_id: bizId, mp_user_id: '999', nickname: 'TESTUSER', access_token: 'APP_USR-token-falso', live_mode: false });

  console.log('Con MP conectado, el trigger marca la seña (30% de 1000):');
  let pendienteId;
  {
    const c = await usuario('c2');
    const { data, error } = await reservarRpc(c, '10:00');
    ok(!error && data.deposit_status === 'pendiente' && Number(data.deposit_amount) === 300, `pendiente, $300 — ${JSON.stringify(error || { s: data.deposit_status, m: data.deposit_amount })}`);
    const min = (new Date(data.deposit_expires_at) - Date.now()) / 60000;
    ok(min > 14 && min <= 15.1, `vence en ~15 minutos (${min.toFixed(2)})`);
    pendienteId = data.id;

    const { data: notis } = await admin.from('notifications').select('id').eq('appointment_id', data.id);
    ok((notis || []).length === 0, 'NO avisa "nuevo turno" al negocio mientras espera la seña');

    const { data: busy } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: profId, appointmentDate: fecha });
    ok((busy.ocupados || []).some((o) => o.startTime === '10:00'), 'el horario queda retenido (get-busy-slots lo muestra ocupado)');

    console.log('El cliente NO puede marcarse la seña como pagada:');
    const { error: e1 } = await c.db.from('appointments').update({ deposit_status: 'pagada' }).eq('id', data.id);
    ok(Boolean(e1), `rechazado — ${e1?.message}`);
    const { data: t } = await admin.from('appointments').select('deposit_status').eq('id', data.id).single();
    ok(t.deposit_status === 'pendiente', 'sigue pendiente');

    console.log('El dueño tampoco:');
    const { error: e2 } = await dueno.db.from('appointments').update({ deposit_status: 'pagada' }).eq('id', data.id);
    ok(Boolean(e2), `rechazado — ${e2?.message}`);
  }

  console.log('Cuando el servidor la marca pagada, recién ahí avisa al negocio:');
  {
    await admin.from('appointments').update({ deposit_status: 'pagada', mp_payment_id: '123', deposit_paid_at: new Date().toISOString() }).eq('id', pendienteId);
    const { data: notis } = await admin.from('notifications').select('title').eq('appointment_id', pendienteId);
    ok((notis || []).length === 1 && notis[0].title.includes('seña pagada'), `1 aviso "seña pagada" — ${JSON.stringify(notis)}`);
  }

  console.log('Monto fijo mayor que el precio -> se cobra el precio:');
  {
    await admin.from('businesses').update({ deposit_type: 'fixed', deposit_value: 5000 }).eq('id', bizId);
    const c = await usuario('c3');
    const { data } = await reservarRpc(c, '11:00');
    ok(Number(data.deposit_amount) === 1000, `seña = $1000 (tope en el precio) — ${data.deposit_amount}`);
    await admin.from('businesses').update({ deposit_type: 'fixed', deposit_value: 400 }).eq('id', bizId);
    const c2 = await usuario('c3b');
    const { data: d2 } = await reservarRpc(c2, '11:30');
    ok(Number(d2.deposit_amount) === 400, `monto fijo $400 — ${d2.deposit_amount}`);
  }

  console.log('Turno cargado por el staff: nunca lleva seña, aunque lo intente mandar "pagada":');
  {
    const { data, error } = await dueno.db.from('appointments').insert({
      business_id: bizId, professional_id: profId, service_id: srvId, user_id: dueno.id,
      appointment_date: fecha, start_time: '12:00', end_time: '12:30', price: 1000, type: 'manual',
      deposit_status: 'pagada', deposit_amount: 999, mp_payment_id: 'trucho',
    }).select('deposit_status, deposit_amount, mp_payment_id').single();
    ok(!error && data.deposit_status === null && data.deposit_amount === null && data.mp_payment_id === null, `campos de seña vaciados — ${JSON.stringify(error || data)}`);
  }

  console.log('Liberar señas vencidas (con 2 minutos de margen):');
  {
    const ca = await usuario('c4');
    const cb = await usuario('c5');
    const { data: a } = await reservarRpc(ca, '13:00');
    const { data: b } = await reservarRpc(cb, '13:30');
    await admin.from('appointments').update({ deposit_expires_at: new Date(Date.now() - 5 * 60000).toISOString() }).eq('id', a.id);
    await admin.from('appointments').update({ deposit_expires_at: new Date(Date.now() - 60000).toISOString() }).eq('id', b.id);
    const { data: borrados } = await admin.rpc('liberar_senas_vencidas');
    const { data: quedan } = await admin.from('appointments').select('id').in('id', [a.id, b.id]);
    ok((quedan || []).length === 1 && quedan[0].id === b.id, `borra la vencida hace 5 min, deja la de hace 1 min (margen) — borrados=${borrados}`);
    const { data: pagada } = await admin.from('appointments').select('id').eq('id', pendienteId);
    ok((pagada || []).length === 1, 'no toca las señas pagadas');

    const { error } = await ca.db.rpc('liberar_senas_vencidas');
    ok(Boolean(error), 'un cliente no puede llamar liberar_senas_vencidas');
  }

  console.log('El token de MP no se lee desde el browser:');
  {
    const { data } = await dueno.db.from('mp_connections').select('*');
    ok(!data || data.length === 0, 'el dueño no ve la fila de mp_connections');
    const { data: st, error } = await dueno.db.rpc('mp_connection_status', { p_business_id: bizId });
    ok(!error && st?.[0]?.connected === true && st[0].nickname === 'TESTUSER' && !('access_token' in st[0]), `mp_connection_status: conectado, sin token — ${JSON.stringify(error || st)}`);
    const { error: e2 } = await otroDueno.db.rpc('mp_connection_status', { p_business_id: bizId });
    ok(Boolean(e2), 'el dueño de otro negocio no puede preguntar');
  }

  console.log('create-appointment con seña y token de MP inválido -> error claro y el horario se suelta:');
  {
    await admin.from('businesses').update({ deposit_type: 'percent', deposit_value: 30 }).eq('id', bizId);
    const c = await usuario('c6');
    const { status, data } = await reservarEdge(c, '14:00');
    ok(status === 412 && /Mercado Pago/.test(data?.error?.message || ''), `412 failed-precondition — ${status} ${JSON.stringify(data)}`);
    const { data: quedan } = await admin.from('appointments').select('id').eq('user_id', c.id);
    ok((quedan || []).length === 0, 'no quedó ningún turno retenido');
  }

  console.log('mp-conexion:');
  {
    const cliente = await usuario('c7');
    const r1 = await callFn('mp-conexion', cliente.token, { action: 'conectar', businessId: bizId });
    ok(r1.status === 403, `un cliente no puede conectar (403) — ${r1.status}`);
    const r2 = await callFn('mp-conexion', otroDueno.token, { action: 'conectar', businessId: bizId });
    ok(r2.status === 403, `el dueño de otro negocio no puede (403) — ${r2.status}`);
    const r3 = await callFn('mp-conexion', dueno.token, { action: 'conectar', businessId: bizId });
    const url = r3.data?.url ? new URL(r3.data.url) : null;
    ok(r3.status === 200 && url?.hostname === 'auth.mercadopago.com' && url.searchParams.get('client_id') === '1158726210614260'
      && url.searchParams.get('redirect_uri')?.endsWith('/functions/v1/mp-oauth-callback'), `devuelve la URL de autorización de MP — ${r3.data?.url}`);
    const state = url?.searchParams.get('state');
    const { data: fila } = await admin.from('mp_oauth_states').select('*').eq('state', state).maybeSingle();
    ok(fila?.business_id === bizId && fila.volver_a === 'http://localhost:5173', `guarda el state con el negocio y el origen — ${JSON.stringify(fila)}`);

    console.log('mp-oauth-callback:');
    const c1 = await callFn('mp-oauth-callback', null, null, { query: '?code=x&state=inventado', redirect: 'manual', method: 'GET' });
    ok(c1.status === 302 && c1.location?.endsWith('/admin/configuracion?mp=error'), `state inventado -> vuelve con ?mp=error — ${c1.status} ${c1.location}`);
    const c2 = await callFn('mp-oauth-callback', null, null, { query: `?state=${state}&error=access_denied`, redirect: 'manual', method: 'GET' });
    ok(c2.status === 302 && c2.location === 'http://localhost:5173/admin/configuracion?mp=cancelado', `sin code (canceló en MP) -> ?mp=cancelado al origen — ${c2.location}`);
    const { data: consumido } = await admin.from('mp_oauth_states').select('state').eq('state', state).maybeSingle();
    ok(!consumido, 'el state se consume (no sirve dos veces)');
  }

  console.log('mp-refund:');
  {
    const cliente = await usuario('c8');
    const r1 = await callFn('mp-refund', cliente.token, { appointmentId: pendienteId });
    ok(r1.status === 403, `un cliente no puede devolver (403) — ${r1.status}`);
    const r2 = await callFn('mp-refund', otroDueno.token, { appointmentId: pendienteId });
    ok(r2.status === 403, `el dueño de otro negocio no puede (403) — ${r2.status}`);
    const { data: sinSena } = await admin.from('appointments').select('id').eq('business_id', bizId).is('deposit_status', null).limit(1).single();
    const r3 = await callFn('mp-refund', dueno.token, { appointmentId: sinSena.id });
    ok(r3.status === 412, `turno sin seña pagada -> 412 — ${r3.status}`);
    const r4 = await callFn('mp-refund', dueno.token, { appointmentId: pendienteId });
    ok(r4.status === 412 && /Mercado Pago/.test(r4.data?.error?.message || ''), `con token falso, MP rechaza -> 412 con mensaje claro — ${JSON.stringify(r4.data)}`);
    const { data: t } = await admin.from('appointments').select('deposit_status').eq('id', pendienteId).single();
    ok(t.deposit_status === 'pagada', 'si MP no devolvió, sigue figurando pagada');
  }

  console.log('mp-webhook:');
  {
    const w1 = await callFn('mp-webhook', null, { type: 'payment', data: { id: '1' } }, { query: `?biz=${otroBizId}` });
    ok(w1.status === 200 && w1.data.status === 'sin-conexion', `negocio sin MP -> 200 sin-conexion — ${JSON.stringify(w1.data)}`);
    const w2 = await callFn('mp-webhook', null, { type: 'merchant_order', data: { id: '1' } }, { query: `?biz=${bizId}` });
    ok(w2.status === 200 && w2.data.status === 'ignorado', 'otro tipo de aviso -> ignorado');
    const w3 = await callFn('mp-webhook', null, { type: 'payment', data: { id: '1' } }, { query: `?biz=${bizId}` });
    ok(w3.status === 500, `no se pudo consultar el pago en MP -> 500 (MP reintenta) — ${w3.status}`);
  }

  console.log('Reintento del mismo cliente el mismo día: descarta su turno que esperaba seña:');
  {
    const c = await usuario('c9');
    const { data: previo } = await reservarRpc(c, '15:00');
    ok(previo.deposit_status === 'pendiente', 'tenía uno esperando seña');
    await callFn('mp-conexion', dueno.token, { action: 'desconectar', businessId: bizId });
    const { data: b } = await admin.from('businesses').select('deposit_enabled').eq('id', bizId).single();
    const { data: con } = await admin.from('mp_connections').select('business_id').eq('business_id', bizId);
    ok(b.deposit_enabled === false && (con || []).length === 0, 'desconectar borra la conexión y apaga la seña');
    const { status, data } = await reservarEdge(c, '16:00');
    ok(status === 200 && data.status === 'created', `reserva de nuevo sin "Ya tenés un turno ese día" — ${status} ${JSON.stringify(data)}`);
    const { data: viejo } = await admin.from('appointments').select('id').eq('id', previo.id);
    ok((viejo || []).length === 0, 'el que esperaba seña se borró');
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
