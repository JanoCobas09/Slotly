// ============================================================================
// send-push
// ============================================================================
// Traducción de enviarPush en functions/index.js. La invocan los triggers
// handle_nuevo_turno/handle_turno_cancelado (vía pg_net) cuando entra o se
// cancela un turno de cliente — nunca un componente del cliente, por eso
// exige la service role key como Bearer, igual que run-billing/send-reminders.
//
// Mismo criterio de a quién avisar que la notificación in-app: el dueño ve
// todo, el staff asignado a un profesional solo lo suyo.
//
// Respaldo por mail: si alguien tiene push registrado (vigente o caído hace
// menos de 30 días) y el aviso no le llegó a NINGÚN dispositivo suyo, se le
// manda el mismo aviso por mail con cómo reactivarlo. Sin esto, un celular
// que el servicio de push dio de baja dejaba al dueño sin avisos y sin
// enterarse (caso real, ver 20261021000000_push_caido_respaldo_mail.sql).
// Quien nunca activó el push no recibe nada acá: lo eligió así.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated, invalidArgument } from '../_shared/auth.ts';
import { enviarWebPush, fotoDelNegocio } from '../_shared/webpush.ts';
import { enviarMail } from '../_shared/mail.ts';
import { plantillaHtml } from '../_shared/emailTemplate.ts';

const DIAS_RESPALDO = 30;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto.');
    }

    const {
      businessId, professionalId = null, branchId = null, title, body, url,
      // false cuando el mismo hecho ya le llega por mail por otro lado
      // (cancelación del cliente → notify-cancellation).
      respaldoMail = true,
    } = await req.json();
    if (!businessId || !title || !body) throw invalidArgument('Faltan businessId, title o body.');

    const admin = supabaseAdmin();
    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key, role, professional_id, branch_id, user_id, baja_at')
      .eq('business_id', businessId);
    if (error) throw error;

    // Dueño: todo. Profesional: lo suyo. Administrador de sucursal: lo de su sucursal.
    const corresponden = (subs || []).filter(
      (s) => s.role === 'owner'
        || (s.role === 'admin' && s.professional_id === professionalId)
        || (s.role === 'manager' && branchId && s.branch_id === branchId),
    );

    // Caídas hace más de DIAS_RESPALDO: se deja de mandar el respaldo y se borran.
    const limite = Date.now() - DIAS_RESPALDO * 24 * 3600 * 1000;
    const vencidas = corresponden.filter((s) => s.baja_at && Date.parse(s.baja_at) < limite);
    if (vencidas.length) {
      await admin.from('push_subscriptions').delete().in('endpoint', vencidas.map((s) => s.endpoint));
    }
    const conPush = corresponden.filter((s) => !vencidas.includes(s));
    if (conPush.length === 0) return jsonResponse({ status: 'sin-destinatarios', enviados: 0 }, corsHeaders);

    const icon = await fotoDelNegocio(admin, businessId);
    const vigentes = conPush.filter((s) => !s.baja_at);
    const { enviados, fallidos, entregados } = await enviarWebPush(admin, vigentes, { title, body, url, icon });

    let avisadosPorMail = 0;
    if (respaldoMail) {
      const usuarios = [...new Set(conPush.map((s) => s.user_id))];
      const sinAviso = usuarios.filter((uid) => !conPush.some((s) => s.user_id === uid && entregados.includes(s.endpoint)));
      if (sinAviso.length) avisadosPorMail = await respaldarPorMail(admin, businessId, sinAviso, { title, body });
    }

    return jsonResponse({ status: 'processed', enviados, fallidos, avisadosPorMail }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});

// deno-lint-ignore no-explicit-any
async function respaldarPorMail(admin: any, businessId: string, userIds: string[], { title, body }: { title: string; body: string }) {
  const { data: negocio } = await admin.from('businesses').select('name').eq('id', businessId).maybeSingle();
  const negocioNombre = negocio?.name || 'tu negocio';
  const nota = 'Te llega por mail porque la notificación no pudo entrar a tu celular. '
    + 'Para volver a recibirlas ahí, abrí el panel de Slotly en el celular: se reactivan solas.';
  const html = plantillaHtml({ eyebrow: negocioNombre, titulo: title, intro: body, filas: [], nota });
  const texto = `${title}\n\n${body}\n\n${nota}`;

  let enviados = 0;
  for (const uid of userIds) {
    const { data } = await admin.auth.admin.getUserById(uid);
    const to = data?.user?.email;
    if (!to) continue;
    if (await enviarMail({ to, subject: `${title}: ${body}`, text: texto, html, fromName: negocioNombre })) enviados++;
  }
  return enviados;
}
