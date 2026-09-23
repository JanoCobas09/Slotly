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
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated, invalidArgument } from '../_shared/auth.ts';
import { enviarWebPush } from '../_shared/webpush.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto.');
    }

    const { businessId, professionalId = null, title, body, url } = await req.json();
    if (!businessId || !title || !body) throw invalidArgument('Faltan businessId, title o body.');

    const admin = supabaseAdmin();
    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key, role, professional_id')
      .eq('business_id', businessId);
    if (error) throw error;

    const destinatarios = (subs || []).filter(
      (s) => s.role === 'owner' || (s.role === 'admin' && s.professional_id === professionalId),
    );
    if (destinatarios.length === 0) return jsonResponse({ status: 'sin-destinatarios', enviados: 0 }, corsHeaders);

    const { enviados, fallidos } = await enviarWebPush(admin, destinatarios, { title, body, url });
    return jsonResponse({ status: 'processed', enviados, fallidos }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
