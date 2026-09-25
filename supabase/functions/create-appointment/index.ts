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
//
// Seña: si el negocio la pide, el trigger aplicar_sena_obligatoria deja el
// turno con deposit_status = 'pendiente' (ver 20261004000000_sena_mercado_pago.sql).
// En ese caso acá se arma el checkout de Mercado Pago y se devuelve su link
// en vez de confirmar — la confirmación sale recién desde mp-webhook.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  supabaseAdmin,
  errorResponse,
  jsonResponse,
  errorDeFuncionSql,
  failedPrecondition,
} from '../_shared/auth.ts';
import { mandarConfirmacion } from '../_shared/confirmacionTurno.ts';
import { tokenDeNegocio, crearPreferencia, origenPermitido } from '../_shared/mercadopago.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const {
      businessId, professionalId, serviceId, appointmentDate, startTime,
      clientName = '', clientPhone = '', clientEmail = '', notes = '',
    } = await req.json();

    const admin = supabaseAdmin();

    // Señas vencidas: el cron las borra cada minuto, pero se barren también
    // acá para que un horario recién liberado no rebote por segundos. Y si
    // el mismo cliente ya tenía un turno de ese día esperando seña (volvió
    // atrás desde Mercado Pago y eligió otro horario), ese se descarta:
    // sin esto chocaría con "Ya tenés un turno ese día".
    await admin.rpc('liberar_senas_vencidas');
    if (businessId && appointmentDate) {
      await admin.from('appointments').delete()
        .eq('business_id', businessId)
        .eq('user_id', caller.id)
        .eq('appointment_date', appointmentDate)
        .eq('deposit_status', 'pendiente');
    }

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

    if (data.deposit_status === 'pendiente') {
      let checkoutUrl: string;
      try {
        const { data: negocio } = await admin.from('businesses').select('name, slug').eq('id', businessId).single();
        const token = await tokenDeNegocio(admin, businessId);
        const pref = await crearPreferencia(token, {
          appointmentId: data.id,
          businessId,
          titulo: `Seña · ${data.service_name || 'Turno'} · ${negocio.name}`.slice(0, 250),
          monto: Number(data.deposit_amount),
          emailCliente: data.client_email || null,
          vence: data.deposit_expires_at,
          volverA: `${origenPermitido(req)}/${negocio.slug}/pago?turno=${data.id}`,
        });
        checkoutUrl = pref.init_point;
        await admin.from('appointments')
          .update({ mp_preference_id: pref.id, deposit_checkout_url: checkoutUrl })
          .eq('id', data.id);
      } catch (err) {
        // Sin checkout no hay forma de pagar: se suelta el horario ya mismo
        // en vez de dejarlo retenido 15 minutos por nada.
        console.error('[create-appointment] No se pudo armar el cobro de la seña:', err);
        await admin.from('appointments').delete().eq('id', data.id);
        throw failedPrecondition('No se pudo iniciar el pago de la seña con Mercado Pago. Probá de nuevo en un rato.');
      }

      return jsonResponse({
        status: 'pending_payment',
        id: data.id,
        price: data.price,
        endTime: data.end_time,
        depositAmount: data.deposit_amount,
        expiresAt: data.deposit_expires_at,
        checkoutUrl,
      }, corsHeaders);
    }

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
