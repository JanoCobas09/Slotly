// Cola de avisos (20261022000000_cola_de_avisos.sql): ningún aviso se pierde
// en silencio. Turno nuevo → push/mail al dueño + confirmación al cliente,
// todo por envios_pendientes; si la Edge Function no llega a correr, el cron
// (reintentar_envios) lo vuelve a mandar sin repetirle a quien ya lo recibió.
// Necesita `supabase start` + `supabase functions serve --env-file supabase/functions/.env`.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'node:child_process';

const API_URL = 'http://127.0.0.1:55321';
const MAILPIT_URL = 'http://127.0.0.1:55324';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const psql = (sql) => execSync(
  `psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -t -A -c "${sql}"`,
  { env: { ...process.env, PGPASSWORD: 'postgres' } },
).toString().trim();

let pasaron = 0, fallaron = 0;
function ok(cond, label) { if (cond) { pasaron++; console.log(`  ok    ${label}`); } else { fallaron++; console.log(`  FALLA ${label}`); } }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function mailsPara(email) {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`);
  return (await res.json()).messages || [];
}
/** Espera hasta que `cond()` dé true (máx ~15 s): pg_net + Edge Function son asíncronos. */
async function hasta(cond) {
  for (let i = 0; i < 30; i++) { if (await cond()) return true; await esperar(500); }
  return false;
}
const enviosDe = async (bizId) => {
  const { data } = await admin.from('envios_pendientes').select('*').filter('payload->>businessId', 'eq', bizId);
  return data || [];
};
const enviosDeTurno = async (aptId) => {
  const { data } = await admin.from('envios_pendientes').select('*').filter('payload->>appointmentId', 'eq', aptId);
  return data || [];
};

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const ownerEmail = `owner-cola-${suffix}@example.com`;
  const clienteEmail = `cliente-cola-${suffix}@example.com`;
  const urlOriginal = psql("select value from app_settings where key = 'edge_functions_url';");

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Cola', slug: `negocio-cola-${suffix}` });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Prof Cola' });
  await admin.from('admins').insert({ business_id: bizId, email: ownerEmail, role: 'owner' });
  const nuevoTurno = async (hora) => {
    const { data, error } = await admin.from('appointments').insert({
      business_id: bizId, professional_id: profId, appointment_date: '2030-01-15', start_time: hora,
      client_name: `Cliente ${hora}`, client_email: clienteEmail, service_name: 'Masaje', price: 1000,
      duration_minutes: 30, status: 'confirmada', type: 'client',
    }).select('id').single();
    if (error) throw error;
    return data.id;
  };

  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

  try {
    console.log('=== Turno nuevo, dueño SIN push ===');
    {
      const aptId = await nuevoTurno('09:00');
      ok(await hasta(async () => (await mailsPara(ownerEmail)).length === 1), 'el dueño recibe el aviso por mail aunque nunca activó el push');
      const [m] = await mailsPara(ownerEmail);
      ok(m?.Subject.includes('Nuevo turno') && m.Subject.includes('Cliente 09:00'), `con el turno en el asunto — ${m?.Subject}`);
      ok(await hasta(async () => (await mailsPara(clienteEmail)).length === 1), 'el cliente recibe la confirmación (ahora por la cola)');
      ok(await hasta(async () => {
        const e = [...await enviosDe(bizId), ...await enviosDeTurno(aptId)];
        return e.length === 2 && e.every((x) => x.procesado_at && x.intentos === 1);
      }), 'los dos envíos quedan procesados al primer intento');
    }

    console.log('=== Edge Functions caídas al reservar → el cron lo recupera ===');
    {
      await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
      psql("update app_settings set value = 'http://kong:8000/no-existe' where key = 'edge_functions_url';");
      const aptId = await nuevoTurno('10:00');
      await esperar(2500);
      const caidos = [...await enviosDe(bizId), ...await enviosDeTurno(aptId)].filter((e) => !e.procesado_at);
      ok(caidos.length === 2, `quedan 2 envíos sin procesar — ${caidos.length}`);
      ok((await mailsPara(ownerEmail)).length === 0 && (await mailsPara(clienteEmail)).length === 0, 'y no salió ningún mail');

      psql(`update app_settings set value = '${urlOriginal}' where key = 'edge_functions_url';`);
      // Recién intentado: el cron todavía no lo toca (espera 2 min).
      ok(psql('select reintentar_envios();') === '0', 'el cron no reintenta antes de los 2 minutos');
      psql(`update envios_pendientes set ultimo_intento_at = now() - interval '3 minutes' where procesado_at is null and (payload->>'businessId' = '${bizId}' or payload->>'appointmentId' = '${aptId}');`);
      ok(psql('select reintentar_envios();') === '2', 'pasados 2 minutos reintenta los dos');
      ok(await hasta(async () => (await mailsPara(ownerEmail)).length === 1 && (await mailsPara(clienteEmail)).length === 1),
        'y llegan el aviso al dueño y la confirmación al cliente');
      ok(await hasta(async () => [...await enviosDe(bizId), ...await enviosDeTurno(aptId)].every((e) => e.procesado_at)),
        'todos procesados');
      ok(psql(`select string_agg(distinct intentos::text, ',') from envios_pendientes where payload->>'appointmentId' = '${aptId}';`) === '2',
        'con 2 intentos');
    }

    console.log('=== Espera creciente entre intentos ===');
    {
      const eid = psql(`insert into envios_pendientes (funcion, payload, intentos, ultimo_intento_at) values ('send-push', '{\\"businessId\\":\\"${bizId}\\",\\"title\\":\\"t\\",\\"body\\":\\"b\\"}', 3, now() - interval '5 minutes') returning id;`).split('\n')[0];
      ok(psql('select reintentar_envios();') === '0', 'con 3 intentos espera 8 min: a los 5 no reintenta');
      psql(`update envios_pendientes set ultimo_intento_at = now() - interval '9 minutes' where id = '${eid}';`);
      ok(psql('select reintentar_envios();') === '1', 'a los 9 sí');
      psql(`update envios_pendientes set intentos = 6, procesado_at = null, ultimo_intento_at = now() - interval '2 hours' where id = '${eid}';`);
      ok(psql('select reintentar_envios();') === '0', 'después de 6 intentos se deja');
      psql(`delete from envios_pendientes where id = '${eid}';`);
    }

    console.log('=== Un reintento no le repite el aviso a quien ya lo recibió ===');
    {
      await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
      const payload = JSON.stringify({ businessId: bizId, title: 'Nuevo turno', body: 'Repetido', respaldoMail: true, avisarSinPush: true });
      const progreso = JSON.stringify({ avisados: [`mail:${ownerEmail}`] });
      const eid = psql(`insert into envios_pendientes (funcion, payload, progreso) values ('send-push', '${payload.replace(/"/g, '\\"')}', '${progreso.replace(/"/g, '\\"')}') returning id;`).split('\n')[0];
      psql(`select despachar_envio('${eid}');`);
      ok(await hasta(async () => psql(`select procesado_at is not null from envios_pendientes where id = '${eid}';`) === 't'), 'se procesa');
      ok((await mailsPara(ownerEmail)).length === 0, 'sin mandarle de nuevo al dueño que ya lo tenía');
    }

    console.log('=== Cancela el cliente: un solo mail al dueño ===');
    {
      const aptId = await nuevoTurno('11:00');
      await hasta(async () => (await mailsPara(clienteEmail)).length >= 1);
      await esperar(1500);
      await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
      await admin.from('appointments').update({ status: 'cancelada', cancelled_at: new Date().toISOString(), cancelled_by: 'client' }).eq('id', aptId);
      ok(await hasta(async () => (await mailsPara(ownerEmail)).length >= 1), 'llega el mail de cancelación');
      await esperar(2500);
      const mails = await mailsPara(ownerEmail);
      ok(mails.length === 1 && mails[0].Subject.startsWith('Turno cancelado'), `uno solo (notify-cancellation) — ${mails.map((m) => m.Subject).join(' | ')}`);
      ok(await hasta(async () => (await enviosDeTurno(aptId)).some((e) => e.funcion === 'notify-cancellation' && e.procesado_at)),
        'notify-cancellation marcó su envío');
    }
  } finally {
    psql(`update app_settings set value = '${urlOriginal}' where key = 'edge_functions_url';`);
    psql(`delete from envios_pendientes where payload->>'businessId' = '${bizId}' or payload->>'appointmentId' in (select id::text from appointments where business_id = '${bizId}');`);
    await admin.from('businesses').delete().eq('id', bizId);
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron > 0 ? 1 : 0);
}
main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
