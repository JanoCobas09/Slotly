// Prueba de punta a punta de send-reminders, contra el stack local. El
// correo de verdad lo recibe Mailpit (el SMTP de prueba que ya trae
// `supabase start`, ver supabase/functions/.env) — se verifica ahí que el
// mail llegó, no solo que la función dijo "enviado".

import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const MAILPIT_URL = 'http://127.0.0.1:55324';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) { if (cond) { pasaron++; console.log(`  ok    ${label}`); } else { fallaron++; console.log(`  FALLA ${label}`); } }

async function callSendReminders(token, body) {
  const res = await fetch(`${API_URL}/functions/v1/send-reminders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// 'YYYY-MM-DDTHH:mm' en horario de Argentina (UTC-3, sin horario de verano)
// -> instante real en UTC. Evita depender de la hora de la máquina que
// corre el test, igual que el parámetro `instante` de procesarRecordatorios.
function instanteArgentina(fechaHora) {
  return new Date(`${fechaHora}:00-03:00`);
}

async function main() {
  // La búsqueda de Mailpit matchea por tokens, no por dirección exacta —
  // con el buzón sucio de corridas anteriores, un "to:cliente-x@..." puede
  // devolver mails de otra corrida que comparten el mismo prefijo. Se
  // arranca en limpio y además se valida la dirección exacta más abajo.
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

  console.log('=== Guarda: solo la propia service role key puede llamarla ===');
  {
    const { status } = await callSendReminders(ANON_KEY, {});
    ok(status === 401, `rechaza el anon key (401) — recibido ${status}`);
  }

  console.log('=== Fuera de la ventana horaria (22:00 ART) no manda nada ===');
  {
    const { status, data } = await callSendReminders(SERVICE_ROLE_KEY, { instante: instanteArgentina('2026-09-23T22:00').toISOString() });
    ok(status === 200 && data.motivo === 'fuera-de-horario' && data.enviados === 0, `no manda nada — ${JSON.stringify(data)}`);
  }

  console.log('=== Turno dentro de la ventana de 3hs manda el mail de verdad ===');
  const bizId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const clientEmail = `cliente-recordatorio-${Date.now()}@example.com`;
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Recordatorios', slug: `negocio-recordatorios-${Date.now()}`, address: 'Calle Falsa 123', phone: '1122334455' });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Profesional Test' });
  const ahora = instanteArgentina('2026-09-23T10:00');
  const { data: apt } = await admin.from('appointments').insert({
    business_id: bizId, professional_id: profId, appointment_date: '2026-09-23', start_time: '12:00',
    client_name: 'Cliente Prueba', client_email: clientEmail, service_name: 'Corte', status: 'pendiente', type: 'client',
  }).select('id').single();
  {
    const { status, data } = await callSendReminders(SERVICE_ROLE_KEY, { instante: ahora.toISOString() });
    ok(status === 200 && data.enviados === 1 && data.fallidos === 0, `manda 1 recordatorio — ${JSON.stringify(data)}`);
  }
  {
    const { data: aptActualizado } = await admin.from('appointments').select('reminder_sent_at').eq('id', apt.id).maybeSingle();
    ok(Boolean(aptActualizado.reminder_sent_at), 'quedó marcado reminder_sent_at');
  }
  {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(clientEmail)}`);
    const search = await res.json();
    // La búsqueda de Mailpit es por tokens, así que se filtra client-side
    // por la dirección exacta en vez de confiar en `total` a ciegas.
    const exactos = (search.messages || []).filter((m) => m.To.some((t) => t.Address === clientEmail));
    ok(exactos.length === 1, `Mailpit recibió exactamente 1 mail para esa dirección — ${JSON.stringify(exactos.length)}`);
    if (exactos.length === 1) {
      ok(exactos[0].Subject.includes('12:00') && exactos[0].Subject.includes('Negocio Recordatorios'), `asunto correcto — "${exactos[0].Subject}"`);
    }
  }

  console.log('=== Correr de nuevo NO manda el mismo recordatorio otra vez ===');
  {
    const { status, data } = await callSendReminders(SERVICE_ROLE_KEY, { instante: ahora.toISOString() });
    ok(status === 200 && data.enviados === 0 && data.candidatos === 0, `no hay candidatos (ya se marcó) — ${JSON.stringify(data)}`);
  }

  console.log('=== Un turno a más de 3hs todavía no entra en la ventana ===');
  const { data: aptLejano } = await admin.from('appointments').insert({
    business_id: bizId, professional_id: profId, appointment_date: '2026-09-23', start_time: '18:00',
    client_name: 'Cliente Lejano', client_email: `lejano-${Date.now()}@example.com`, service_name: 'Corte', status: 'pendiente', type: 'client',
  }).select('id').single();
  {
    const { status, data } = await callSendReminders(SERVICE_ROLE_KEY, { instante: ahora.toISOString() });
    ok(status === 200 && data.enviados === 0, `todavía no le toca (18:00 - 10:00 > 3hs) — ${JSON.stringify(data)}`);
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  await admin.from('businesses').delete().eq('id', bizId);
  process.exit(fallaron > 0 ? 1 : 0);
}
main().catch((err) => { console.error('Error inesperado:', err); process.exit(1); });
