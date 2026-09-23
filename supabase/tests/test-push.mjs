// Prueba de punta a punta del pipeline de Web Push, contra el stack local.
// No puede verificar que un push llegue de verdad a un dispositivo (no hay
// uno real acá) — lo que sí verifica es todo lo demás: que guardar/borrar
// una suscripción respeta RLS igual que lo haría el browser, que
// enviar-push-de-prueba y send-push responden correctamente en sus casos
// de éxito/error, y que el trigger de un turno nuevo dispara pg_net hacia
// send-push de verdad (se confirma leyendo net._http_response).

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const API_URL = 'http://127.0.0.1:55321';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) { if (cond) { pasaron++; console.log(`  ok    ${label}`); } else { fallaron++; console.log(`  FALLA ${label}`); } }

async function callFn(name, token, body) {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const ownerEmail = `owner-push-${suffix}@example.com`;
  const endpoint = `https://fake-push.example.com/ep-${suffix}`;

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Push', slug: `negocio-push-${suffix}` });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Prof Push' });
  const { data: created } = await admin.auth.admin.createUser({
    email: ownerEmail, password: 'Password123!', email_confirm: true,
    app_metadata: { business_id: bizId, role: 'owner' },
  });
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await client.auth.signInWithPassword({ email: ownerEmail, password: 'Password123!' });
  const token = sess.session.access_token;

  console.log('=== savePushToken (upsert) respeta RLS como el browser ===');
  {
    const { error } = await client.from('push_subscriptions').upsert({
      endpoint, business_id: bizId, user_id: created.user.id, role: 'owner', professional_id: null,
      p256dh: 'FakeP256dh', auth_key: 'FakeAuth', updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    ok(!error, `primer upsert — ${error?.message || 'ok'}`);
  }
  {
    // Re-activar en el mismo dispositivo (mismo endpoint) no debe romper —
    // esto era justo el bug real: sin policy de SELECT, ON CONFLICT
    // rebotaba con "row-level security policy" incluso en el propio dueño.
    const { error } = await client.from('push_subscriptions').upsert({
      endpoint, business_id: bizId, user_id: created.user.id, role: 'owner', professional_id: null,
      p256dh: 'FakeP256dhV2', auth_key: 'FakeAuth', updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    ok(!error, `segundo upsert, mismo endpoint — ${error?.message || 'ok'}`);
  }
  {
    const { data } = await client.from('push_subscriptions').select('*');
    ok(data?.length === 1 && data[0].p256dh === 'FakeP256dhV2', `lectura propia ve solo lo suyo, actualizado — ${JSON.stringify(data)}`);
  }
  {
    const { data: otro } = await createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
      .from('push_subscriptions').select('*');
    ok(Array.isArray(otro) && otro.length === 0, 'sin sesión, no se ve nada (RLS)');
  }

  console.log('=== enviar-push-de-prueba ===');
  {
    const { status, data } = await callFn('enviar-push-de-prueba', token, {});
    ok(status === 500 && data.status === 'failed', `endpoint falso => falla prolija, no rompe — ${status} ${JSON.stringify(data)}`);
  }
  {
    await client.from('push_subscriptions').delete().eq('endpoint', endpoint);
    const { status, data } = await callFn('enviar-push-de-prueba', token, {});
    ok(status === 412 && data.error?.code === 'failed-precondition', `sin ninguna suscripción => 412 — ${status} ${JSON.stringify(data)}`);
  }
  {
    const { status } = await callFn('enviar-push-de-prueba', ANON_KEY, {});
    ok(status === 401, `sin sesión => 401 — recibido ${status}`);
  }

  console.log('=== send-push: guarda contra llamadas que no sean del propio proyecto ===');
  {
    const { status } = await callFn('send-push', ANON_KEY, { businessId: bizId, title: 't', body: 'b' });
    ok(status === 401, `rechaza el anon key (401) — recibido ${status}`);
  }

  console.log('=== El trigger de un turno nuevo dispara pg_net hacia send-push ===');
  {
    await client.from('push_subscriptions').upsert({
      endpoint, business_id: bizId, user_id: created.user.id, role: 'owner', professional_id: null,
      p256dh: 'FakeP256dh', auth_key: 'FakeAuth', updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });

    // net._http_response no lo expone PostgREST (solo public) — se lee por
    // psql directo, mismo camino que ya usa rls_smoke_test.sql para todo lo
    // que no es HTTP-facing.
    const psql = (sql) => execSync(
      `psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -t -A -c "${sql}"`,
      { env: { ...process.env, PGPASSWORD: 'postgres' } },
    ).toString().trim();

    const idAntes = Number(psql('select coalesce(max(id),0) from net._http_response;'));

    await admin.from('appointments').insert({
      business_id: bizId, professional_id: profId, appointment_date: '2026-09-23', start_time: '17:30',
      client_name: 'Cliente Push Test', service_name: 'Servicio', price: 1000, duration_minutes: 30,
      status: 'pendiente', type: 'client',
    });

    await new Promise((r) => setTimeout(r, 1500));
    const fila = psql(`select id || '|' || status_code from net._http_response where id > ${idAntes} order by id desc limit 1;`);
    const [idNuevo, statusCode] = fila.split('|');
    ok(
      Boolean(idNuevo) && Number(idNuevo) > idAntes && statusCode === '200',
      `pg_net llamó a send-push y respondió 200 — id=${idNuevo} status=${statusCode}`,
    );
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  await admin.from('businesses').delete().eq('id', bizId);
  await admin.auth.admin.deleteUser(created.user.id);
  process.exit(fallaron > 0 ? 1 : 0);
}
main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
