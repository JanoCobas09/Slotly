// ============================================================================
// estado-sena
// ============================================================================
// Estado de la seña de UN turno, para la pantalla /:slug/pago a la que vuelve
// el cliente desde Mercado Pago. No pide sesión a propósito: MP a veces lo
// devuelve a otro navegador que el de la reserva (el celular abre la app de
// MP y vuelve al navegador por defecto, o la app instalada no comparte sesión
// con el navegador en iOS). Sin sesión, la suscripción de "mis turnos" no
// trae nada y el cliente no sabría si su turno quedó confirmado.
//
// Lo que autentica es el id del turno (uuid al azar, solo lo conoce quien
// reservó: viaja en la URL de vuelta de MP). Aun así no devuelve ningún dato
// personal: ni nombre, ni teléfono, ni mail del cliente.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, invalidArgument } from '../_shared/auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { appointmentId } = await req.json();
    if (!UUID.test(appointmentId || '')) throw invalidArgument('Turno inválido.');

    const { data: t, error } = await supabaseAdmin()
      .from('appointments')
      .select('id, business_id, professional_id, service_id, service_name, appointment_date, start_time, end_time, price, status, deposit_status, deposit_amount, deposit_expires_at, deposit_checkout_url')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) throw error;
    // Solo turnos con seña: esto no es una forma de consultar cualquier turno.
    if (!t || !t.deposit_status) return jsonResponse({ turno: null }, corsHeaders);

    return jsonResponse({
      turno: {
        id: t.id,
        businessId: t.business_id,
        professionalId: t.professional_id,
        serviceId: t.service_id,
        serviceName: t.service_name,
        appointmentDate: t.appointment_date,
        startTime: t.start_time,
        endTime: t.end_time,
        price: t.price,
        status: t.status,
        depositStatus: t.deposit_status,
        depositAmount: t.deposit_amount,
        depositExpiresAt: t.deposit_expires_at,
        // Solo mientras se puede pagar: para el botón "Pagar seña".
        depositCheckoutUrl: t.deposit_status === 'pendiente' ? t.deposit_checkout_url : null,
      },
    }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
