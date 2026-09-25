// ============================================================================
// mp-webhook
// ============================================================================
// Mercado Pago avisa acá cada vez que cambia un pago de una seña (la URL la
// fija create-appointment en cada preferencia, con ?biz=<negocio>).
//
// Sin JWT (verify_jwt = false en config.toml): lo llama MP, no un usuario.
// No hace falta confiar en lo que viene en el aviso: solo se usa el id del
// pago para CONSULTARLO en la API de MP con el token del negocio. Un aviso
// inventado no puede confirmar nada — el pago tiene que existir, estar
// aprobado y ser de la cuenta de ese negocio.
//
// Responde 200 a todo lo que no hay que reintentar (avisos de otro tipo,
// pagos rechazados, repetidos) y 500 solo si falló algo que conviene que MP
// vuelva a mandar (la API de MP no respondió, la base no respondió).
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, jsonResponse } from '../_shared/auth.ts';
import { tokenDeNegocio, obtenerPago, devolverPago } from '../_shared/mercadopago.ts';
import { mandarConfirmacion } from '../_shared/confirmacionTurno.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const businessId = url.searchParams.get('biz') || '';
  let cuerpo: any = {};
  try { cuerpo = await req.json(); } catch { /* los IPN viejos llegan sin cuerpo, todo en la URL */ }

  // Dos formatos: Webhooks (type=payment + data.id) e IPN (topic=payment + id).
  const tipo = cuerpo?.type || url.searchParams.get('type') || url.searchParams.get('topic');
  const paymentId = String(cuerpo?.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || '');

  if (tipo !== 'payment' || !paymentId || !UUID.test(businessId)) {
    return jsonResponse({ status: 'ignorado' }, corsHeaders);
  }

  const admin = supabaseAdmin();
  try {
    const { data: con } = await admin.from('mp_connections').select('business_id').eq('business_id', businessId).maybeSingle();
    if (!con) return jsonResponse({ status: 'sin-conexion' }, corsHeaders);

    const token = await tokenDeNegocio(admin, businessId);
    const pago = await obtenerPago(token, paymentId);
    if (pago?.status !== 'approved') {
      return jsonResponse({ status: 'no-aprobado', estado: pago?.status }, corsHeaders);
    }

    const turnoId = String(pago.external_reference || '');
    const { data: turno } = UUID.test(turnoId)
      ? await admin.from('appointments').select('*').eq('id', turnoId).maybeSingle()
      : { data: null };

    // Mismo pago avisado dos veces (MP reintenta): ya está registrado.
    if (turno && turno.mp_payment_id === String(pago.id)) {
      return jsonResponse({ status: 'ya-registrado' }, corsHeaders);
    }

    const valido = turno
      && turno.business_id === businessId
      && turno.deposit_status === 'pendiente'
      && (turno.status === 'pendiente' || turno.status === 'confirmada')
      && Number(pago.transaction_amount) + 0.01 >= Number(turno.deposit_amount);

    if (valido) {
      // Condicional sobre 'pendiente': si justo el cron lo borró o el cliente
      // lo canceló entre la lectura y acá, no se actualiza nada y cae en la
      // devolución de abajo.
      const { data: actualizado } = await admin.from('appointments')
        .update({ deposit_status: 'pagada', mp_payment_id: String(pago.id), deposit_paid_at: new Date().toISOString() })
        .eq('id', turno.id)
        .eq('deposit_status', 'pendiente')
        .select('*')
        .maybeSingle();

      if (actualizado) {
        const promesaMail = mandarConfirmacion(admin, actualizado);
        // @ts-ignore EdgeRuntime es un global del runtime de Supabase, no de Deno estándar.
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promesaMail);
        else await promesaMail;
        return jsonResponse({ status: 'pagada' }, corsHeaders);
      }
    }

    // Pago aprobado sin turno que lo espere: se venció el plazo y el horario
    // ya se liberó, el cliente canceló mientras pagaba, o pagó dos veces. La
    // plata no puede quedar en el aire: se devuelve entera.
    console.warn(`[mp-webhook] Pago ${pago.id} sin turno esperando seña (turno ${turnoId}); se devuelve.`);
    await devolverPago(token, String(pago.id));
    return jsonResponse({ status: 'devuelto' }, corsHeaders);
  } catch (err) {
    console.error('[mp-webhook] Error procesando el aviso:', err);
    return jsonResponse({ status: 'error' }, corsHeaders, 500);
  }
});
