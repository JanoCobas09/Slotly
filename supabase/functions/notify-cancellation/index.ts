// ============================================================================
// notify-cancellation
// ============================================================================
// La invoca handle_turno_cancelado (vía pg_net) cuando el CLIENTE cancela un
// turno — mismo disparador que ya manda el push y la notificación in-app,
// esto suma un mail al dueño del negocio (a `admins` con role='owner'), para
// quien no tiene push activado o no llegó a verlo en el momento. Por eso
// exige la service role key como Bearer, igual que send-push/send-reminders:
// nunca la llama un componente del cliente.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated, invalidArgument } from '../_shared/auth.ts';
import { enviarMail, smtpConfigurado } from '../_shared/mail.ts';
import { plantillaHtml } from '../_shared/emailTemplate.ts';

function fechaLinda(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto (trigger).');
    }

    const { appointmentId } = await req.json();
    if (!appointmentId) throw invalidArgument('Falta appointmentId.');

    if (!smtpConfigurado()) return jsonResponse({ status: 'sin-credenciales' }, corsHeaders);

    const admin = supabaseAdmin();
    const { data: turno } = await admin
      .from('appointments')
      .select('business_id, professional_id, client_name, service_name, appointment_date, start_time, end_time, cancellation_reason')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!turno) return jsonResponse({ status: 'turno-no-encontrado' }, corsHeaders);

    const { data: dueños } = await admin
      .from('admins')
      .select('email')
      .eq('business_id', turno.business_id)
      .eq('role', 'owner');
    const destinatarios = (dueños || []).map((d) => d.email).filter(Boolean);
    if (destinatarios.length === 0) return jsonResponse({ status: 'sin-destinatarios' }, corsHeaders);

    const { data: negocio } = await admin.from('businesses').select('name').eq('id', turno.business_id).maybeSingle();
    const { data: profesional } = turno.professional_id
      ? await admin.from('professionals').select('name').eq('id', turno.professional_id).maybeSingle()
      : { data: null };

    const negocioNombre = negocio?.name || 'tu negocio';
    const conProfesional = profesional?.name ? ` con ${profesional.name}` : '';
    const asunto = `Turno cancelado: ${turno.client_name || 'un cliente'} · ${fechaLinda(turno.appointment_date)} ${turno.start_time}`;
    const nota = 'Ese horario ya quedó libre en tu agenda.';
    const texto =
      `Un cliente canceló su turno en ${negocioNombre}.\n\n` +
      `Cliente: ${turno.client_name || '(sin nombre)'}\n` +
      `Fecha: ${fechaLinda(turno.appointment_date)}\n` +
      `Horario: ${turno.start_time}${turno.end_time ? ` a ${turno.end_time}` : ''}\n` +
      (turno.service_name ? `Servicio: ${turno.service_name}\n` : '') +
      (profesional?.name ? `Con: ${profesional.name}\n` : '') +
      (turno.cancellation_reason ? `Motivo: ${turno.cancellation_reason}\n` : '') +
      `\n${nota}`;

    const filas = [
      { label: 'Cliente', value: turno.client_name || '(sin nombre)' },
      { label: 'Fecha', value: fechaLinda(turno.appointment_date) },
      { label: 'Horario', value: turno.end_time ? `${turno.start_time} a ${turno.end_time}` : turno.start_time },
      ...(turno.service_name ? [{ label: 'Servicio', value: turno.service_name }] : []),
      ...(profesional?.name ? [{ label: 'Con', value: profesional.name }] : []),
      ...(turno.cancellation_reason ? [{ label: 'Motivo', value: turno.cancellation_reason }] : []),
    ];
    const html = plantillaHtml({
      eyebrow: negocioNombre,
      titulo: 'Turno cancelado',
      intro: `${turno.client_name || 'Un cliente'} canceló su turno${conProfesional}.`,
      filas,
      nota,
    });

    let enviados = 0;
    for (const to of destinatarios) {
      const ok = await enviarMail({ to, subject: asunto, text: texto, html, fromName: negocioNombre });
      if (ok) enviados++;
    }

    return jsonResponse({ status: 'processed', enviados }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
