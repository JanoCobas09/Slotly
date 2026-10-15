// Turnos fijos y feriados (20261027000000_turnos_fijos_y_feriados.sql), contra
// el stack local (`npx supabase start`). Solo base: no hacen falta las Edge
// Functions.
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

const usuarios = [];
async function usuario(prefijo, appMetadata = {}) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  usuarios.push(data.user.id);
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (e2) throw e2;
  const db = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
  return { id: data.user.id, db };
}

// Fechas en hora de Argentina, como la base.
const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const sumar = (iso, dias) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
/** El próximo día (desde mañana) con ese día de la semana (0 = domingo). */
const proximo = (diaSemana, desde = sumar(hoyAR(), 1)) => { let f = desde; while (dow(f) !== diaSemana) f = sumar(f, 1); return f; };

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  const ana = crypto.randomUUID();
  const beto = crypto.randomUUID();
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Turnos Fijos', slug: `negocio-fijos-${suffix}` });
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 8000 });
  await admin.from('professionals').insert([{ id: ana, business_id: bizId, name: 'Ana' }, { id: beto, business_id: bizId, name: 'Beto' }]);
  await admin.from('professional_services').insert([
    { business_id: bizId, professional_id: ana, service_id: srvId },
    { business_id: bizId, professional_id: beto, service_id: srvId, custom_price: 9000 },
  ]);
  // Lunes a viernes (day_of_week 0..4 = lunes..viernes), 9 a 18.
  await admin.from('schedules').insert([ana, beto].flatMap((p) => [0, 1, 2, 3, 4].map((d) => ({
    business_id: bizId, professional_id: p, day_of_week: d, start_time: '09:00', end_time: '18:00',
  }))));

  const dueno = await usuario('dueno-fijos', { business_id: bizId, role: 'owner' });
  const staffBeto = await usuario('staff-beto-fijos', { business_id: bizId, role: 'admin', professional_id: beto });

  const crear = (quien, extra) => quien.db.rpc('crear_turno_fijo', {
    p_business_id: bizId, p_professional_id: ana, p_service_id: srvId,
    p_hora: '10:00', p_frecuencia: 'semanal', p_fecha_fin: null,
    p_client_name: 'Juan Fijo', p_client_phone: '1123456789', p_client_email: 'juan@example.com', p_notes: 'Corte de siempre',
    ...extra,
  });
  const turnosDe = async (id) => (await admin.from('appointments').select('appointment_date, start_time, end_time, type, status, client_email, price').eq('turno_fijo_id', id).order('appointment_date')).data || [];

  console.log('Semanal, sin fecha de fin:');
  const miercoles = proximo(3);
  // Un bloqueo en la 3ra fecha y otro turno en la 4ta, antes de crear la serie.
  await admin.from('blocked_days').insert({ business_id: bizId, date: sumar(miercoles, 14) });
  await admin.from('appointments').insert({
    business_id: bizId, professional_id: ana, service_id: srvId, appointment_date: sumar(miercoles, 21),
    start_time: '10:00', end_time: '10:30', status: 'confirmada', type: 'manual', client_name: 'Otro',
  });
  const { data: r1, error: e1 } = await crear(dueno, { p_fecha_inicio: miercoles });
  ok(!e1 && r1?.id, `el dueño lo crea — ${e1?.message || ''}`);
  const t1 = await turnosDe(r1.id);
  const esperadas = [];
  for (let f = miercoles; f <= sumar(hoyAR(), 56); f = sumar(f, 7)) esperadas.push(f);
  ok(t1.length === esperadas.length - 2, `agenda las próximas 8 semanas menos las 2 que chocan (${t1.length} de ${esperadas.length})`);
  ok(t1.every((t) => dow(t.appointment_date) === 3 && t.start_time === '10:00' && t.end_time === '10:30'), 'todos miércoles 10:00 a 10:30');
  ok(t1.every((t) => t.type === 'manual' && t.status === 'confirmada' && t.client_email === 'juan@example.com' && Number(t.price) === 8000), 'turnos normales: manual, confirmados, con el mail (recordatorio) y el precio');
  const motivos = Object.fromEntries((r1.saltados || []).map((s) => [s.fecha, s.motivo]));
  ok(motivos[sumar(miercoles, 14)] === 'Día u horario bloqueado', `saltea el día bloqueado — ${JSON.stringify(motivos)}`);
  ok(motivos[sumar(miercoles, 21)] === 'Ya había otro turno en ese horario', 'saltea el horario ya ocupado');
  const { data: sal } = await admin.from('turnos_fijos_saltados').select('fecha').eq('turno_fijo_id', r1.id);
  ok(sal?.length === 2, 'y quedan anotadas');

  console.log('Generar de nuevo no duplica ni revive:');
  await admin.from('appointments').update({ status: 'cancelada', cancelled_by: 'business' }).eq('turno_fijo_id', r1.id).eq('appointment_date', miercoles);
  await admin.from('turnos_fijos').update({ generado_hasta: null }).eq('id', r1.id);
  await admin.rpc('extender_turnos_fijos');
  const t1b = await turnosDe(r1.id);
  ok(t1b.length === t1.length, `misma cantidad (${t1b.length})`);
  ok(t1b.find((t) => t.appointment_date === miercoles)?.status === 'cancelada', 'la fecha cancelada a mano sigue cancelada');

  console.log('Cada 2 semanas, con fecha de fin:');
  const jueves = proximo(4);
  const { data: r2 } = await crear(dueno, { p_fecha_inicio: jueves, p_frecuencia: 'quincenal', p_fecha_fin: sumar(jueves, 30), p_hora: '12:00' });
  const t2 = await turnosDe(r2.id);
  ok(t2.map((t) => t.appointment_date).join(',') === [jueves, sumar(jueves, 14), sumar(jueves, 28)].join(','), `cada 14 días hasta la fecha de fin — ${t2.map((t) => t.appointment_date)}`);

  console.log('Cada 3 semanas:');
  const lunes = proximo(1);
  const { data: r3 } = await crear(dueno, { p_fecha_inicio: lunes, p_frecuencia: 'cada_3_semanas', p_hora: '15:00' });
  const t3 = await turnosDe(r3.id);
  ok(t3.length >= 2 && t3.every((t, i) => i === 0 || sumar(t3[i - 1].appointment_date, 21) === t.appointment_date), `cada 21 días — ${t3.map((t) => t.appointment_date)}`);

  console.log('Mensual (el mismo día de la semana del mes):');
  const { data: m1 } = await admin.rpc('fecha_mensual', { p_anio: 2026, p_mes: 11, p_dow: 3, p_n: 2 });
  ok(m1 === '2026-11-11', `2do miércoles de noviembre 2026 = 11/11 (${m1})`);
  const { data: m2 } = await admin.rpc('fecha_mensual', { p_anio: 2026, p_mes: 11, p_dow: 1, p_n: 5 });
  ok(m2 === '2026-11-30', `5ta semana = último lunes de noviembre = 30/11 (${m2})`);
  const { data: m3 } = await admin.rpc('fecha_mensual', { p_anio: 2026, p_mes: 12, p_dow: 2, p_n: 1 });
  ok(m3 === '2026-12-01', `1er martes de diciembre = 01/12 (${m3})`);
  const martes = proximo(2);
  const { data: r4 } = await crear(dueno, { p_fecha_inicio: martes, p_frecuencia: 'mensual', p_hora: '16:00' });
  const t4 = await turnosDe(r4.id);
  const n = Math.min(5, Math.ceil(Number(martes.slice(8)) / 7));
  ok(t4.length >= 2 && t4.every((t) => dow(t.appointment_date) === 2), `todos martes — ${t4.map((t) => t.appointment_date)}`);
  ok(t4.every((t) => {
    const d = Number(t.appointment_date.slice(8));
    const semana = Math.ceil(d / 7);
    const ultimo = sumar(t.appointment_date, 7).slice(5, 7) !== t.appointment_date.slice(5, 7);
    return n === 5 ? ultimo : semana === n;
  }), `siempre la misma semana del mes (${n === 5 ? 'la última' : `la ${n}°`})`);

  console.log('Permisos:');
  const { error: ep } = await crear(staffBeto, { p_fecha_inicio: miercoles, p_hora: '14:00' });
  ok(ep && /permission-denied/.test(ep.message), `un profesional no puede cargarle turnos fijos a otro — ${ep?.message}`);
  const { data: rb, error: eb } = await staffBeto.db.rpc('crear_turno_fijo', {
    p_business_id: bizId, p_professional_id: beto, p_service_id: srvId, p_fecha_inicio: miercoles,
    p_hora: '11:00', p_frecuencia: 'semanal', p_fecha_fin: null, p_client_name: 'Cliente de Beto',
  });
  ok(!eb && rb?.creados > 0, `sí los suyos — ${eb?.message || ''}`);
  const tb = await turnosDe(rb.id);
  ok(Number(tb[0]?.price) === 9000, 'con el precio propio del profesional');
  const { data: vistosBeto } = await staffBeto.db.from('turnos_fijos').select('id');
  ok(vistosBeto?.length === 1 && vistosBeto[0].id === rb.id, 'y solo ve los suyos');
  const { error: ev } = await crear(dueno, { p_fecha_inicio: sumar(hoyAR(), -1) });
  ok(ev && /pasado/.test(ev.message), 'no se puede empezar en el pasado');

  console.log('Terminar un turno fijo:');
  const desde = sumar(miercoles, 28);
  const { data: borrados } = await dueno.db.rpc('terminar_turno_fijo', { p_id: r1.id, p_desde: desde });
  const t1c = await turnosDe(r1.id);
  ok(borrados > 0 && t1c.every((t) => t.appointment_date < desde), `borra los de esa fecha en adelante (${borrados}) y deja los anteriores`);
  const { data: tf1 } = await admin.from('turnos_fijos').select('activo, fecha_fin').eq('id', r1.id).single();
  ok(tf1.activo === false && tf1.fecha_fin === sumar(desde, -1), 'y no agenda más');
  await admin.rpc('extender_turnos_fijos');
  ok((await turnosDe(r1.id)).length === t1c.length, 'el cron no lo revive');

  console.log('El cron avisa las fechas que no pudo agendar:');
  const vie = proximo(5);
  const { data: r5 } = await crear(dueno, { p_fecha_inicio: vie, p_hora: '09:00', p_client_name: 'Lucía Viernes' });
  const ultima = (await turnosDe(r5.id)).at(-1).appointment_date;
  const siguiente = sumar(ultima, 7);
  await admin.from('blocked_days').insert({ business_id: bizId, date: siguiente, professional_id: ana });
  await admin.from('turnos_fijos').update({ generado_hasta: ultima }).eq('id', r5.id);
  // Simula que pasó una semana: el horizonte del cron llega a `siguiente`.
  await admin.rpc('generar_turnos_fijos', { p_id: r5.id, p_hasta: siguiente, p_avisar: true });
  const { data: avisos } = await admin.from('notifications').select('title, body').eq('business_id', bizId).eq('type', 'turno_fijo_saltado');
  ok(avisos?.some((a) => a.body.includes('Lucía Viernes') && a.body.includes('bloqueado')), `aviso en la campanita — ${JSON.stringify(avisos)}`);

  console.log('Feriados:');
  const { data: ferPub, error: eFer } = await createClient(API_URL, ANON_KEY).from('feriados').select('fecha, nombre').gte('fecha', hoyAR()).order('fecha');
  ok(!eFer && ferPub?.length > 0, `la lista es pública (${ferPub?.length} por venir)`);
  const { data: bloqAntes } = await admin.from('blocked_days').select('id').eq('business_id', bizId).not('feriado', 'is', null);
  ok((bloqAntes || []).length === 0, 'por defecto el negocio atiende: no se bloquea nada');
  await admin.from('businesses').update({ feriados: 'cierra' }).eq('id', bizId);
  const { data: bloq } = await admin.from('blocked_days').select('date, feriado, feriado_auto').eq('business_id', bizId).eq('feriado_auto', true);
  ok(bloq?.length === ferPub.length && bloq.every((b) => b.feriado), `al elegir "cierro", cada feriado que viene queda bloqueado con su nombre (${bloq?.length})`);

  // Un turno fijo que cae en feriado lo saltea con el nombre.
  const feriadoHabil = ferPub.find((f) => [1, 2, 3, 4, 5].includes(dow(f.fecha)) && f.fecha <= sumar(hoyAR(), 56) && f.fecha > hoyAR());
  if (feriadoHabil) {
    // Semanal desde el primer día con el mismo día de la semana que el feriado: lo va a pisar.
    const { data: r6 } = await crear(dueno, { p_fecha_inicio: proximo(dow(feriadoHabil.fecha)), p_hora: '17:00', p_client_name: 'Feriado Test' });
    const m6 = (r6?.saltados || []).find((s) => s.fecha === feriadoHabil.fecha);
    ok(m6?.motivo === `Feriado: ${feriadoHabil.nombre}`, `saltea el feriado con su nombre — ${JSON.stringify(m6)}`);
  } else {
    ok(true, 'no hay feriados hábiles en las próximas 8 semanas (se saltea la prueba)');
  }

  // Abrir un feriado: no vuelve a cerrarse.
  const abierto = bloq[0].date;
  await dueno.db.from('blocked_days').delete().eq('business_id', bizId).eq('date', abierto).eq('feriado_auto', true);
  const { data: ab } = await admin.from('feriados_abiertos').select('fecha').eq('business_id', bizId);
  ok(ab?.some((a) => a.fecha === abierto), 'borrar uno lo deja "abierto"');
  await admin.rpc('aplicar_feriados_todos');
  const { data: reab } = await admin.from('blocked_days').select('id').eq('business_id', bizId).eq('date', abierto);
  ok((reab || []).length === 0, 'y el cron no lo vuelve a cerrar');
  // Cerrarlo a mano de nuevo lo saca de abiertos y lleva el nombre.
  await dueno.db.from('blocked_days').insert({ business_id: bizId, date: abierto });
  const { data: manual } = await admin.from('blocked_days').select('feriado, feriado_auto').eq('business_id', bizId).eq('date', abierto).single();
  ok(manual.feriado && manual.feriado_auto === false, `cerrarlo a mano le pone el nombre (${manual.feriado})`);

  // Pasar a "atiendo": se van los automáticos, queda el manual.
  await admin.from('businesses').update({ feriados: 'atiende' }).eq('id', bizId);
  const { data: quedan } = await admin.from('blocked_days').select('date, feriado_auto').eq('business_id', bizId).not('feriado', 'is', null);
  ok(quedan?.length === 1 && quedan[0].date === abierto && !quedan[0].feriado_auto, `al volver a "atiendo" se sacan los automáticos y queda el que cerró a mano (${quedan?.length})`);

  await admin.from('businesses').delete().eq('id', bizId);
  for (const id of usuarios) await admin.auth.admin.deleteUser(id);
}

main()
  .catch((err) => { fallaron++; console.error(err); })
  .finally(() => {
    console.log(`\n${pasaron} ok, ${fallaron} fallas`);
    process.exit(fallaron ? 1 : 0);
  });
