// ============================================================================
// send-reminders
// ============================================================================
// Traducción de exports.enviarRecordatorios (procesarRecordatorios) en
// functions/index.js. Corre cada 15 minutos (pg_cron, mismo mecanismo que
// run-billing — scheduling comentado al final de la migración, a activar en
// Fase 8) y manda un mail al cliente cuyo turno empieza en las próximas 3
// horas, dentro de una ventana horaria razonable (7:00 a 20:00).
//
// Igual que en el original: si no hay credenciales de SMTP configuradas,
// no manda nada y no rompe — no todo despliegue (ni el desarrollo local)
// tiene un servidor de correo real a mano. Acá las credenciales son
// genéricas (SMTP_HOST/PORT/USER/PASS/FROM) en vez de específicas de Gmail,
// porque nodemailer se conecta igual a cualquier servidor — en local
// apuntan al Inbucket que ya trae el stack de Supabase (mismo servidor que
// usa Auth para los mails de confirmación), en producción a Gmail o el
// proveedor que se elija.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated } from '../_shared/auth.ts';
import { enviarMail, smtpConfigurado } from '../_shared/mail.ts';
import { plantillaHtml } from '../_shared/emailTemplate.ts';

const VENTANA_RECORDATORIO_MIN = 3 * 60; // "en lo posible 3 horas antes"
const HORA_DESDE = 7;  // nunca antes de las 7:00
const HORA_HASTA = 20; // nunca después de las 20:00

function ahoraEnArgentina(instante: Date) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(instante);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return { fecha: `${parte('year')}-${parte('month')}-${parte('day')}`, hour: Number(parte('hour')), minute: Number(parte('minute')) };
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fechaLinda(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

function textoRecordatorio({ negocioNombre, negocioDireccion, negocioTelefono, apt, profesionalNombre }: {
  negocioNombre: string; negocioDireccion: string | null; negocioTelefono: string | null;
  apt: { start_time: string; client_name: string | null; service_name: string | null; appointment_date: string };
  profesionalNombre: string | null;
}) {
  const conProfesional = profesionalNombre ? ` con ${profesionalNombre}` : '';
  const nota = 'Si no podés asistir, avisale al negocio con anticipación.';
  const asunto = `Recordatorio: tu turno hoy a las ${apt.start_time} en ${negocioNombre}`;
  const texto =
    `Hola ${apt.client_name || ''},\n\n` +
    `Te recordamos tu turno${conProfesional} en ${negocioNombre}, hoy a las ${apt.start_time}.\n` +
    (apt.service_name ? `Servicio: ${apt.service_name}\n` : '') +
    (negocioDireccion ? `Dirección: ${negocioDireccion}\n` : '') +
    (negocioTelefono ? `Teléfono: ${negocioTelefono}\n` : '') +
    `\n${nota}`;

  const filas = [
    { label: 'Hoy', value: fechaLinda(apt.appointment_date) },
    { label: 'Horario', value: apt.start_time },
    ...(apt.service_name ? [{ label: 'Servicio', value: apt.service_name }] : []),
    ...(profesionalNombre ? [{ label: 'Con', value: profesionalNombre }] : []),
    ...(negocioDireccion ? [{ label: 'Dirección', value: negocioDireccion }] : []),
    ...(negocioTelefono ? [{ label: 'Teléfono', value: negocioTelefono }] : []),
  ];
  const html = plantillaHtml({
    eyebrow: negocioNombre,
    titulo: 'Recordatorio de tu turno',
    intro: `Hola ${apt.client_name || ''}, te recordamos tu turno${conProfesional} hoy a las ${apt.start_time}.`,
    filas,
    nota,
  });

  return { asunto, texto, html };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto (cron).');
    }

    // El test pasa un instante fijo en el body para no depender de la hora
    // real de la máquina que corre la suite — mismo motivo por el que
    // procesarRecordatorios en Firebase recibía `instante` como parámetro.
    const body = await req.json().catch(() => ({}));
    const instante = body?.instante ? new Date(body.instante) : new Date();

    const { fecha: hoy, hour, minute } = ahoraEnArgentina(instante);
    if (hour < HORA_DESDE || hour >= HORA_HASTA) {
      return jsonResponse({ enviados: 0, fallidos: 0, motivo: 'fuera-de-horario' }, corsHeaders);
    }

    if (!smtpConfigurado()) {
      return jsonResponse({ enviados: 0, fallidos: 0, motivo: 'sin-credenciales' }, corsHeaders);
    }

    const admin = supabaseAdmin();
    const nowMin = hour * 60 + minute;

    const { data: candidatos, error } = await admin
      .from('appointments')
      .select('id, business_id, professional_id, appointment_date, start_time, client_name, client_email, service_name')
      .eq('appointment_date', hoy)
      .in('status', ['pendiente', 'confirmada'])
      .is('reminder_sent_at', null)
      .not('client_email', 'is', null);
    if (error) throw error;

    const enVentana = (candidatos || []).filter((a) => {
      const inicio = timeToMinutes(a.start_time);
      return inicio > nowMin && inicio - nowMin <= VENTANA_RECORDATORIO_MIN;
    });

    // Una sola lectura por negocio/profesional aunque varios turnos los compartan.
    const negocios = new Map<string, { name: string; address: string | null; phone: string | null } | null>();
    const profesionales = new Map<string, string | null>();

    let enviados = 0, fallidos = 0;
    for (const apt of enVentana) {
      try {
        if (!negocios.has(apt.business_id)) {
          const { data: biz } = await admin.from('businesses').select('name, address, phone').eq('id', apt.business_id).maybeSingle();
          negocios.set(apt.business_id, biz);
        }
        const negocio = negocios.get(apt.business_id);
        if (!negocio) continue; // negocio borrado, turno huérfano: nada que avisar

        const profKey = `${apt.business_id}/${apt.professional_id}`;
        if (!profesionales.has(profKey)) {
          const { data: prof } = await admin.from('professionals').select('name').eq('id', apt.professional_id).maybeSingle();
          profesionales.set(profKey, prof?.name ?? null);
        }

        const { asunto, texto, html } = textoRecordatorio({
          negocioNombre: negocio.name, negocioDireccion: negocio.address, negocioTelefono: negocio.phone,
          apt, profesionalNombre: profesionales.get(profKey) ?? null,
        });

        const ok = await enviarMail({ to: apt.client_email, subject: asunto, text: texto, html, fromName: negocio.name });
        if (!ok) throw new Error('enviarMail devolvió false');
        await admin.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', apt.id);
        enviados++;
      } catch (err) {
        fallidos++;
        console.error(`[send-reminders] No se pudo avisar a ${apt.client_email} (turno ${apt.id}):`, err);
      }
    }

    return jsonResponse({ enviados, fallidos, candidatos: enVentana.length }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
