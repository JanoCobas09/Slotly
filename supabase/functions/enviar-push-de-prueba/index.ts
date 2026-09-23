// ============================================================================
// enviar-push-de-prueba
// ============================================================================
// Traducción de exports.enviarPushDePrueba en functions/index.js. Para
// validar que el flujo de push funciona en un dispositivo (activar ->
// llega de verdad) sin esperar a que entre un turno real. A diferencia de
// send-push (que reparte según rol), esto NUNCA manda a otra persona: solo
// a los endpoints que la cuenta que llama registró para sí misma — no hace
// falta restringirlo a un rol puntual, no hay forma de que le llegue a
// nadie más.
import { corsHeaders } from '../_shared/cors.ts';
import { getCaller, supabaseAdmin, errorResponse, jsonResponse, permissionDenied, failedPrecondition } from '../_shared/auth.ts';
import { enviarWebPush } from '../_shared/webpush.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    if (!caller.businessId || (caller.role !== 'owner' && caller.role !== 'admin')) {
      throw permissionDenied('Esto es para el panel de un negocio.');
    }

    const admin = supabaseAdmin();
    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('user_id', caller.id);
    if (error) throw error;
    if (!subs || subs.length === 0) {
      throw failedPrecondition('Este dispositivo todavía no activó las notificaciones push.');
    }

    const { enviados } = await enviarWebPush(admin, subs, {
      title: 'Notificación de prueba',
      body: 'Si ves esto, el push está funcionando en este dispositivo.',
      url: '/admin/citas',
    });
    if (enviados === 0) {
      return jsonResponse({ status: 'failed', message: 'No se pudo enviar a ningún dispositivo registrado.' }, corsHeaders, 500);
    }
    return jsonResponse({ status: 'sent', exitosos: enviados }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
