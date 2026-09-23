// Prueba de punta a punta de run-billing (process_billing + borrado
// automático de self-service que nunca pagaron), contra el stack local.
// Mismo espíritu que scripts/test-billing-emulador.mjs del lado de Firebase.

import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) { if (cond) { pasaron++; console.log(`  ok    ${label}`); } else { fallaron++; console.log(`  FALLA ${label}`); } }

async function callRunBilling(token) {
  const res = await fetch(`${API_URL}/functions/v1/run-billing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('=== Guarda: solo la propia service role key puede llamarla ===');
  {
    const { status } = await callRunBilling(ANON_KEY);
    ok(status === 401, `rechaza el anon key (401) — recibido ${status}`);
  }
  {
    const { status } = await callRunBilling('cualquier-cosa');
    ok(status === 401, `rechaza un bearer inventado (401) — recibido ${status}`);
  }

  console.log('=== Cobro y congelamiento sobre un negocio real (sin borrado) ===');
  const bizId = crypto.randomUUID();
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Cron Billing', slug: `negocio-cron-billing-${Date.now()}` });
  await admin.from('billing').insert({ business_id: bizId, debt: 0, next_billing_date: '2020-01-01', monthly_fee: 3000 });
  {
    const { status, data } = await callRunBilling(SERVICE_ROLE_KEY);
    ok(status === 200 && data.status === 'processed', `procesa (200) — ${JSON.stringify(data)}`);
    const { data: biz } = await admin.from('businesses').select('is_frozen').eq('id', bizId).maybeSingle();
    ok(biz.is_frozen === true, 'el negocio con deuda quedó congelado');
    const { data: billing } = await admin.from('billing').select('debt').eq('business_id', bizId).maybeSingle();
    ok(billing.debt > 0, `la deuda se acumuló — ${billing.debt}`);
  }

  console.log('=== Borrado automático: self-service, congelado hace 8 días, nunca pagó ===');
  const ownerEmail = `owner-autodelete-${Date.now()}@example.com`;
  const { data: created } = await admin.auth.admin.createUser({
    email: ownerEmail, password: 'Password123!', email_confirm: true,
    app_metadata: { business_id: bizId, role: 'owner' },
  });
  const ochoDiasAtras = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  await admin.from('businesses').update({ signup_source: 'self_service', frozen_at: ochoDiasAtras }).eq('id', bizId);
  {
    const { status, data } = await callRunBilling(SERVICE_ROLE_KEY);
    ok(status === 200 && data.borrados === 1, `borra exactamente 1 negocio — ${JSON.stringify(data)}`);
  }
  {
    const { data: biz } = await admin.from('businesses').select('id').eq('id', bizId).maybeSingle();
    ok(!biz, 'el negocio ya no existe en la base');
    const { data: usuario } = await admin.auth.admin.getUserById(created.user.id);
    const meta = usuario.user.app_metadata || {};
    ok(!meta.business_id && !meta.role, `el ex-dueño quedó sin claims — ${JSON.stringify(meta)}`);
  }

  console.log('=== Una cuenta self-service congelada que SÍ pagó alguna vez NO se borra ===');
  const bizId2 = crypto.randomUUID();
  await admin.from('businesses').insert({
    id: bizId2, name: 'Negocio Pagó Antes', slug: `negocio-pago-antes-${Date.now()}`,
    signup_source: 'self_service', is_frozen: true, frozen_at: ochoDiasAtras,
  });
  await admin.from('billing').insert({ business_id: bizId2, debt: 5000, last_payment_date: '2026-01-01' });
  {
    const { status, data } = await callRunBilling(SERVICE_ROLE_KEY);
    ok(status === 200, `procesa (200) — ${JSON.stringify(data)}`);
    const { data: biz } = await admin.from('businesses').select('id').eq('id', bizId2).maybeSingle();
    ok(Boolean(biz), 'sigue existiendo: ya pagó una vez, no es candidato a borrado automático');
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  await admin.from('businesses').delete().eq('id', bizId2);
  await admin.auth.admin.deleteUser(created.user.id);
  process.exit(fallaron > 0 ? 1 : 0);
}
main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
