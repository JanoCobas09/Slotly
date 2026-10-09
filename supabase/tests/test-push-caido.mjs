// Push caído → marca de baja + respaldo por mail (20261021000000_push_caido_respaldo_mail.sql).
// Caso real que lo originó: el servicio de push dio por muerta la suscripción
// del dueño, send-push la borró y el negocio se quedó sin avisos sin enterarse.
//
// Para simular al servicio de push se usan endpoints HTTPS reales de httpbin:
// /status/410 contesta como una suscripción muerta y /status/201 como una
// entregada (web-push solo habla HTTPS, así que un servidor local no sirve).
// Necesita `supabase start` + `supabase functions serve --env-file supabase/functions/.env`
// (con VAPID_* y SMTP a Mailpit) y salida a internet.

import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const MAILPIT_URL = 'http://127.0.0.1:55324';
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

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Claves de suscripción válidas (web-push cifra con ellas antes de mandar). */
async function clavesDePrueba() {
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    p256dh: b64url(await crypto.subtle.exportKey('raw', par.publicKey)),
    auth_key: b64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function mailsPara(email) {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`);
  return (await res.json()).messages || [];
}

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const ownerEmail = `owner-pushcaido-${suffix}@example.com`;
  const muerto = `https://httpbin.org/status/410?ep=${suffix}`;
  const vivo = `https://httpbin.org/status/201?ep=${suffix}`;

  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Push Caído', slug: `negocio-push-caido-${suffix}` });
  const { data: created } = await admin.auth.admin.createUser({
    email: ownerEmail, password: 'Password123!', email_confirm: true,
    app_metadata: { business_id: bizId, role: 'owner' },
  });
  const uid = created.user.id;
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: sess } = await client.auth.signInWithPassword({ email: ownerEmail, password: 'Password123!' });
  const token = sess.session.access_token;

  const guardar = async (endpoint) => client.from('push_subscriptions').upsert({
    endpoint, business_id: bizId, user_id: uid, role: 'owner', professional_id: null,
    ...(await clavesDePrueba()), baja_at: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  const pushNuevoTurno = (extra = {}) => callFn('send-push', SERVICE_ROLE_KEY, {
    businessId: bizId, title: 'Nuevo turno', body: `Prueba reservó Masaje · 16/10 08:00 (${suffix})`, ...extra,
  });

  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

  console.log('=== Suscripción que el servicio de push da por muerta (410) ===');
  {
    const { error } = await guardar(muerto);
    ok(!error, `el dueño registra su celular — ${error?.message || 'ok'}`);
    const { status, data } = await pushNuevoTurno();
    ok(status === 200 && data.enviados === 0 && data.fallidos === 1, `send-push no entrega — ${status} ${JSON.stringify(data)}`);
    ok(data.avisadosPorMail === 1, `y le manda el aviso por mail — avisadosPorMail=${data.avisadosPorMail}`);
    const { data: fila } = await admin.from('push_subscriptions').select('baja_at').eq('endpoint', muerto).maybeSingle();
    ok(Boolean(fila?.baja_at), `la fila queda marcada de baja, no borrada — ${JSON.stringify(fila)}`);
    const mails = await mailsPara(ownerEmail);
    ok(mails.length === 1 && mails[0].Subject.includes('Nuevo turno') && mails[0].Subject.includes('16/10 08:00'),
      `el mail trae el turno — ${mails.map((m) => m.Subject).join(' | ')}`);
  }

  console.log('=== Turnos siguientes con el celular todavía caído ===');
  {
    const { data } = await pushNuevoTurno();
    ok(data.enviados === 0 && data.fallidos === 0, `ya no se le manda al endpoint de baja — ${JSON.stringify(data)}`);
    ok(data.avisadosPorMail === 1, `pero el aviso sigue llegando por mail — avisadosPorMail=${data.avisadosPorMail}`);
  }
  {
    const { data } = await pushNuevoTurno({ respaldoMail: false });
    ok(data.avisadosPorMail === 0, `respaldoMail:false (cancelación del cliente, ya va por notify-cancellation) no manda mail — ${JSON.stringify(data)}`);
  }

  console.log('=== Lo que ve el navegador (pushTokenRegistrado / prueba) ===');
  {
    const { data } = await client.from('push_subscriptions').select('endpoint').eq('endpoint', muerto).is('baja_at', null).maybeSingle();
    ok(data === null, 'la suscripción de baja no cuenta como registrada → el panel pide una nueva');
    const { status } = await callFn('enviar-push-de-prueba', token, {});
    ok(status === 412, `la prueba no intenta mandarle a la de baja (412) — recibido ${status}`);
  }

  console.log('=== El celular se vuelve a registrar ===');
  {
    // Lo que hace registrarDispositivo: borra la fila vieja y guarda la nueva.
    const { error: errBorrar } = await client.from('push_subscriptions').delete().eq('endpoint', muerto).eq('business_id', bizId);
    const { error } = await guardar(vivo);
    ok(!errBorrar && !error, `borra la caída y guarda la nueva — ${errBorrar?.message || error?.message || 'ok'}`);
    await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
    const { data } = await pushNuevoTurno();
    ok(data.enviados === 1 && data.avisadosPorMail === 0, `llega el push y no hay mail — ${JSON.stringify(data)}`);
    ok((await mailsPara(ownerEmail)).length === 0, 'Mailpit sin mails nuevos');
  }

  console.log('=== Un dispositivo vivo y otro caído ===');
  {
    await guardar(muerto);
    await admin.from('push_subscriptions').update({ baja_at: new Date().toISOString() }).eq('endpoint', muerto);
    const { data } = await pushNuevoTurno();
    ok(data.enviados === 1 && data.avisadosPorMail === 0, `si le llegó a uno, no hace falta mail — ${JSON.stringify(data)}`);
  }

  console.log('=== Caída hace más de 30 días ===');
  {
    await admin.from('push_subscriptions').delete().eq('endpoint', vivo);
    await admin.from('push_subscriptions').update({ baja_at: new Date(Date.now() - 31 * 864e5).toISOString() }).eq('endpoint', muerto);
    const { data } = await pushNuevoTurno();
    ok(data.status === 'sin-destinatarios', `se deja de mandar el respaldo — ${JSON.stringify(data)}`);
    const { data: fila } = await admin.from('push_subscriptions').select('endpoint').eq('endpoint', muerto).maybeSingle();
    ok(fila === null, 'y la fila se borra');
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  await admin.from('businesses').delete().eq('id', bizId);
  await admin.auth.admin.deleteUser(uid);
  process.exit(fallaron > 0 ? 1 : 0);
}
main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
