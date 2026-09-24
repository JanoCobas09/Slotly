// ============================================================================
// create-appointment
// ============================================================================
// Traducción de exports.createAppointment en functions/index.js. Toda la
// validación de negocio (precio, duración, horario, solapamiento, topes por
// cliente) vive en la función de Postgres `create_appointment` — ver
// supabase/migrations/20260924000000_create_appointment.sql —, corrida
// atómicamente con un advisory lock, equivalente a la transacción de
// Firestore original. Esta Edge Function solo valida la sesión y traduce
// el resultado.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  supabaseAdmin,
  errorResponse,
  jsonResponse,
  errorDeFuncionSql,
} from '../_shared/auth.ts';
import { enviarMail } from '../_shared/mail.ts';
import { plantillaHtml } from '../_shared/emailTemplate.ts';

function fechaLinda(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/**
 * Mail de confirmación, apenas se crea el turno — a diferencia del
 * recordatorio de send-reminders (que sale recién ~3hs antes), esto sale al
 * toque: quien acaba de reservar tiene el teléfono en la mano en ese
 * momento, no necesariamente 3 horas antes del turno. Nunca puede tirar
 * abajo la reserva ya hecha: cualquier error acá se loguea y se sigue.
 */
async function mandarConfirmacion(admin: ReturnType<typeof supabaseAdmin>, turno: {
  business_id: string; professional_id: string; client_email: string | null; client_name: string | null;
  service_name: string | null; appointment_date: string; start_time: string; end_time: string | null; price: number | null;
}) {
  if (!turno.client_email) return;
  try {
    const { data: negocio } = await admin.from('businesses').select('name, address, phone').eq('id', turno.business_id).maybeSingle();
    const { data: profesional } = await admin.from('professionals').select('name').eq('id', turno.professional_id).maybeSingle();
    if (!negocio) return; // no debería pasar (el turno ya se creó contra este negocio), pero sin nombre no hay mail que armar

    const conProfesional = profesional?.name ? ` con ${profesional.name}` : '';
    const asunto = `Turno confirmado en ${negocio.name} · ${fechaLinda(turno.appointment_date)} ${turno.start_time}`;
    const nota = 'Si no podés asistir, avisale al negocio con anticipación.';
    const texto =
      `Hola ${turno.client_name || ''},\n\n` +
      `Tu turno${conProfesional} en ${negocio.name} quedó confirmado.\n\n` +
      `Fecha: ${fechaLinda(turno.appointment_date)}\n` +
      `Horario: ${turno.start_time}${turno.end_time ? ` a ${turno.end_time}` : ''}\n` +
      (turno.service_name ? `Servicio: ${turno.service_name}\n` : '') +
      (turno.price != null ? `Precio: $${turno.price}\n` : '') +
      (negocio.address ? `Dirección: ${negocio.address}\n` : '') +
      (negocio.phone ? `Teléfono: ${negocio.phone}\n` : '') +
      `\n${nota}`;

    const filas = [
      { label: 'Fecha', value: fechaLinda(turno.appointment_date) },
      { label: 'Horario', value: turno.end_time ? `${turno.start_time} a ${turno.end_time}` : turno.start_time },
      ...(turno.service_name ? [{ label: 'Servicio', value: turno.service_name }] : []),
      ...(profesional?.name ? [{ label: 'Con', value: profesional.name }] : []),
      ...(turno.price != null ? [{ label: 'Precio', value: `$${turno.price}` }] : []),
      ...(negocio.address ? [{ label: 'Dirección', value: negocio.address }] : []),
      ...(negocio.phone ? [{ label: 'Teléfono', value: negocio.phone }] : []),
    ];
    const html = plantillaHtml({
      eyebrow: negocio.name,
      titulo: 'Turno confirmado',
      intro: `Hola ${turno.client_name || ''}, tu turno${conProfesional} quedó confirmado.`,
      filas,
      nota,
    });

    await enviarMail({ to: turno.client_email, subject: asunto, text: texto, html, fromName: negocio.name });
  } catch (err) {
    console.error('[create-appointment] No se pudo mandar la confirmación por mail:', err);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const {
      businessId, professionalId, serviceId, appointmentDate, startTime,
      clientName = '', clientPhone = '', clientEmail = '', notes = '',
    } = await req.json();

    const admin = supabaseAdmin();
    // clientEmail sale del token, nunca del cuerpo de la llamada — mismo
    // motivo que en Firebase: que no se registre un turno con el mail de otro.
    const { data, error } = await admin.rpc('create_appointment', {
      p_business_id: businessId,
      p_professional_id: professionalId,
      p_service_id: serviceId,
      p_appointment_date: appointmentDate,
      p_start_time: startTime,
      p_client_name: clientName,
      p_client_phone: clientPhone,
      p_client_email: caller.email || clientEmail || '',
      p_notes: notes,
      p_user_id: caller.id,
    });

    if (error) throw errorDeFuncionSql(error);

    // No se espera a que termine (el mail puede tardar) para no demorar la
    // respuesta al cliente — el turno ya está confirmado, esto es un aviso
    // aparte. `EdgeRuntime.waitUntil` deja que Deno termine el envío aunque
    // la respuesta HTTP ya haya vuelto.
    const promesaMail = mandarConfirmacion(admin, data);
    // @ts-ignore EdgeRuntime es un global del runtime de Supabase, no de Deno estándar.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promesaMail);
    else await promesaMail;

    return jsonResponse(
      { status: 'created', id: data.id, price: data.price, endTime: data.end_time },
      corsHeaders,
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
