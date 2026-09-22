// Prueba de procesarRecordatorios (el cuerpo de la función programada
// enviarRecordatorios) contra el emulador: quién recibe el recordatorio de
// email, quién no, y que la ventana horaria (7:00–20:00) y la de 3 horas
// antes se respeten. No manda mail de verdad: procesarRecordatorios acepta
// una función de envío inyectable (segundo parámetro) — acá se le pasa una
// falsa que solo anota el "envío" en memoria, para poder revisar después el
// asunto y el texto de cada uno.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-recordatorios-emulador.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8180';
process.env.GCLOUD_PROJECT = PROJECT;
// Solo para que el asunto "remitente" del mail se arme igual que en
// producción (ver textoRecordatorio en functions/index.js); el envío real
// nunca ocurre, lo intercepta enviarMailFalso de acá abajo.
process.env.GMAIL_USER = 'avisos.prueba@example.com';

initializeApp({ projectId: PROJECT });
const db = getFirestore();

const enviosSimulados = [];
const enviarMailFalso = async (opts) => {
  enviosSimulados.push(opts);
  return { messageId: 'fake-' + enviosSimulados.length };
};

const { procesarRecordatorios: procesarRecordatoriosReal } = await import('../functions/index.js');
// Envuelto para no tener que pasar enviarMailFalso en cada llamada de abajo.
const procesarRecordatorios = (instante) => procesarRecordatoriosReal(instante, enviarMailFalso);

let ok = 0, mal = 0;
const chequear = (desc, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  ok    ${desc}`); }
  else { mal++; console.log(`  FALLA ${desc}\n        ${detalle}`); }
};

const hoyISO = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const HOY = hoyISO();

/** Date que representa HOY a las HH:MM hora de Buenos Aires (UTC-3 fijo, sin horario de verano). */
const hoyALas = (hhmm) => new Date(`${HOY}T${hhmm}:00-03:00`);

async function limpiar() {
  for (const d of (await db.collection('businesses').get()).docs) {
    for (const sub of ['professionals', 'appointments']) {
      for (const x of (await d.ref.collection(sub).get()).docs) await x.ref.delete();
    }
    await d.ref.delete();
  }
}
await limpiar();

// ── Escenario: dos negocios, cada uno con un profesional ───────────────────
async function negocio(id, nombre) {
  await db.doc(`businesses/${id}`).set({ name: nombre, address: 'Calle Falsa 123', phone: '+54 11 0000-0000' });
  await db.doc(`businesses/${id}/professionals/prof-1`).set({ name: `Profesional de ${nombre}` });
}
await negocio('biz-a', 'Negocio A');
await negocio('biz-b', 'Negocio B');

async function turno(bizId, id, { startTime, status = 'confirmada', clientEmail = 'cliente@example.com', reminderSentAt = null, serviceName = 'Corte' }) {
  await db.doc(`businesses/${bizId}/appointments/${id}`).set({
    id, businessId: bizId, professionalId: 'prof-1', serviceId: 'srv-1', serviceName,
    appointmentDate: HOY, startTime, endTime: startTime,
    status, clientName: 'Cliente de Prueba', clientEmail, clientPhone: '+5491111111111',
    userId: 'uid-cliente', ...(reminderSentAt ? { reminderSentAt } : {}),
  });
}

// "Ahora" de prueba: mediodía, bien adentro de la ventana 7–20.
const AHORA = hoyALas('12:00');

await turno('biz-a', 'a1-en-1h',        { startTime: '13:00' }); // dentro de las 3 hs → se manda
await turno('biz-a', 'a2-en-2h59',      { startTime: '14:59' }); // límite, adentro → se manda
await turno('biz-a', 'a3-en-3h01',      { startTime: '15:01' }); // recién pasa el límite → NO
await turno('biz-a', 'a4-ya-paso',      { startTime: '11:00' }); // ya ocurrió → NO
await turno('biz-a', 'a5-cancelado',    { startTime: '13:30', status: 'cancelada' }); // NO
await turno('biz-a', 'a6-sin-email',    { startTime: '13:30', clientEmail: '' }); // walk-in sin mail → NO
await turno('biz-a', 'a7-ya-avisado',   { startTime: '13:45', reminderSentAt: new Date() }); // NO
await turno('biz-b', 'b1-otro-negocio', { startTime: '13:15' }); // negocio distinto, también adentro → se manda

console.log(`\nCorriendo procesarRecordatorios (ahora = ${HOY} 12:00 ART)...`);
let res = await procesarRecordatorios(AHORA);

console.log('\nQuién recibió el recordatorio:');
chequear('se mandaron exactamente 3 (a1, a2, b1)', res.enviados === 3, JSON.stringify(res));
chequear('0 fallidos', res.fallidos === 0, JSON.stringify(res));

const destinos = enviosSimulados.map((m) => m.to);
chequear('a1 (en 1 hora) recibió el mail', (await db.doc('businesses/biz-a/appointments/a1-en-1h').get()).data().reminderSentAt != null);
chequear('a2 (límite 2h59) recibió el mail', (await db.doc('businesses/biz-a/appointments/a2-en-2h59').get()).data().reminderSentAt != null);
chequear('b1 (otro negocio) también recibió el mail', (await db.doc('businesses/biz-b/appointments/b1-otro-negocio').get()).data().reminderSentAt != null);

console.log('\nQuién NO tenía que recibirlo:');
chequear('a3 (recién pasa las 3 hs) no se mandó', !(await db.doc('businesses/biz-a/appointments/a3-en-3h01').get()).data().reminderSentAt);
chequear('a4 (ya pasó) no se mandó', !(await db.doc('businesses/biz-a/appointments/a4-ya-paso').get()).data().reminderSentAt);
chequear('a5 (cancelado) no se mandó', !(await db.doc('businesses/biz-a/appointments/a5-cancelado').get()).data().reminderSentAt);
chequear('a6 (sin email) no se mandó', !(await db.doc('businesses/biz-a/appointments/a6-sin-email').get()).data().reminderSentAt);

console.log('\nContenido del mail:');
const mailA1 = enviosSimulados.find((m) => m.to === 'cliente@example.com' && m.subject.includes('13:00'));
chequear('el asunto tiene el negocio y la hora', Boolean(mailA1), JSON.stringify(destinos));
chequear('el remitente es el Gmail configurado', mailA1?.from.includes('avisos.prueba@example.com'), mailA1?.from);
chequear('el cuerpo menciona al profesional', mailA1?.text.includes('Profesional de Negocio A'), mailA1?.text);
chequear('el cuerpo menciona el servicio', mailA1?.text.includes('Corte'), mailA1?.text);
chequear('el cuerpo menciona la dirección', mailA1?.text.includes('Calle Falsa 123'), mailA1?.text);

console.log('\nIdempotencia (correr de nuevo con el mismo "ahora"):');
const enviosAntes = enviosSimulados.length;
res = await procesarRecordatorios(AHORA);
chequear('la segunda corrida no reenvía nada', res.enviados === 0, JSON.stringify(res));
chequear('no se mandó ningún mail nuevo', enviosSimulados.length === enviosAntes, `${enviosSimulados.length} vs ${enviosAntes}`);

console.log('\nVentana horaria (7:00–20:00 hora de Buenos Aires):');
res = await procesarRecordatorios(hoyALas('06:59'));
chequear('a las 6:59 no manda nada (antes de las 7)', res.motivo === 'fuera-de-horario' && res.enviados === 0, JSON.stringify(res));

res = await procesarRecordatorios(hoyALas('20:00'));
chequear('a las 20:00 no manda nada (llegó el límite)', res.motivo === 'fuera-de-horario' && res.enviados === 0, JSON.stringify(res));

// Turno nuevo, sin avisar, bien adentro del horario límite (19:59).
await turno('biz-a', 'a8-borde-noche', { startTime: '22:00' }); // > 3hs desde las 19:59, no debería mandarse todavía
res = await procesarRecordatorios(hoyALas('19:59'));
chequear('a las 19:59 SÍ procesa (último minuto de la ventana)', res.motivo !== 'fuera-de-horario', JSON.stringify(res));

console.log('\nSin credenciales configuradas (camino real, sin la función de envío de prueba):');
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
res = await procesarRecordatoriosReal(AHORA); // sin el override: pasa por obtenerTransportador() de verdad
chequear('sin GMAIL_USER/GMAIL_APP_PASSWORD, no manda nada', res.motivo === 'sin-credenciales' && res.enviados === 0, JSON.stringify(res));

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
