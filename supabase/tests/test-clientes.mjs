// Sección Clientes: fichas, vínculo con turnos, historial, comentarios y
// archivos. Contra el stack local:
//   npx supabase start
//   npx supabase functions serve --env-file supabase/functions/.env
//   node supabase/tests/test-clientes.mjs
// Ver 20261023000000_clientes.sql y PLAN-CLIENTES.md. Cuentas reales con la
// sesión de cada rol: lo que se prueba es la RLS y las funciones, no la UI.
import { createClient } from '@supabase/supabase-js';

const API_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
// La Edge Function local compara contra la clave nueva (sb_secret_...): ver
// "Hallazgo importante de claves" en CLAUDE.md.
// Sale de `npx supabase status` (SECRET_KEY): no va escrita acá. Sin ella, se
// prueba con la service role.
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || SERVICE_ROLE_KEY;
const BUCKET = 'turno-adjuntos';

const admin = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pasaron = 0, fallaron = 0;
function ok(cond, label) {
  if (cond) { pasaron++; console.log(`  ok    ${label}`); }
  else { fallaron++; console.log(`  FALLA ${label}`); }
}

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function usuario(prefijo, appMetadata = {}, nombreGoogle = null) {
  const email = `${prefijo}-${sufijo()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Password123!', email_confirm: true, app_metadata: appMetadata,
    user_metadata: nombreGoogle ? { full_name: nombreGoogle } : {},
  });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (e2) throw e2;
  const db = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
  return { id: data.user.id, email, token: s.session.access_token, db };
}

async function fn(name, token, body = {}) {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function negocio(nombre, rubro) {
  const { data, error } = await admin.from('businesses')
    .insert({ name: nombre, slug: `${nombre.toLowerCase().replace(/\W+/g, '-')}-${sufijo()}`, profession_category: rubro, max_advance_days: null, min_advance_hours: null })
    .select('*').single();
  if (error) throw error;
  return data;
}

const fechaISO = (dias) => {
  const d = new Date(Date.now() + dias * 86400000);
  return d.toISOString().slice(0, 10);
};

let minuto = 0;
/** Turno insertado como lo haría el servidor (sin sesión): los 'client' se vinculan solos. */
async function turno(biz, prof, extra = {}) {
  minuto += 1;
  const h = String(8 + Math.floor(minuto / 60) % 12).padStart(2, '0');
  const m = String(minuto % 60).padStart(2, '0');
  const { data, error } = await admin.from('appointments').insert({
    business_id: biz.id, professional_id: prof.id, appointment_date: fechaISO(-1), start_time: `${h}:${m}`,
    status: 'confirmada', type: 'client', client_name: 'Nombre tipeado', ...extra,
  }).select('*').single();
  if (error) throw error;
  return data;
}

// Bytes mínimos con la firma de cada tipo.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG_GRANDE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(11 * 1024 * 1024, 7)]);

async function subir(db, ruta, buffer, tipo) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(ruta);
  if (error) return { error };
  const res = await fetch(data.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': tipo, 'x-upsert': 'false', apikey: ANON_KEY },
    body: buffer,
  });
  return { status: res.status, error: res.ok ? null : new Error(`PUT ${res.status} ${await res.text()}`) };
}

async function main() {
  // ── Escenario ──────────────────────────────────────────────────────────
  const A = await negocio('Peluqueria Clientes', 'beauty');
  const B = await negocio('Consultorio Clientes', 'healthcare'); // privacidad activada por rubro
  const [p1, p2] = (await admin.from('professionals').insert([
    { business_id: A.id, name: 'Profe Uno' }, { business_id: A.id, name: 'Profe Dos' },
  ]).select('id')).data;
  const pB = (await admin.from('professionals').insert({ business_id: B.id, name: 'Dra B' }).select('id').single()).data;
  const [s1, s2] = (await admin.from('services').insert([
    { business_id: A.id, name: 'Corte', duration_minutes: 30, price: 1000 },
    { business_id: A.id, name: 'Color', duration_minutes: 60, price: 3000 },
  ]).select('id')).data;

  const duenoA = await usuario('dueno-a', { business_id: A.id, role: 'owner' }, 'Dueño A');
  const duenoB = await usuario('dueno-b', { business_id: B.id, role: 'owner' }, 'Dueña B');
  const staff1 = await usuario('staff1', { business_id: A.id, role: 'admin', professional_id: p1.id }, 'Profe Uno');
  const staff2 = await usuario('staff2', { business_id: A.id, role: 'admin', professional_id: p2.id }, 'Profe Dos');
  const plataforma = await usuario('plat', { platform: true });
  const clienteX = await usuario('cliente-x', {}, 'José Pérez');
  const clienteY = await usuario('cliente-y', {}, 'Ana Gómez');

  console.log('\nVínculo automático y duplicados:');
  const t1 = await turno(A, p1, { user_id: clienteX.id, service_id: s1.id, service_name: 'Corte', appointment_date: fechaISO(-30) });
  const t2 = await turno(A, p1, { user_id: clienteX.id, service_id: s2.id, service_name: 'Color', appointment_date: fechaISO(-10) });
  const t3 = await turno(A, p2, { user_id: clienteX.id, service_id: s1.id, service_name: 'Corte', appointment_date: fechaISO(5) });
  ok(t1.cliente_id && t1.cliente_id === t2.cliente_id && t2.cliente_id === t3.cliente_id, '1. un cliente con varios turnos: todos en la misma ficha');
  const { count: fichasX } = await admin.from('clientes').select('id', { count: 'exact', head: true }).eq('business_id', A.id).eq('user_id', clienteX.id);
  ok(fichasX === 1, 'reservar varias veces no duplica la ficha');
  const fichaX = (await admin.from('clientes').select('*').eq('id', t1.cliente_id).single()).data;
  ok(fichaX.nombre === 'José Pérez' && fichaX.email === clienteX.email, 'la ficha arranca con el nombre de Google y el mail de la cuenta');
  const tB = await turno(B, pB, { user_id: clienteX.id });
  ok(tB.cliente_id && tB.cliente_id !== t1.cliente_id, 'la misma persona en otro negocio tiene otra ficha');

  await duenoA.db.from('clientes').update({ nombre: 'Pepe (cliente fiel)' }).eq('id', fichaX.id);
  await turno(A, p1, { user_id: clienteX.id, appointment_date: fechaISO(-2) });
  const fichaX2 = (await admin.from('clientes').select('nombre').eq('id', fichaX.id).single()).data;
  ok(fichaX2.nombre === 'Pepe (cliente fiel)', 'una reserva nueva no pisa el nombre que puso el negocio');

  const ty = await turno(A, p2, { user_id: clienteY.id, appointment_date: fechaISO(-3), client_name: 'José Pérez' });
  ok(ty.cliente_id !== fichaX.id, 'mismo nombre tipeado, otra cuenta → otra ficha (nunca por nombre)');

  console.log('\nTurnos cargados a mano:');
  const { data: manual, error: errManual } = await duenoA.db.from('appointments').insert({
    business_id: A.id, professional_id: p1.id, appointment_date: fechaISO(-4), start_time: '19:10',
    status: 'confirmada', type: 'manual', client_name: 'Walter Sin Cuenta', client_phone: '1155554444', user_id: duenoA.id,
  }).select('*').single();
  ok(!errManual && manual.cliente_id === null, 'un turno manual (user_id del dueño) NO crea ficha para el dueño');
  const { error: errUpd } = await staff1.db.from('appointments').update({ cliente_id: fichaX.id }).eq('id', manual.id);
  ok(Boolean(errUpd), 'nadie cambia el vínculo con un UPDATE suelto');
  const { data: nuevaFicha, error: errCrear } = await staff1.db.rpc('crear_cliente_desde_turno', { p_appointment_id: manual.id });
  const manual2 = (await admin.from('appointments').select('cliente_id').eq('id', manual.id).single()).data;
  ok(!errCrear && manual2.cliente_id === nuevaFicha, 'el profesional del turno crea la ficha desde el turno y queda vinculado');
  const { error: errStaff2 } = await staff2.db.rpc('vincular_turno_cliente', { p_appointment_id: manual.id, p_cliente_id: null });
  ok(Boolean(errStaff2), 'otro profesional no puede tocar ese vínculo');
  const { error: errClientType } = await duenoA.db.rpc('vincular_turno_cliente', { p_appointment_id: t1.id, p_cliente_id: nuevaFicha });
  ok(Boolean(errClientType), 'una reserva con cuenta no se re-vincula a otra ficha');
  const { error: errOtroNeg } = await duenoA.db.rpc('vincular_turno_cliente', { p_appointment_id: manual.id, p_cliente_id: tB.cliente_id });
  ok(Boolean(errOtroNeg), 'no se puede vincular a la ficha de otro negocio');

  console.log('\nListado, búsqueda, filtros y paginación:');
  const muchas = Array.from({ length: 30 }, (_, i) => ({ business_id: A.id, nombre: `Cliente Lote ${String(i).padStart(2, '0')}` }));
  await admin.from('clientes').insert(muchas);
  const lista = (p) => duenoA.db.rpc('listar_clientes', { p_business_id: A.id, ...p });
  const pag0 = (await lista({ p_limite: 25, p_offset: 0, p_orden: 'nombre' })).data;
  const pag1 = (await lista({ p_limite: 25, p_offset: 25, p_orden: 'nombre' })).data;
  const total = Number(pag0[0].total);
  ok(pag0.length === 25 && total >= 33 && pag1.length === total - 25, `4. paginación: 25 + ${pag1.length} de ${total}`);
  const nombres = pag0.map((c) => c.nombre.toLowerCase());
  ok(nombres.every((n, i) => i === 0 || nombres[i - 1] <= n), 'orden por nombre');
  ok(!pag0.concat(pag1).some((c) => c.id === tB.cliente_id), '10. el listado solo trae fichas del negocio');
  const busq = (await lista({ p_busqueda: 'jose' })).data;
  ok(busq.length === 0, 'el nombre editado ("Pepe") ya no matchea por el de Google');
  const busqPepe = (await lista({ p_busqueda: 'pepe' })).data;
  ok(busqPepe.length === 1 && busqPepe[0].id === fichaX.id && Number(busqPepe[0].cantidad_turnos) === 4, '5. búsqueda por nombre con contadores');
  const busqAna = (await lista({ p_busqueda: 'gomez' })).data;
  ok(busqAna.length === 1, 'búsqueda sin acentos ("gomez" → "Gómez")');
  const porMail = (await lista({ p_busqueda: clienteX.email.slice(0, 12) })).data;
  ok(porMail.some((c) => c.id === fichaX.id), 'búsqueda por mail');
  const porTel = (await lista({ p_busqueda: '5555 4444' })).data;
  ok(porTel.some((c) => c.id === nuevaFicha), 'búsqueda por teléfono (ignora espacios)');
  const conProx = (await lista({ p_filtro: 'con_proximo' })).data;
  ok(conProx.length === 1 && conProx[0].id === fichaX.id && conProx[0].proximo_turno === t3.appointment_date, 'filtro "con turno próximo"');
  const sinCuenta = (await lista({ p_filtro: 'sin_cuenta', p_limite: 100 })).data;
  ok(sinCuenta.every((c) => !c.con_cuenta) && sinCuenta.length >= 31, 'filtro "sin cuenta"');
  const comillas = await lista({ p_busqueda: "%' or 1=1 --" });
  ok(!comillas.error && comillas.data.length === 0, 'una búsqueda con comodines y comillas no rompe ni trae todo');

  console.log('\nAislamiento y roles:');
  const deOtro = await duenoB.db.rpc('listar_clientes', { p_business_id: A.id });
  ok(!deOtro.error && deOtro.data.length === 0, '10. el dueño de otro negocio no lista estas fichas');
  const fichaAjena = await duenoB.db.rpc('ficha_cliente', { p_cliente_id: fichaX.id });
  ok(fichaAjena.data === null, '10. ni ve la ficha por id');
  const histAjeno = await duenoB.db.rpc('historial_cliente', { p_cliente_id: fichaX.id });
  ok((histAjeno.data || []).length === 0, '10. ni su historial');
  const s1Lista = (await staff1.db.rpc('listar_clientes', { p_business_id: A.id, p_limite: 100 })).data;
  ok(s1Lista.some((c) => c.id === fichaX.id) && !s1Lista.some((c) => c.id === ty.cliente_id), 'el profesional ve solo a quienes atendió');
  const s1Hist = (await staff1.db.rpc('historial_cliente', { p_cliente_id: fichaX.id })).data;
  ok(s1Hist.length === 3 && s1Hist.every((t) => t.professional_id === p1.id), 'y del historial solo sus turnos');
  const { data: s1Edit } = await staff1.db.from('clientes').update({ nombre: 'Hackeado' }).eq('id', fichaX.id).select('id');
  ok((s1Edit || []).length === 0, '11. el profesional no edita la ficha');
  const xVe = await clienteX.db.from('clientes').select('id');
  ok((xVe.data || []).length === 0, 'el cliente final no ve fichas (ni la suya)');
  const { error: errEmail } = await duenoA.db.from('clientes').update({ email: 'otro@example.com' }).eq('id', fichaX.id);
  ok(Boolean(errEmail), 'el mail de una ficha con cuenta no se edita a mano');

  console.log('\nHistorial:');
  const muchos = [];
  for (let i = 0; i < 25; i++) muchos.push(await turno(A, p2, { user_id: clienteY.id, appointment_date: fechaISO(-100 - i), service_id: i % 2 ? s1.id : s2.id, service_name: i % 2 ? 'Corte' : 'Color' }));
  const h0 = (await duenoA.db.rpc('historial_cliente', { p_cliente_id: ty.cliente_id, p_limite: 20, p_offset: 0 })).data;
  const h1 = (await duenoA.db.rpc('historial_cliente', { p_cliente_id: ty.cliente_id, p_limite: 20, p_offset: 20 })).data;
  ok(h0.length === 20 && h1.length === 6 && Number(h0[0].total) === 26, '4. historial paginado de a 20 (26 turnos)');
  const fechas = h0.concat(h1).map((t) => `${t.appointment_date} ${t.start_time}`);
  ok(fechas.every((f, i) => i === 0 || fechas[i - 1] >= f), '3. ordenado del más reciente al más viejo');
  const soloCorte = (await duenoA.db.rpc('historial_cliente', { p_cliente_id: ty.cliente_id, p_servicio_id: s1.id, p_limite: 100 })).data;
  ok(soloCorte.length === 12 && soloCorte.every((t) => t.service_id === s1.id), '5. filtro por servicio');
  const rango = (await duenoA.db.rpc('historial_cliente', { p_cliente_id: ty.cliente_id, p_desde: fechaISO(-110), p_hasta: fechaISO(-105), p_limite: 100 })).data;
  ok(rango.length === 6, '5. filtro por período');
  await duenoA.db.from('appointments').update({ status: 'completada' }).eq('id', muchos[0].id);
  const compl = (await duenoA.db.rpc('historial_cliente', { p_cliente_id: ty.cliente_id, p_estado: 'completada' })).data;
  ok(compl.length === 1 && compl[0].id === muchos[0].id, '15. el cambio de estado se refleja en el historial');
  const fichaY = (await duenoA.db.rpc('ficha_cliente', { p_cliente_id: ty.cliente_id })).data;
  ok(fichaY.completados === 1 && fichaY.total_turnos === 26 && fichaY.puede_editar === true && !('user_id' in fichaY), 'métricas de la ficha (sin exponer user_id)');

  console.log('\nComentarios:');
  const { data: c1, error: errC1 } = await duenoA.db.from('turno_comentarios')
    .insert({ appointment_id: t1.id, texto: 'Pidió turno largo la próxima', business_id: B.id }).select('*').single();
  ok(!errC1 && c1.business_id === A.id && c1.autor_id === duenoA.id && c1.autor_nombre === 'Dueño A', 'el negocio y el autor los pone la base (ignora el business_id del navegador)');
  await staff1.db.from('turno_comentarios').insert({ appointment_id: t1.id, texto: 'Usé tijera fina' });
  await staff1.db.from('turno_comentarios').insert({ appointment_id: t2.id, texto: 'Color 6.1' });
  const cT1 = (await duenoA.db.from('turno_comentarios').select('id').eq('appointment_id', t1.id)).data;
  const cT2 = (await duenoA.db.from('turno_comentarios').select('id').eq('appointment_id', t2.id)).data;
  ok(cT1.length === 2 && cT2.length === 1, '2/14. cada turno conserva sus propios comentarios');
  const { error: errS2 } = await staff2.db.from('turno_comentarios').insert({ appointment_id: t1.id, texto: 'intruso' });
  ok(Boolean(errS2), 'un profesional no comenta turnos ajenos');
  const s2Ve = (await staff2.db.from('turno_comentarios').select('id').eq('appointment_id', t1.id)).data;
  ok(s2Ve.length === 0, 'ni los ve');
  const { data: edAjena } = await staff1.db.from('turno_comentarios').update({ texto: 'cambiado' }).eq('id', c1.id).select('id');
  ok((edAjena || []).length === 0, '11. nadie edita el comentario de otro');
  const { data: borrAjeno } = await staff1.db.from('turno_comentarios').delete().eq('id', c1.id).select('id');
  ok((borrAjeno || []).length === 0, '11. el profesional no borra el comentario del dueño');
  const deStaff = (await admin.from('turno_comentarios').select('id').eq('appointment_id', t1.id).eq('autor_id', staff1.id).single()).data;
  const { data: borrDueno } = await duenoA.db.from('turno_comentarios').delete().eq('id', deStaff.id).select('id');
  ok(borrDueno?.length === 1, 'el dueño puede borrar cualquier comentario');
  const { data: edPropia } = await duenoA.db.from('turno_comentarios').update({ texto: 'Pidió turno largo (editado)' }).eq('id', c1.id).select('updated_at');
  ok(edPropia?.length === 1 && edPropia[0].updated_at, 'el autor edita su comentario y queda marcado como editado');
  ok(((await duenoB.db.from('turno_comentarios').select('id')).data || []).filter((c) => c.id === c1.id).length === 0, '10. otro negocio no ve los comentarios');
  ok(((await clienteX.db.from('turno_comentarios').select('id').eq('appointment_id', t1.id)).data || []).length === 0, 'el cliente no ve la documentación interna de su propio turno');
  ok(((await plataforma.db.from('turno_comentarios').select('id').eq('appointment_id', t1.id)).data || []).length === 1, 'la plataforma lee en un negocio sin privacidad');
  await duenoB.db.from('turno_comentarios').insert({ appointment_id: tB.id, texto: 'Dato sensible' });
  ok(((await plataforma.db.from('turno_comentarios').select('id').eq('appointment_id', tB.id)).data || []).length === 0, 'y no lee en uno con principio de privacidad');
  const { error: errVacio } = await duenoA.db.from('turno_comentarios').insert({ appointment_id: t1.id, texto: '   ' });
  ok(Boolean(errVacio), 'un comentario vacío se rechaza');

  console.log('\nArchivos:');
  const ini = (db, apt, extra) => db.rpc('iniciar_adjunto', { p_appointment_id: apt, p_nombre: 'estudio.pdf', p_mime: 'application/pdf', p_tamano: PDF.length, ...extra });
  ok(Boolean((await ini(duenoA.db, t1.id, { p_mime: 'text/html' })).error), '13. un tipo no permitido (HTML) se rechaza');
  ok(Boolean((await ini(duenoA.db, t1.id, { p_mime: 'image/svg+xml' })).error), '13. SVG tampoco (podría ejecutar código)');
  ok(Boolean((await ini(duenoA.db, t1.id, { p_tamano: 16 * 1024 * 1024 })).error), '13. un archivo de más de 15 MB se rechaza');
  ok(Boolean((await ini(staff2.db, t1.id)).error), 'un profesional no adjunta en turnos ajenos');
  ok(Boolean((await ini(duenoB.db, t1.id)).error), '10. otro negocio no adjunta en este turno');

  const r1 = (await ini(duenoA.db, t1.id, { p_nombre: '../../etc/passwd.pdf' })).data;
  ok(r1?.ruta?.startsWith(`${A.id}/${t1.id}/`) && r1.ruta.endsWith('.pdf'), 'la ruta la arma la base (negocio/turno/id), no el nombre del archivo');
  const subB = await subir(duenoB.db, r1.ruta, PDF, 'application/pdf');
  ok(Boolean(subB.error), '9. otro usuario no puede subir a una ruta reservada ajena');
  const libre = await subir(duenoA.db, `${A.id}/${t1.id}/cualquiera/x.pdf`, PDF, 'application/pdf');
  ok(Boolean(libre.error), 'no se puede subir a una ruta que no reservó iniciar_adjunto()');
  const sub1 = await subir(duenoA.db, r1.ruta, PDF, 'application/pdf');
  ok(!sub1.error, 'el dueño sube directo a Storage con la URL firmada');
  const pendVis = (await staff1.db.from('turno_adjuntos').select('id').eq('id', r1.id)).data;
  ok(pendVis.length === 0, '8. un archivo sin confirmar no lo ve nadie más');
  const conf1 = await fn('confirmar-adjunto', duenoA.token, { adjuntoId: r1.id });
  const fila1 = (await admin.from('turno_adjuntos').select('*').eq('id', r1.id).single()).data;
  ok(conf1.status === 200 && fila1.estado === 'listo' && Number(fila1.tamano_bytes) === PDF.length && fila1.nombre_original === '....etcpasswd.pdf', 'confirmado con el tamaño real y el nombre saneado');

  const urlA = await duenoA.db.storage.from(BUCKET).createSignedUrl(r1.ruta, 60);
  const bajada = urlA.data ? await fetch(urlA.data.signedUrl) : null;
  ok(bajada?.ok && (await bajada.arrayBuffer()).byteLength === PDF.length, 'el dueño obtiene una URL temporal y descarga');
  const urlS1 = await staff1.db.storage.from(BUCKET).createSignedUrl(r1.ruta, 60);
  ok(!urlS1.error, 'el profesional del turno también');
  ok(Boolean((await duenoB.db.storage.from(BUCKET).createSignedUrl(r1.ruta, 60)).error), '12. otro negocio no puede descargarlo aunque conozca la ruta');
  ok(Boolean((await clienteX.db.storage.from(BUCKET).createSignedUrl(r1.ruta, 60)).error), '9. el cliente tampoco');
  ok(Boolean((await staff2.db.storage.from(BUCKET).createSignedUrl(r1.ruta, 60)).error), '9. ni un profesional sin ese turno');
  const publica = await fetch(`${API_URL}/storage/v1/object/public/${BUCKET}/${r1.ruta}`);
  ok(!publica.ok, '9. el bucket no es público');
  const sinSesion = await fetch(`${API_URL}/storage/v1/object/${BUCKET}/${r1.ruta}`, { headers: { apikey: ANON_KEY } });
  ok(!sinSesion.ok, '9. sin sesión no se accede');
  const pisar = await subir(duenoA.db, r1.ruta, PNG, 'application/pdf');
  ok(Boolean(pisar.error), 'un archivo confirmado no se puede pisar');

  const r2 = (await ini(duenoA.db, t2.id)).data;
  await subir(duenoA.db, r2.ruta, PNG, 'application/pdf');
  const conf2 = await fn('confirmar-adjunto', duenoA.token, { adjuntoId: r2.id });
  const fila2 = (await admin.from('turno_adjuntos').select('id').eq('id', r2.id)).data;
  const obj2 = await admin.storage.from(BUCKET).download(r2.ruta);
  ok(conf2.status === 400 && fila2.length === 0 && Boolean(obj2.error), '8/13. una imagen disfrazada de PDF se rechaza y no deja fila ni archivo');

  const r3 = (await ini(duenoA.db, t2.id, { p_nombre: 'foto.jpg', p_mime: 'image/jpeg', p_tamano: 1000 })).data;
  const sub3 = await subir(duenoA.db, r3.ruta, JPG_GRANDE, 'image/jpeg');
  const conf3 = sub3.error ? { status: 'no-subio' } : await fn('confirmar-adjunto', duenoA.token, { adjuntoId: r3.id });
  const fila3 = (await admin.from('turno_adjuntos').select('id').eq('id', r3.id)).data;
  ok(conf3.status === 400 && fila3.length === 0, '13. una foto real de 11 MB declarada como chica se rechaza al confirmar');

  const r4 = (await ini(duenoA.db, t3.id)).data;
  const conf4 = await fn('confirmar-adjunto', duenoA.token, { adjuntoId: r4.id });
  const fila4 = (await admin.from('turno_adjuntos').select('estado').eq('id', r4.id).single()).data;
  ok(conf4.status === 412 && fila4.estado === 'pendiente', '8. confirmar sin haber subido no marca nada como listo');

  const listaT1 = (await duenoA.db.from('turno_adjuntos').select('id').eq('appointment_id', t1.id)).data;
  const listaT2 = (await duenoA.db.from('turno_adjuntos').select('id').eq('appointment_id', t2.id).eq('estado', 'listo')).data;
  ok(listaT1.length === 1 && listaT2.length === 0, '2/14. cada archivo aparece solo en su turno');
  const histConDocs = (await duenoA.db.rpc('historial_cliente', { p_cliente_id: fichaX.id })).data.find((t) => t.id === t1.id);
  ok(Number(histConDocs.comentarios) === 1 && Number(histConDocs.adjuntos) === 1, 'el historial cuenta comentarios y archivos sin traerlos');

  const borrS1 = await fn('eliminar-adjunto', staff1.token, { adjuntoId: r1.id });
  ok(borrS1.status === 403, '11. el profesional no borra un archivo que subió el dueño');
  const borrB = await fn('eliminar-adjunto', duenoB.token, { adjuntoId: r1.id });
  ok(borrB.status === 403, '10. otro negocio tampoco');
  const borrA = await fn('eliminar-adjunto', duenoA.token, { adjuntoId: r1.id });
  const fila1b = (await admin.from('turno_adjuntos').select('id').eq('id', r1.id)).data;
  const obj1b = await admin.storage.from(BUCKET).download(r1.ruta);
  ok(borrA.status === 200 && fila1b.length === 0 && Boolean(obj1b.error), 'el dueño borra: se van la fila y el archivo');

  console.log('\nLimpieza:');
  const r5 = (await ini(duenoA.db, t3.id)).data;
  await subir(duenoA.db, r5.ruta, PDF, 'application/pdf');
  await admin.from('turno_adjuntos').update({ created_at: new Date(Date.now() - 26 * 3600000).toISOString() }).eq('id', r5.id);
  let limpieza = await fn('limpiar-adjuntos', SECRET_KEY);
  if (limpieza.status === 401) limpieza = await fn('limpiar-adjuntos', SERVICE_ROLE_KEY);
  const fila5 = (await admin.from('turno_adjuntos').select('id').eq('id', r5.id)).data;
  const obj5 = await admin.storage.from(BUCKET).download(r5.ruta);
  ok(limpieza.status === 200 && fila5.length === 0 && Boolean(obj5.error), 'una subida pendiente de más de 24 h se limpia (fila y archivo)');
  const fila4b = (await admin.from('turno_adjuntos').select('id').eq('id', r4.id)).data;
  ok(fila4b.length === 1, 'una pendiente reciente no se toca');
  const sinPermiso = await fn('limpiar-adjuntos', duenoA.token);
  ok(sinPermiso.status === 401, 'la limpieza solo la llama el propio proyecto');

  console.log('\nCompatibilidad con lo existente:');
  const { count: sinVinculo } = await admin.from('appointments').select('id', { count: 'exact', head: true })
    .eq('type', 'client').not('user_id', 'is', null).is('cliente_id', null);
  ok(sinVinculo === 0, '6/7/16. todos los turnos con cuenta (también los previos a la migración) tienen ficha');
  const { count: fichasAntes } = await admin.from('clientes').select('id', { count: 'exact', head: true });
  const { data: re } = await admin.rpc('asegurar_cliente_de_cuenta', { p_business_id: A.id, p_user_id: clienteX.id, p_nombre_reserva: 'otro' });
  const { count: fichasDespues } = await admin.from('clientes').select('id', { count: 'exact', head: true });
  ok(re === fichaX.id && fichasAntes === fichasDespues, 'volver a vincular es idempotente (misma ficha, ninguna nueva)');
  const { data: cancelar, error: errCancel } = await clienteX.db.from('appointments').update({ status: 'cancelada', cancellation_reason: 'no llego' }).eq('id', t3.id).select('status, cliente_id');
  ok(!errCancel && cancelar?.[0]?.status === 'cancelada' && cancelar[0].cliente_id === fichaX.id, 'el cliente sigue pudiendo cancelar su turno y el vínculo no cambia');

  console.log(`\n${pasaron} ok, ${fallaron} fallas`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
