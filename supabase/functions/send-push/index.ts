// ============================================================================
// send-push
// ============================================================================
// Traducción de enviarPush en functions/index.js. La invocan los triggers
// handle_nuevo_turno/handle_turno_cancelado a través de la cola de avisos
// (envios_pendientes, ver 20261022000000_cola_de_avisos.sql) — nunca un
// componente del cliente, por eso exige la service role key como Bearer,
// igual que run-billing/send-reminders.
//
// Mismo criterio de a quién avisar que la notificación in-app: el dueño ve
// todo, el staff asignado a un profesional solo lo suyo.
//
// Respaldo por mail (`respaldoMail`): si alguien tiene push registrado
// (vigente o caído hace menos de 30 días) y el aviso no le llegó a NINGÚN
// dispositivo suyo, se le manda el mismo aviso por mail con cómo reactivarlo.
// Sin esto, un celular que el servicio de push dio de baja dejaba al dueño
// sin avisos y sin enterarse (caso real, ver 20261021000000_push_caido_respaldo_mail.sql).
// `avisarSinPush` (turno nuevo): el dueño que nunca activó el push también
// recibe el mail — si no, solo se enteraba al abrir el panel.
//
// Cola: el envío se marca listo cuando a todos les llegó por algún lado (o no
// hay forma: sin correo, push caído sin respaldo). Si quedó alguien por un
// error pasajero (servicio de push o SMTP), no se marca y el cron reintenta,
// salteando a quienes ya lo recibieron (`progreso.avisados`).
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated, invalidArgument } from '../_shared/auth.ts';
import { enviarWebPush, fotoDelNegocio } from '../_shared/webpush.ts';
import { enviarMail, smtpConfigurado } from '../_shared/mail.ts';
import { plantillaHtml } from '../_shared/emailTemplate.ts';
import { leerProgreso, marcarEnvio } from '../_shared/envios.ts';

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
      avisarSinPush = false,
      envioId = null,
    } = await req.json();
    if (!businessId || !title || !body) throw invalidArgument('Faltan businessId, title o body.');

    const admin = supabaseAdmin();
    const avisados = new Set((await leerProgreso(admin, envioId)).avisados || []);

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
    const registradas = corresponden.filter((s) => !vencidas.includes(s));
    const conPush = registradas.filter((s) => !avisados.has(s.user_id));

    // ── Push ──
    const vigentes = conPush.filter((s) => !s.baja_at);
    let resultado = { enviados: 0, fallidos: 0, entregados: [] as string[], caidos: [] as string[] };
    if (vigentes.length) {
      const icon = await fotoDelNegocio(admin, businessId);
      resultado = await enviarWebPush(admin, vigentes, { title, body, url, icon });
    }
    for (const s of conPush) if (resultado.entregados.includes(s.endpoint)) avisados.add(s.user_id);

    // Sin push que haya llegado: dispositivos caídos (no hay reintento que los
    // arregle) o con error pasajero (sí).
    const sinAviso = [...new Set(conPush.map((s) => s.user_id))].filter((uid) => !avisados.has(uid));
    const conErrorPasajero = (uid: string) => conPush.some(
      (s) => s.user_id === uid && !s.baja_at && !resultado.entregados.includes(s.endpoint) && !resultado.caidos.includes(s.endpoint),
    );

    // ── Mail ──
    let avisadosPorMail = 0;
    let pendientes = 0;
    if (respaldoMail && smtpConfigurado()) {
      const destinos: { clave: string; email: string }[] = [];
      const correosConPush = new Set<string>();
      for (const uid of [...new Set(registradas.map((s) => s.user_id))]) {
        const { data } = await admin.auth.admin.getUserById(uid);
        const email = data?.user?.email?.toLowerCase();
        if (!email) continue;
        correosConPush.add(email);
        if (sinAviso.includes(uid)) destinos.push({ clave: uid, email });
      }
      if (avisarSinPush) {
        const { data: dueños } = await admin.from('admins').select('email').eq('business_id', businessId).eq('role', 'owner');
        for (const d of dueños || []) {
          const email = d.email?.toLowerCase();
          if (email && !correosConPush.has(email) && !avisados.has(`mail:${email}`)) destinos.push({ clave: `mail:${email}`, email });
        }
      }
      if (destinos.length) {
        const mail = await armarMail(admin, businessId);
        for (const { clave, email } of destinos) {
          const nota = clave.startsWith('mail:') ? mail.notaSinPush : mail.notaPushCaido;
          const ok = await enviarMail({
            to: email, subject: `${title}: ${body}`, fromName: mail.negocio,
            text: `${title}\n\n${body}\n\n${nota}`,
            html: plantillaHtml({ eyebrow: mail.negocio, titulo: title, intro: body, filas: [], nota }),
          });
          if (ok) { avisados.add(clave); avisadosPorMail++; } else pendientes++;
        }
      }
    } else {
      // Sin respaldo por mail, lo único que un reintento puede arreglar es un
      // push que falló por un error pasajero.
      pendientes = sinAviso.filter(conErrorPasajero).length;
    }

    await marcarEnvio(admin, envioId, { listo: pendientes === 0, progreso: { avisados: [...avisados] } });

    if (conPush.length === 0 && avisadosPorMail === 0 && pendientes === 0) {
      return jsonResponse({ status: 'sin-destinatarios', enviados: 0, avisadosPorMail: 0 }, corsHeaders);
    }
    const { enviados, fallidos } = resultado;
    return jsonResponse({ status: 'processed', enviados, fallidos, avisadosPorMail, pendientes }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});

// deno-lint-ignore no-explicit-any
async function armarMail(admin: any, businessId: string) {
  const { data: negocio } = await admin.from('businesses').select('name').eq('id', businessId).maybeSingle();
  return {
    negocio: negocio?.name || 'tu negocio',
    notaPushCaido: 'Te llega por mail porque la notificación no pudo entrar a tu celular. '
      + 'Para volver a recibirlas ahí, abrí el panel de Slotly en el celular: se reactivan solas.',
    notaSinPush: 'Te llega por mail porque no tenés activadas las notificaciones en ningún dispositivo. '
      + 'Para recibirlas al instante en el celular, abrí el panel de Slotly y tocá la campanita → "Activar notificaciones".',
  };
}
