// Google Calendar de cada profesional, contra el stack local (`npx supabase
// start` + `npx supabase functions serve --env-file <env>`), con un GOOGLE
// FALSO levantado por este mismo test en el puerto 55390. El env de las
// funciones tiene que apuntar a él (además de lo de supabase/functions/.env):
//
//   GOOGLE_CLIENT_ID=test-client
//   GOOGLE_CLIENT_SECRET=test-secret
//   GOOGLE_TOKEN_URL=http://host.docker.internal:55390/token
//   GOOGLE_REVOKE_URL=http://host.docker.internal:55390/revoke
//   GOOGLE_CALENDAR_API=http://host.docker.internal:55390/calendar/v3
//
// El Google falso imita lo que usa Slotly: canje del código, renovación del
// token (con un refresh_token "revocado" que da invalid_grant), revocación y
// eventos de un calendario (PUT a uno inexistente = 404, POST con id que ya
// existe = 409, DELETE de uno borrado = 410, list por rango). Lo que NO
// cubre: la pantalla real de permiso de Google y su API de verdad.
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PUERTO_GOOGLE = 55390;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE_LISTA = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) {
  if (cond) { pasaron++; console.log(`  ok    ${label}`); }
  else { fallaron++; console.log(`  FALLA ${label}`); }
}

// ── Google falso ─────────────────────────────────────────────────────────────
const google = {
  eventos: new Map(), // id → evento (status 'cancelled' = borrado)
  externos: [],       // eventos que la persona tiene en sus calendarios (_cal = id del calendario)
  // Su lista de calendarios (calendarList, minAccessRole=owner).
  calendarios: [{ id: 'ana@gmail.test', primary: true }, { id: 'personal-ana' }],
  pidioLista: 0,
  revocados: [],
  pedidos: [],
};

function idToken(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ email })}.firma`;
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; });
    req.on('end', () => resolve(d));
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO_GOOGLE}`);
  const texto = await leerCuerpo(req);
  google.pedidos.push(`${req.method} ${url.pathname}`);
  const responder = (status, cuerpo) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(cuerpo === undefined ? '' : JSON.stringify(cuerpo));
  };

  if (url.pathname === '/token') {
    const p = new URLSearchParams(texto);
    if (p.get('client_id') !== 'test-client' || p.get('client_secret') !== 'test-secret') return responder(401, { error: 'invalid_client' });
    if (p.get('grant_type') === 'authorization_code') {
      const code = p.get('code');
      if (code === 'codigo-ok') {
        return responder(200, { access_token: 'at-inicial', refresh_token: 'rt-1', expires_in: 3600, scope: `openid ${SCOPE} ${SCOPE_LISTA} https://www.googleapis.com/auth/userinfo.email`, id_token: idToken('ana@gmail.test') });
      }
      if (code === 'codigo-sin-calendario') {
        return responder(200, { access_token: 'at-x', refresh_token: 'rt-x', expires_in: 3600, scope: 'openid https://www.googleapis.com/auth/userinfo.email', id_token: idToken('beto@gmail.test') });
      }
      return responder(400, { error: 'invalid_grant' });
    }
    if (p.get('grant_type') === 'refresh_token') {
      if (p.get('refresh_token') === 'rt-revocado') return responder(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return responder(200, { access_token: `at-${Date.now()}`, expires_in: 3600, scope: SCOPE });
    }
    return responder(400, { error: 'unsupported_grant_type' });
  }

  if (url.pathname === '/revoke') {
    google.revocados.push(url.searchParams.get('token'));
    return responder(200, {});
  }

  if (url.pathname === '/calendar/v3/users/me/calendarList') {
    if (!/^Bearer at-/.test(req.headers.authorization || '')) return responder(401, { error: { message: 'Invalid Credentials' } });
    google.pidioLista++;
    if (url.searchParams.get('minAccessRole') !== 'owner') return responder(400, { error: { message: 'se esperaba minAccessRole=owner' } });
    return responder(200, { items: google.calendarios });
  }

  const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (m) {
    if (!/^Bearer at-/.test(req.headers.authorization || '')) return responder(401, { error: { message: 'Invalid Credentials' } });
    const id = m[2] ? decodeURIComponent(m[2]) : null;
    // 'primary' y el mail de la cuenta son el mismo calendario.
    const cal = ['primary', 'ana@gmail.test'].includes(decodeURIComponent(m[1])) ? 'primary' : decodeURIComponent(m[1]);
    const cuerpo = texto ? JSON.parse(texto) : null;
    if (req.method === 'PUT' && id) {
      if (!google.eventos.has(id)) return responder(404, { error: { message: 'Not Found' } });
      const ev = { ...cuerpo, id, status: 'confirmed' };
      google.eventos.set(id, ev);
      return responder(200, ev);
    }
    if (req.method === 'POST' && !id) {
      if (google.eventos.has(cuerpo.id)) return responder(409, { error: { message: 'The requested identifier already exists.' } });
      const ev = { ...cuerpo, status: 'confirmed' };
      google.eventos.set(cuerpo.id, ev);
      return responder(200, ev);
    }
    if (req.method === 'DELETE' && id) {
      const ev = google.eventos.get(id);
      if (!ev || ev.status === 'cancelled') return responder(410, { error: { message: 'Resource has been deleted' } });
      ev.status = 'cancelled';
      res.writeHead(204);
      return res.end();
    }
    if (req.method === 'GET' && !id) {
      const desde = Date.parse(url.searchParams.get('timeMin'));
      const hasta = Date.parse(url.searchParams.get('timeMax'));
      const items = [...[...google.eventos.values()].map((e) => ({ ...e, _cal: 'primary' })), ...google.externos].filter((e) => {
        if ((e._cal || 'primary') !== cal) return false;
        if (e.status === 'cancelled') return false;
        if (e.start.date) return Date.parse(`${e.end.date}T00:00:00-03:00`) > desde && Date.parse(`${e.start.date}T00:00:00-03:00`) < hasta;
        return Date.parse(e.end.dateTime) > desde && Date.parse(e.start.dateTime) < hasta;
      });
      return responder(200, { items });
    }
  }
  responder(404, { error: { message: 'ruta desconocida del Google falso' } });
});

// ── Ayudas ───────────────────────────────────────────────────────────────────
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

const usuarios = [];
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
  usuarios.push({ id: data.user.id });
  return { id: data.user.id, email, token: s.session.access_token, db };
}

function enDias(n) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)).toISOString().slice(0, 10);
}

const idDeEvento = (appointmentId) => `sl${appointmentId.replace(/-/g, '')}`;

/** Espera (hasta 20 s) a que el Google falso cumpla la condición: la sincronización va por la cola, es asíncrona. */
async function esperar(cond, ms = 20000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return cond();
}

const stateDe = (url) => new URL(url).searchParams.get('state');

// ── Recorrido ────────────────────────────────────────────────────────────────
async function main() {
  await new Promise((r) => servidor.listen(PUERTO_GOOGLE, '0.0.0.0', r));

  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const ana = crypto.randomUUID();
  const beto = crypto.randomUUID();
  const todosLosDias = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '20:00', isActive: true }));
  const fecha = enDias(2);
  const otroDia = enDias(3);

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Calendario', slug: `negocio-gcal-${suffix}`, business_hours: todosLosDias, address: 'Av. Siempreviva 742' });
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });
  await admin.from('professionals').insert([
    { id: ana, business_id: bizId, name: 'Ana' },
    { id: beto, business_id: bizId, name: 'Beto' },
  ]);
  await admin.from('professional_services').insert([
    { business_id: bizId, professional_id: ana, service_id: srvId },
    { business_id: bizId, professional_id: beto, service_id: srvId },
  ]);
  await admin.from('schedules').insert([ana, beto].flatMap((p) => [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    business_id: bizId, professional_id: p, day_of_week: d, start_time: '08:00', end_time: '20:00',
  }))));

  const dueno = await usuario('dueno-gcal', { business_id: bizId, role: 'owner' });
  const staffBeto = await usuario('staff-beto', { business_id: bizId, role: 'admin', professional_id: beto });
  const cliente = await usuario('cliente-gcal');

  // Turno cargado por el negocio (directo en la tabla: los triggers son los
  // mismos, y create_appointment limita los turnos por cliente).
  const reservarRpc = (hora, prof = ana, dia = fecha) => {
    const [h, m] = hora.split(':').map(Number);
    const fin = `${String(h + Math.floor((m + 30) / 60)).padStart(2, '0')}:${String((m + 30) % 60).padStart(2, '0')}`;
    return admin.from('appointments').insert({
      business_id: bizId, professional_id: prof, service_id: srvId, service_name: 'Corte',
      appointment_date: dia, start_time: hora, end_time: fin, status: 'confirmada', type: 'manual',
      client_name: `Cliente ${hora}`, client_phone: '1112345678', notes: 'Trae foto', price: 1000,
    }).select().single();
  };

  console.log('Un turno que ya existía antes de conectar:');
  const { data: previo, error: ePrevio } = await reservarRpc('09:00');
  ok(!ePrevio, `turno de las 09:00 creado — ${ePrevio?.message || ''}`);

  console.log('Estado: quién puede verlo:');
  {
    const { data, error } = await dueno.db.rpc('google_calendar_estado', { p_business_id: bizId });
    ok(!error && Array.isArray(data) && data.length === 0, `el dueño lo ve (nadie conectado todavía) — ${error?.message || ''}`);
    const { error: e2 } = await cliente.db.rpc('google_calendar_estado', { p_business_id: bizId });
    ok(Boolean(e2), 'un cliente no');
    const { data: t } = await cliente.db.from('google_calendar_conexiones').select('*');
    ok(!t || t.length === 0, 'la tabla de conexiones no se lee desde el browser');
  }

  console.log('Conectar: permisos:');
  let urlAna, urlBeto;
  {
    const r1 = await callFn('gcal-conexion', cliente.token, { action: 'conectar', businessId: bizId, professionalId: ana });
    ok(r1.status === 403, `un cliente no puede (${r1.status})`);
    const r2 = await callFn('gcal-conexion', staffBeto.token, { action: 'conectar', businessId: bizId, professionalId: ana });
    ok(r2.status === 403, `un profesional no puede conectar el de OTRO (${r2.status})`);
    const r3 = await callFn('gcal-conexion', staffBeto.token, { action: 'conectar', businessId: bizId, professionalId: beto, volverA: 'ajustes' });
    ok(r3.status === 200 && r3.data.url, `un profesional sí el suyo (${r3.status})`);
    urlBeto = r3.data.url;
    const r4 = await callFn('gcal-conexion', dueno.token, { action: 'conectar', businessId: bizId, professionalId: ana });
    ok(r4.status === 200 && r4.data.url, `el dueño, el de cualquiera de su equipo (${r4.status})`);
    urlAna = r4.data.url;
    const u = new URL(urlAna);
    ok(u.origin === 'https://accounts.google.com', 'manda a la pantalla de permiso de Google');
    ok(u.searchParams.get('client_id') === 'test-client', 'con el client_id de Slotly');
    ok(u.searchParams.get('scope').split(' ').includes(SCOPE), 'pide el permiso del calendario');
    ok(u.searchParams.get('scope').split(' ').includes(SCOPE_LISTA), 'y el de la lista de calendarios');
    ok(u.searchParams.get('access_type') === 'offline' && u.searchParams.get('prompt') === 'consent', 'pide acceso offline (refresh_token)');
    ok(u.searchParams.get('redirect_uri').endsWith('/functions/v1/gcal-oauth-callback'), 'vuelve a gcal-oauth-callback');
    const r5 = await callFn('gcal-conexion', dueno.token, { action: 'conectar', businessId: bizId, professionalId: crypto.randomUUID() });
    ok(r5.status === 404, `un profesional que no es del negocio: 404 (${r5.status})`);
  }

  console.log('Vuelta de Google:');
  {
    const r = await callFn('gcal-oauth-callback', null, null, { method: 'GET', redirect: 'manual', query: `?state=${stateDe(urlAna)}&code=codigo-ok` });
    ok(r.status === 302 && r.location.includes('/admin/configuracion') && r.location.includes('gcal=conectado'), `vuelve a Configuración con ?gcal=conectado — ${r.location}`);
    const { data: c } = await admin.from('google_calendar_conexiones').select('*').eq('professional_id', ana).maybeSingle();
    ok(c?.refresh_token === 'rt-1' && c.google_email === 'ana@gmail.test' && c.business_id === bizId, 'guarda la conexión con el refresh_token y el mail de la cuenta');

    const r2 = await callFn('gcal-oauth-callback', null, null, { method: 'GET', redirect: 'manual', query: `?state=${stateDe(urlAna)}&code=codigo-ok` });
    ok(r2.location?.includes('gcal=error'), 'el mismo state no sirve dos veces');

    const r3 = await callFn('gcal-oauth-callback', null, null, { method: 'GET', redirect: 'manual', query: `?state=${stateDe(urlBeto)}&code=codigo-sin-calendario` });
    ok(r3.location?.includes('/admin/ajustes') && r3.location.includes('gcal=sin-permiso'), `sin el permiso del calendario: vuelve a Mi configuración con sin-permiso — ${r3.location}`);
    const { data: cb } = await admin.from('google_calendar_conexiones').select('*').eq('professional_id', beto).maybeSingle();
    ok(!cb, 'y no guarda nada');
    ok(google.revocados.includes('rt-x'), 'y le devuelve el permiso a Google');

    const r4 = await callFn('gcal-conexion', staffBeto.token, { action: 'conectar', businessId: bizId, professionalId: beto, volverA: 'ajustes' });
    const r5 = await callFn('gcal-oauth-callback', null, null, { method: 'GET', redirect: 'manual', query: `?state=${stateDe(r4.data.url)}&error=access_denied` });
    ok(r5.location?.includes('gcal=cancelado'), 'si cancela en Google: ?gcal=cancelado');

    const { data: estado } = await dueno.db.rpc('google_calendar_estado', { p_business_id: bizId });
    ok(estado?.length === 1 && estado[0].professional_id === ana && estado[0].google_email === 'ana@gmail.test' && estado[0].error === null, 'el dueño ve a Ana conectada');
    const { data: estadoBeto } = await staffBeto.db.rpc('google_calendar_estado', { p_business_id: bizId });
    ok(Array.isArray(estadoBeto) && estadoBeto.length === 0, 'Beto solo ve el suyo (no conectado), no el de Ana');
  }

  console.log('Al conectar, los turnos que ya tenía van a su calendario:');
  {
    const llego = await esperar(() => google.eventos.get(idDeEvento(previo.id))?.status === 'confirmed');
    ok(llego, 'el turno de las 09:00 aparece en Google');
    const ev = google.eventos.get(idDeEvento(previo.id));
    ok(ev?.start?.dateTime === `${fecha}T09:00:00-03:00` && ev.end.dateTime === `${fecha}T09:30:00-03:00`, `en hora de Argentina (${ev?.start?.dateTime} → ${ev?.end?.dateTime})`);
    ok(ev?.summary === 'Corte · Cliente 09:00', `título "servicio · cliente" (${ev?.summary})`);
    ok(ev?.description?.includes('1112345678') && ev.description.includes('Trae foto'), 'con teléfono y notas en la descripción');
    ok(ev?.location === 'Av. Siempreviva 742', 'con la dirección del negocio');
    ok(ev?.extendedProperties?.private?.slotly === '1', 'marcado como evento de Slotly');
  }

  console.log('Turno nuevo reservado por un cliente:');
  let nuevoId;
  {
    const r = await callFn('create-appointment', cliente.token, {
      businessId: bizId, professionalId: ana, serviceId: srvId, appointmentDate: fecha, startTime: '10:00',
      clientName: 'Lucía', clientPhone: '1198765432',
    });
    ok(r.status === 200 && r.data.status === 'created', `reserva OK — ${JSON.stringify(r.data)}`);
    nuevoId = r.data.id;
    ok(await esperar(() => google.eventos.get(idDeEvento(nuevoId))?.status === 'confirmed'), 'aparece solo en el calendario de Ana');
  }

  console.log('Se mueve el turno:');
  {
    await admin.from('appointments').update({ start_time: '11:00', end_time: '11:30' }).eq('id', nuevoId);
    ok(await esperar(() => google.eventos.get(idDeEvento(nuevoId))?.start?.dateTime === `${fecha}T11:00:00-03:00`), 'el evento pasa a las 11:00');
  }

  console.log('Se cancela el turno:');
  {
    await admin.from('appointments').update({ status: 'cancelada', cancelled_by: 'business' }).eq('id', nuevoId);
    ok(await esperar(() => google.eventos.get(idDeEvento(nuevoId))?.status === 'cancelled'), 'el evento se borra');
  }

  console.log('Vuelve a estar confirmado (lo reactiva el negocio):');
  {
    await admin.from('appointments').update({ status: 'confirmada' }).eq('id', nuevoId);
    ok(await esperar(() => google.eventos.get(idDeEvento(nuevoId))?.status === 'confirmed'), 'el evento vuelve (mismo id, sin duplicar)');
  }

  console.log('Se pasa a otro profesional (Beto, sin calendario):');
  {
    await admin.from('appointments').update({ professional_id: beto }).eq('id', nuevoId);
    ok(await esperar(() => google.eventos.get(idDeEvento(nuevoId))?.status === 'cancelled'), 'sale del calendario de Ana');
  }

  console.log('Se borra la fila del turno:');
  {
    const { data: t } = await reservarRpc('12:00');
    ok(await esperar(() => google.eventos.get(idDeEvento(t.id))?.status === 'confirmed'), 'turno de las 12:00 en el calendario');
    await admin.from('appointments').delete().eq('id', t.id);
    ok(await esperar(() => google.eventos.get(idDeEvento(t.id))?.status === 'cancelled'), 'al borrar la fila, el evento se borra');
  }

  console.log('Lectura: lo ocupado en su Google sale de la grilla:');
  {
    google.externos.push(
      { id: 'ext1', status: 'confirmed', summary: 'Dentista', start: { dateTime: `${fecha}T15:00:00-03:00` }, end: { dateTime: `${fecha}T16:00:00-03:00` } },
      { id: 'ext2', status: 'confirmed', transparency: 'transparent', summary: 'Recordatorio', start: { dateTime: `${fecha}T17:00:00-03:00` }, end: { dateTime: `${fecha}T18:00:00-03:00` } },
      { id: 'ext3', status: 'confirmed', summary: 'Reunión rechazada', attendees: [{ email: 'ana@gmail.test', self: true, responseStatus: 'declined' }], start: { dateTime: `${fecha}T18:00:00-03:00` }, end: { dateTime: `${fecha}T19:00:00-03:00` } },
      // En UTC: 12:00Z = 09:00 en Argentina, el día de `otroDia`... de todo el día.
      { id: 'ext4', status: 'confirmed', summary: 'Vacaciones', start: { date: otroDia }, end: { date: enDias(4) } },
      { id: 'ext5', status: 'confirmed', summary: 'Trámite (en UTC)', start: { dateTime: `${fecha}T22:00:00Z` }, end: { dateTime: `${fecha}T23:00:00Z` } },
      // En OTRO calendario suyo ("Personal"): también ocupa.
      { id: 'ext6', _cal: 'personal-ana', status: 'confirmed', summary: 'Gimnasio', start: { dateTime: `${fecha}T08:00:00-03:00` }, end: { dateTime: `${fecha}T08:30:00-03:00` } },
      // En un calendario que NO es suyo (no está en su lista de dueña): no cuenta.
      { id: 'ext7', _cal: 'agenda-de-otro', status: 'confirmed', summary: 'Ajeno', start: { dateTime: `${fecha}T13:00:00-03:00` }, end: { dateTime: `${fecha}T13:30:00-03:00` } },
      // Cumpleaños de un contacto y "dónde trabajo hoy": no son tiempo ocupado.
      { id: 'ext8', status: 'confirmed', eventType: 'birthday', summary: 'Cumple de Juan', start: { dateTime: `${fecha}T10:30:00-03:00` }, end: { dateTime: `${fecha}T11:00:00-03:00` } },
      { id: 'ext9', status: 'confirmed', eventType: 'workingLocation', summary: 'Oficina', start: { dateTime: `${fecha}T12:30:00-03:00` }, end: { dateTime: `${fecha}T13:00:00-03:00` } },
    );
    const { status, data } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: ana, appointmentDate: fecha });
    const o = data.ocupados || [];
    ok(status === 200, `get-busy-slots responde (${status})`);
    ok(o.some((x) => x.startTime === '15:00' && x.endTime === '16:00'), 'el dentista (15 a 16) figura ocupado');
    ok(o.some((x) => x.startTime === '19:00' && x.endTime === '20:00'), 'un evento en otra zona horaria se pasa a hora de Argentina (22Z → 19:00)');
    ok(!o.some((x) => x.startTime === '17:00'), 'uno marcado "Disponible" no');
    ok(!o.some((x) => x.startTime === '18:00'), 'una invitación rechazada no');
    ok(o.filter((x) => x.startTime === '09:00').length === 1, 'el turno de Slotly no se cuenta dos veces (su propio evento se saltea)');
    ok(!JSON.stringify(data).includes('Dentista'), 'no expone el título de los eventos');
    ok(o.some((x) => x.startTime === '08:00' && x.endTime === '08:30'), 'lo de OTRO calendario suyo (Personal) también ocupa');
    ok(!o.some((x) => x.startTime === '13:00'), 'un calendario que no es suyo (compartido por otro) no');
    ok(!o.some((x) => x.startTime === '10:30') && !o.some((x) => x.startTime === '12:30'), 'cumpleaños y "lugar de trabajo" no ocupan');
    const { data: cx } = await admin.from('google_calendar_conexiones').select('lee_todos, calendarios').eq('professional_id', ana).single();
    ok(cx.lee_todos === true && JSON.stringify(cx.calendarios) === JSON.stringify(['primary', 'personal-ana']), `guarda la lista de sus calendarios — ${JSON.stringify(cx)}`);
    const pedidasAntes = google.pidioLista;
    await callFn('get-busy-slots', null, { businessId: bizId, professionalId: ana, appointmentDate: fecha });
    ok(google.pidioLista === pedidasAntes, 'la lista se reusa, no se pide en cada consulta');

    // Conexión vieja, sin el permiso de la lista: solo el principal.
    await admin.from('google_calendar_conexiones').update({ lee_todos: false, calendarios: null, calendarios_at: null }).eq('professional_id', ana);
    const { data: viejo } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: ana, appointmentDate: fecha });
    ok(!(viejo.ocupados || []).some((x) => x.startTime === '08:00') && (viejo.ocupados || []).some((x) => x.startTime === '15:00'), 'sin el permiso de la lista: solo el calendario principal');
    const { data: estadoViejo } = await dueno.db.rpc('google_calendar_estado', { p_business_id: bizId });
    ok(estadoViejo?.[0]?.lee_todos === false, 'y el panel lo sabe (para ofrecer volver a conectar)');
    await admin.from('google_calendar_conexiones').update({ lee_todos: true }).eq('professional_id', ana);
  }

  console.log('Panel: ocupado-google:');
  {
    const r = await callFn('ocupado-google', dueno.token, { businessId: bizId, professionalIds: [ana, beto], fecha });
    ok(r.status === 200 && r.data.ocupados?.[ana]?.some((x) => x.startTime === '15:00') && Array.isArray(r.data.ocupados?.[beto]) && r.data.ocupados[beto].length === 0,
      `el dueño ve lo ocupado de Ana, y Beto (sin Google) vacío — ${r.status}`);
    ok(!JSON.stringify(r.data).includes('Dentista'), 'sin títulos');
    const r2 = await callFn('ocupado-google', staffBeto.token, { businessId: bizId, professionalIds: [ana, beto], fecha });
    ok(r2.status === 200 && !r2.data.ocupados?.[ana] && Array.isArray(r2.data.ocupados?.[beto]), 'un profesional solo recibe lo suyo');
    const r3 = await callFn('ocupado-google', cliente.token, { businessId: bizId, professionalIds: [ana], fecha });
    ok(r3.status === 403, `un cliente no (${r3.status})`);
    const { data: d2 } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: ana, appointmentDate: otroDia });
    ok((d2.ocupados || []).some((x) => x.startTime === '00:00' && x.endTime === '24:00'), 'un evento de todo el día ocupado bloquea el día entero');
  }

  console.log('Al confirmar, se vuelve a mirar Google:');
  {
    const c2 = await usuario('cliente2-gcal');
    const r = await callFn('create-appointment', c2.token, {
      businessId: bizId, professionalId: ana, serviceId: srvId, appointmentDate: fecha, startTime: '15:30',
      clientName: 'Pedro', clientPhone: '1198765432',
    });
    ok(r.status === 409 && r.data.error?.code === 'already-exists' && /horario ya fue tomado/.test(r.data.error.message), `en el horario del dentista: "ya fue tomado" (${r.status})`);
    const { data: creado } = await admin.from('appointments').select('id').eq('professional_id', ana).eq('appointment_date', fecha).eq('start_time', '15:30');
    ok((creado || []).length === 0, 'no crea el turno (ni dispara avisos)');
    const r2 = await callFn('create-appointment', c2.token, {
      businessId: bizId, professionalId: ana, serviceId: srvId, appointmentDate: fecha, startTime: '16:00',
      clientName: 'Pedro', clientPhone: '1198765432',
    });
    ok(r2.status === 200, `a las 16:00, cuando ya terminó: OK (${r2.status})`);
  }

  console.log('Google revoca el permiso:');
  {
    await admin.from('google_calendar_conexiones').update({ refresh_token: 'rt-revocado', access_token: null, access_expires_at: null }).eq('professional_id', ana);
    const { status, data } = await callFn('get-busy-slots', null, { businessId: bizId, professionalId: ana, appointmentDate: fecha });
    ok(status === 200 && (data.ocupados || []).some((x) => x.startTime === '09:00') && !(data.ocupados || []).some((x) => x.startTime === '15:00'), 'la grilla sigue andando, solo con lo de Slotly');
    const { data: estado } = await dueno.db.rpc('google_calendar_estado', { p_business_id: bizId });
    ok(estado?.[0]?.error?.includes('Volvé a conectarlo'), `el panel ve el aviso de reconectar — ${estado?.[0]?.error}`);
    const antes = google.pedidos.length;
    await reservarRpc('13:00');
    await new Promise((r) => setTimeout(r, 2500));
    ok(!google.pedidos.slice(antes).some((p) => p.includes('/events')), 'con la conexión rota no se intenta sincronizar');
  }

  console.log('Desconectar:');
  {
    // Reconecta (como si volviera a dar el permiso) y deja un turno en el calendario.
    await admin.from('google_calendar_conexiones').update({ refresh_token: 'rt-1', error: null, error_at: null }).eq('professional_id', ana);
    const { data: t } = await reservarRpc('14:00');
    ok(await esperar(() => google.eventos.get(idDeEvento(t.id))?.status === 'confirmed'), 'turno de las 14:00 en el calendario');

    const r0 = await callFn('gcal-conexion', staffBeto.token, { action: 'desconectar', businessId: bizId, professionalId: ana });
    ok(r0.status === 403, `Beto no puede desconectar el de Ana (${r0.status})`);

    const r = await callFn('gcal-conexion', dueno.token, { action: 'desconectar', businessId: bizId, professionalId: ana });
    ok(r.status === 200, `el dueño sí (${r.status})`);
    ok(google.eventos.get(idDeEvento(t.id))?.status === 'cancelled' && google.eventos.get(idDeEvento(previo.id))?.status === 'cancelled', 'borra de su calendario los turnos que vienen');
    ok(google.revocados.includes('rt-1'), 'le devuelve el permiso a Google');
    const { data: c } = await admin.from('google_calendar_conexiones').select('*').eq('professional_id', ana).maybeSingle();
    ok(!c, 'y borra la conexión');
  }

  console.log('Nunca se duplicó un evento:');
  {
    const ids = [...google.eventos.keys()];
    ok(ids.length === new Set(ids).size && ids.every((id) => /^sl[0-9a-f]{32}$/.test(id)), `${ids.length} eventos, todos con id del turno`);
  }

  await admin.from('businesses').delete().eq('id', bizId);
  for (const u of usuarios) await admin.auth.admin.deleteUser(u.id);
}

main()
  .catch((err) => { fallaron++; console.error(err); })
  .finally(() => {
    servidor.close();
    console.log(`\n${pasaron} ok, ${fallaron} fallas`);
    process.exit(fallaron ? 1 : 0);
  });
