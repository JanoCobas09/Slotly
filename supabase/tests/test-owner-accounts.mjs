import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) { if (cond) { pasaron++; console.log(`  ok    ${label}`); } else { fallaron++; console.log(`  FALLA ${label}`); } }

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

async function main() {
  const suffix = Date.now();
  const platformEmail = `platform-cop-${suffix}@example.com`;
  const ownerEmail = `owner-cop-${suffix}@example.com`;
  const googleyEmail = `googley-ss-${suffix}@example.com`;
  const bizId = crypto.randomUUID();

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio CoP', slug: `negocio-cop-${suffix}` });
  await createConfirmedUser(platformEmail, 'Password123!', { platform: true });
  const platformToken = await signIn(platformEmail, 'Password123!');
  const googley = await createConfirmedUser(googleyEmail, 'Password123!', {});
  const googleyToken = await signIn(googleyEmail, 'Password123!');

  console.log('=== sin cuentas con contraseña ===');
  for (const fn of ['create-owner-with-password', 'reset-owner-password']) {
    const { status } = await callFn(fn, platformToken, { email: ownerEmail, businessId: bizId, role: 'owner' });
    ok(status === 404, `${fn} ya no existe (404) — recibido ${status}`);
  }

  console.log('=== create-business-self-service ===');
  let ssBizId;
  {
    const { status, data } = await callFn('create-business-self-service', googleyToken, {
      name: 'Mi Negocio Self Service', professionCategory: 'beauty', planId: 'pro',
    });
    ok(status === 200 && data.status === 'created' && data.slug?.startsWith('mi-negocio-self-service'), `crea el negocio — ${JSON.stringify(data)}`);
    ssBizId = data.businessId;
  }
  {
    // La misma cuenta (ahora con businessId) no puede hacerlo de nuevo
    const tokenActualizado = await signIn(googleyEmail, 'Password123!');
    const { status, data } = await callFn('create-business-self-service', tokenActualizado, { name: 'Otro' });
    ok(status === 409 && data.error?.code === 'already-exists', `una cuenta con negocio no puede repetir el alta — recibido ${status} ${JSON.stringify(data)}`);
  }

  console.log('=== delete-business ===');
  {
    const { status } = await callFn('delete-business', googleyToken, { businessId: ssBizId, confirmName: 'Mi Negocio Self Service' });
    ok(status === 403, `un no-dueño-de-plataforma no puede borrar (403) — recibido ${status}`);
  }
  {
    const { status, data } = await callFn('delete-business', platformToken, { businessId: ssBizId, confirmName: 'nombre incorrecto' });
    ok(status === 412 && data.error?.code === 'failed-precondition', `nombre incorrecto rechazado (412) — recibido ${status} ${JSON.stringify(data)}`);
  }
  {
    const { status, data } = await callFn('delete-business', platformToken, { businessId: ssBizId, confirmName: 'Mi Negocio Self Service' });
    ok(status === 200 && data.status === 'deleted' && data.usuarios === 1, `borra el negocio y limpia 1 usuario — ${JSON.stringify(data)}`);
  }
  {
    const { data: negocio } = await admin.from('businesses').select('id').eq('id', ssBizId).maybeSingle();
    ok(!negocio, 'el negocio ya no existe en la base');
    // `provider`/`providers` son bookkeeping propio de Supabase (qué método
    // de login usó), no un claim de negocio — siempre están presentes y no
    // hay que (ni se puede) vaciarlos. Lo que importa es que las claves de
    // rol/negocio queden en null.
    const { data: usuarioActualizado } = await admin.auth.admin.getUserById(googley.id);
    const metaFinal = usuarioActualizado.user.app_metadata || {};
    ok(
      !metaFinal.business_id && !metaFinal.role && !metaFinal.professional_id && !metaFinal.platform,
      `el ex-dueño quedó sin claims de negocio — ${JSON.stringify(metaFinal)}`,
    );
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);

  // Limpieza
  await admin.from('businesses').delete().eq('id', bizId);
  await admin.auth.admin.deleteUser(googley.id);
  const { data: allUsers } = await admin.auth.admin.listUsers();
  for (const u of allUsers.users) {
    if (u.email === platformEmail || u.email === ownerEmail) await admin.auth.admin.deleteUser(u.id);
  }

  process.exit(fallaron > 0 ? 1 : 0);
}
main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
