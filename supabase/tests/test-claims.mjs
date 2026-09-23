// Prueba de punta a punta de las Edge Functions de permisos, contra el stack
// local (`npx supabase start` + `npx supabase functions serve`). Mismo
// espíritu que scripts/test-claims-emulador.mjs del lado de Firebase: cuentas
// reales, casos de aislamiento y auto-beneficio incluidos.
//
// Las claves de acá son las FIJAS que imprime `supabase start` en CUALQUIER
// proyecto local — no son secretos, están pensadas para pegarse en scripts
// como este.

import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0;
let fallaron = 0;
function ok(cond, label) {
  if (cond) { pasaron++; console.log(`  ok    ${label}`); }
  else { fallaron++; console.log(`  FALLA ${label}`); }
}

async function callFn(name, accessToken, body) {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken || ANON_KEY}`,
      apikey: ANON_KEY,
    },
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
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (error) throw error;
  return data.user;
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const platformEmail = `platform-${suffix}@example.com`;
  const ownerEmail = `owner-${suffix}@example.com`; // se asigna ANTES de que exista la cuenta
  const rogueEmail = `rogue-${suffix}@example.com`;
  const modEmail = `mod-${suffix}@example.com`;

  // Setup: negocio de prueba + el "dueño de la plataforma" ya bootstrapeado
  // con platform: true (paso manual único, igual que en Firebase).
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio de prueba', slug: `negocio-${suffix}` });
  await createConfirmedUser(platformEmail, 'Password123!', { platform: true });
  await createConfirmedUser(rogueEmail, 'Password123!', {});

  const platformToken = await signIn(platformEmail, 'Password123!');

  console.log('Alta de un dueño que TODAVÍA no tiene cuenta:');
  {
    const { status, data } = await callFn('set-business-admin', platformToken, {
      email: ownerEmail, businessId: bizId, role: 'owner', name: 'Dueño de prueba',
    });
    ok(status === 200 && data.status === 'pending', 'queda pendiente (200, status=pending)');
  }

  console.log('Esa cuenta entra por primera vez y reclama el pendiente:');
  let ownerToken;
  {
    const user = await createConfirmedUser(ownerEmail, 'Password123!', {});
    ownerToken = await signIn(ownerEmail, 'Password123!');
    const { status, data } = await callFn('apply-pending-claims', ownerToken);
    ok(status === 200 && data.status === 'applied' && data.business_id === bizId && data.role === 'owner',
      'se aplica el rol de dueño al primer login');
    // El token viejo (de antes de aplicar el claim) no sirve para lo que sigue.
    ownerToken = await signIn(ownerEmail, 'Password123!');
  }

  console.log('El dueño NO puede designar a otro dueño (solo la plataforma puede):');
  {
    const { status, data } = await callFn('set-business-admin', ownerToken, {
      email: rogueEmail, businessId: bizId, role: 'owner',
    });
    ok(status === 403 && data.error?.code === 'permission-denied', 'rechazado (403 permission-denied)');
  }

  console.log('El dueño SÍ puede designar un admin dentro de su propio negocio:');
  {
    // rogueEmail ya tiene cuenta (se creó en el setup) — se aplica directo,
    // no queda pendiente. El caso "todavía no existe la cuenta" ya se probó
    // arriba con ownerEmail.
    const { status, data } = await callFn('set-business-admin', ownerToken, {
      email: rogueEmail, businessId: bizId, role: 'admin',
    });
    ok(status === 200 && data.status === 'applied', 'se aplica directo (la cuenta ya existía)');
  }

  console.log('El dueño NO puede tocar a la plataforma (el mail de platformEmail) aunque intente asignarle "admin":');
  {
    const { status, data } = await callFn('set-business-admin', ownerToken, {
      email: platformEmail, businessId: bizId, role: 'admin',
    });
    ok(status === 403 && data.error?.code === 'permission-denied', 'rechazado (403 permission-denied)');
  }

  console.log('Un usuario sin ningún rol NO puede llamar set-business-admin:');
  {
    const rogueToken = await signIn(rogueEmail, 'Password123!');
    const { status } = await callFn('set-business-admin', rogueToken, {
      email: `otro-${suffix}@example.com`, businessId: bizId, role: 'admin',
    });
    ok(status === 403, 'rechazado (403)');
  }

  console.log('Moderadores — solo la plataforma los nombra:');
  {
    const { status, data } = await callFn('set-platform-moderator', ownerToken, { email: modEmail });
    ok(status === 403, 'un dueño de negocio NO puede nombrar moderadores (403)');
  }
  {
    const { status, data } = await callFn('set-platform-moderator', platformToken, { email: modEmail, name: 'Mod' });
    ok(status === 200 && data.status === 'pending', 'la plataforma sí puede, queda pendiente');
  }
  {
    await createConfirmedUser(modEmail, 'Password123!', {});
    const modToken = await signIn(modEmail, 'Password123!');
    const { status, data } = await callFn('apply-pending-claims', modToken);
    ok(status === 200 && data.platform === 'moderator', 'el moderador reclama su claim al primer login');
  }
  {
    const { status, data } = await callFn('set-platform-moderator', platformToken, {
      email: platformEmail, enabled: true,
    });
    ok(status === 412, 'la plataforma NO puede cambiarse su propio rol (412 failed-precondition)');
  }

  console.log('Revocar acceso:');
  {
    const { status, data } = await callFn('revoke-business-admin', ownerToken, {
      email: rogueEmail, businessId: bizId,
    });
    // rogueEmail nunca reclamó el pendiente de admin, así que sigue "not-found" en auth
    // pero el pendiente igual se limpia. Lo importante es que no rompe.
    ok(status === 200, `no rompe (status ${status})`);
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error inesperado:', err);
  process.exit(1);
});
