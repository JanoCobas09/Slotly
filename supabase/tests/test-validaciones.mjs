// La base rechaza datos basura de cualquier rol (dueño, profesional,
// cliente) y sigue aceptando los válidos. Contra el stack local (`npx
// supabase start`), escribiendo directo con la sesión de cada uno — como lo
// haría alguien con la consola abierta, salteándose las pantallas.
// Ver supabase/migrations/20261007000000_validacion_de_datos.sql.
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

async function usuario(prefijo, appMetadata = {}) {
  const email = `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Password123!', email_confirm: true, app_metadata: appMetadata });
  if (error) throw error;
  const client = createClient(API_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  if (e2) throw e2;
  const db = createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
  return { id: data.user.id, email, db };
}

/** El error de un CHECK trae el nombre de la restricción: así se sabe que rebotó por la regla correcta. */
const rebota = (error, restriccion) => Boolean(error) && error.message.includes(restriccion);

async function main() {
  const suffix = Date.now();
  const bizId = crypto.randomUUID();
  const profId = crypto.randomUUID();
  const srvId = crypto.randomUUID();
  await admin.from('businesses').insert({ id: bizId, name: 'Negocio Validado', slug: `negocio-valid-${suffix}` });
  await admin.from('professionals').insert({ id: profId, business_id: bizId, name: 'Pedro' });
  await admin.from('services').insert({ id: srvId, business_id: bizId, name: 'Corte', duration_minutes: 30, price: 1000 });

  const dueno = await usuario('dueno-valid', { business_id: bizId, role: 'owner' });
  const prof = await usuario('prof-valid', { business_id: bizId, role: 'admin', professional_id: profId });
  const cliente = await usuario('cliente-valid');

  const negocio = (cambios) => dueno.db.from('businesses').update(cambios).eq('id', bizId);

  console.log('Dueño — Configuración del negocio:');
  ok(rebota((await negocio({ name: 'X' })).error, 'businesses_nombre_valido'), 'nombre de 1 letra');
  ok(rebota((await negocio({ name: 'N'.repeat(81) })).error, 'businesses_nombre_valido'), 'nombre de 81 letras');
  ok(rebota((await negocio({ primary_color: 'red; background:url(x)' })).error, 'businesses_colores_validos'), 'color que no es #hex');
  ok(rebota((await negocio({ maps_url: 'javascript:alert(1)' })).error, 'businesses_maps_valido'), 'link de Maps javascript:');
  ok(rebota((await negocio({ logo_url: 'data:image/svg+xml,<svg onload=alert(1)>' })).error, 'businesses_logo_valido'), 'logo data:');
  ok(rebota((await negocio({ phone: 'llamame' })).error, 'businesses_telefono_valido'), 'teléfono con letras');
  ok(rebota((await negocio({ email: 'no-es-mail' })).error, 'businesses_email_valido'), 'mail sin @');
  ok(rebota((await negocio({ welcome_message: 'a'.repeat(501) })).error, 'businesses_mensaje_valido'), 'mensaje de bienvenida de 501');
  ok(rebota((await negocio({ slot_interval: 0 })).error, 'businesses_intervalo_valido'), 'intervalo de grilla 0');
  ok(rebota((await negocio({ min_cancel_hours: -5 })).error, 'businesses_cancelacion_valida'), 'horas para cancelar negativas');
  ok(rebota((await negocio({ currency: 'BTC' })).error, 'businesses_moneda_valida'), 'moneda inventada');
  ok(rebota((await negocio({ social_links: { instagram: 'a/b?c=<x>' } })).error, 'businesses_redes_validas'), 'instagram con caracteres raros');
  ok(rebota((await negocio({ business_hours: [{ dayOfWeek: 0, isActive: true, startTime: '20:00', endTime: '09:00' }] })).error, 'businesses_horario_valido'), 'horario que cierra antes de abrir');
  ok(rebota((await negocio({ business_hours: [{ dayOfWeek: 9, isActive: false }] })).error, 'businesses_horario_valido'), 'día de la semana 9');
  ok(rebota((await negocio({ deposit_type: 'percent', deposit_value: 150 })).error, 'businesses_sena_valida'), 'seña de 150%');
  {
    const { error } = await negocio({
      name: 'Negocio OK', primary_color: '#28706f', maps_url: 'https://maps.app.goo.gl/abc', phone: '+54 9 11 1234-5678',
      email: 'hola@negocio.com', slot_interval: 30, min_cancel_hours: 2, currency: 'ARS',
      social_links: { instagram: '@mi.negocio_1', whatsapp: '1123456789' },
      business_hours: [{ dayOfWeek: 0, isActive: true, startTime: '09:00', endTime: '20:00' }, { dayOfWeek: 6, isActive: false, startTime: '', endTime: '' }],
      deposit_type: 'percent', deposit_value: 30,
    });
    ok(!error, `datos válidos se guardan — ${error?.message || 'ok'}`);
  }

  console.log('Dueño — Servicios y promociones:');
  const servicio = (cambios) => dueno.db.from('services').update(cambios).eq('id', srvId);
  ok(rebota((await servicio({ price: -100 })).error, 'services_precio_valido'), 'precio negativo');
  ok(rebota((await servicio({ duration_minutes: 0 })).error, 'services_duracion_valida'), 'duración 0');
  ok(rebota((await servicio({ duration_minutes: 10000 })).error, 'services_duracion_valida'), 'duración de 10000 min');
  ok(rebota((await servicio({ name: ' ' })).error, 'services_nombre_valido'), 'nombre en blanco');
  ok(!(await servicio({ price: 0, duration_minutes: 45 })).error, 'precio 0 (consulta gratis) y 45 min: ok');
  const promo = (p) => dueno.db.from('promotions').insert({ business_id: bizId, service_id: srvId, day_of_week: 1, start_time: '10:00', end_time: '12:00', discount_type: 'percentage', discount_value: 20, ...p });
  ok(rebota((await promo({ discount_value: 150 })).error, 'promotions_descuento_valido'), 'promo de 150%');
  ok(rebota((await promo({ start_time: '12:00', end_time: '10:00' })).error, 'promotions_horas_validas'), 'promo que termina antes de empezar');
  ok(!(await promo({})).error, 'promo válida: ok');

  console.log('Profesional — su ficha y sus horarios:');
  ok(rebota((await prof.db.from('professionals').update({ bio: 'b'.repeat(501) }).eq('id', profId)).error, 'professionals_bio_valida'), 'bio de 501');
  ok(rebota((await prof.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 1, start_time: '18:00', end_time: '09:00' })).error, 'schedules_rango_valido'), 'franja que termina antes de empezar');
  ok(rebota((await prof.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 1, start_time: '9am', end_time: '18:00' })).error, 'schedules_horas_validas'), 'hora "9am"');
  ok(rebota((await prof.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 1, start_time: '09:00', end_time: '18:00', break_start: '20:00', break_end: '21:00' })).error, 'schedules_descanso_valido'), 'descanso fuera de la franja');
  ok(!(await prof.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 1, start_time: '09:00', end_time: '18:00' })).error, 'franja válida: ok');
  ok(!(await prof.db.from('schedules').insert({ business_id: bizId, professional_id: profId, day_of_week: 2, start_time: '', end_time: '', is_active: false })).error, 'día sin horario (vacío): ok');
  ok(rebota((await prof.db.from('staff_contacts').upsert({ professional_id: profId, business_id: bizId, phone: '<script>', email: '' })).error, 'staff_contacts_telefono_valido'), 'teléfono personal con basura');

  console.log('Staff — turno cargado a mano:');
  const turno = (t) => dueno.db.from('appointments').insert({
    business_id: bizId, professional_id: profId, user_id: dueno.id, appointment_date: '2099-01-10',
    start_time: '10:00', end_time: '10:30', type: 'manual', client_name: 'Juan', client_phone: '1123456789', price: 1000, ...t,
  });
  ok(rebota((await turno({ price: -1 })).error, 'appointments_precio_valido'), 'precio negativo');
  ok(rebota((await turno({ start_time: '25:99' })).error, 'appointments_horas_validas'), 'hora 25:99');
  ok(rebota((await turno({ client_phone: 'no tengo' })).error, 'appointments_cliente_valido'), 'teléfono con letras');
  ok(rebota((await turno({ notes: 'n'.repeat(501) })).error, 'appointments_notas_validas'), 'notas de 501');
  ok(rebota((await turno({ type: 'vip' })).error, 'appointments_tipo_valido'), 'tipo inventado');
  ok(!(await turno({})).error, 'turno válido: ok');
  ok(!(await turno({ start_time: '11:00', end_time: '11:30', type: 'walkin', client_name: '', client_phone: '' })).error, 'servicio sin turno (sin cliente): ok');

  console.log('Cliente — cancelar con un motivo gigante:');
  {
    const { data: t } = await admin.from('appointments').insert({
      business_id: bizId, professional_id: profId, user_id: cliente.id, appointment_date: '2099-01-11', start_time: '10:00', type: 'client',
    }).select('id').single();
    const { error } = await cliente.db.from('appointments').update({ status: 'cancelada', cancellation_reason: 'x'.repeat(301) }).eq('id', t.id);
    ok(rebota(error, 'appointments_notas_validas'), 'motivo de 301');
  }

  console.log('Soporte:');
  {
    const { data: tk, error } = await dueno.db.from('tickets').insert({ business_id: bizId, subject: 'Ayuda', category: 'otro' }).select('id').single();
    ok(!error, `ticket válido: ok — ${error?.message || ''}`);
    if (tk) {
      const r = await dueno.db.from('ticket_messages').insert({ ticket_id: tk.id, business_id: bizId, author_id: dueno.id, body: '   ' });
      ok(rebota(r.error, 'ticket_messages_texto_valido'), 'mensaje en blanco');
    }
  }

  console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
  process.exit(fallaron ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
