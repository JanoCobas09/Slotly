// ============================================================================
// mandar-confirmacion
// ============================================================================
// El mail de confirmación al cliente. Lo encola notificar_nuevo_turno (turno
// nuevo sin seña, o seña pagada) en la cola de avisos — antes salía de
// create-appointment / mp-webhook en un solo intento y si el SMTP fallaba en
// ese momento se perdía. Se marca listo cuando salió, o cuando ya no tiene
// sentido (turno borrado o cancelado, sin correo); si no, el cron reintenta.
// Exige la service role key como Bearer, igual que send-push.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated, invalidArgument } from '../_shared/auth.ts';
import { smtpConfigurado } from '../_shared/mail.ts';
import { mandarConfirmacion } from '../_shared/confirmacionTurno.ts';
import { marcarEnvio } from '../_shared/envios.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto.');
    }

    const { appointmentId, envioId = null } = await req.json();
    if (!appointmentId) throw invalidArgument('Falta appointmentId.');

    const admin = supabaseAdmin();
    if (!smtpConfigurado()) {
      await marcarEnvio(admin, envioId, { listo: true });
      return jsonResponse({ status: 'sin-credenciales' }, corsHeaders);
    }

    const { data: turno } = await admin.from('appointments').select('*').eq('id', appointmentId).maybeSingle();
    if (!turno || !turno.client_email || !['pendiente', 'confirmada'].includes(turno.status)) {
      await marcarEnvio(admin, envioId, { listo: true });
      return jsonResponse({ status: 'no-corresponde' }, corsHeaders);
    }

    const enviado = await mandarConfirmacion(admin, turno);
    await marcarEnvio(admin, envioId, { listo: enviado });
    return jsonResponse({ status: enviado ? 'sent' : 'failed' }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
