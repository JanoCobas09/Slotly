// ============================================================================
// mp-refund
// ============================================================================
// Botón "Devolver seña" del panel. La seña no se devuelve sola cuando el
// cliente cancela (decisión del negocio): el dueño la devuelve cuando quiere,
// desde acá o desde su propia cuenta de MP. Solo el dueño (o la plataforma):
// es plata de su cuenta.
//
// La devolución es total y sale de la cuenta de MP del negocio, con su token.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller, supabaseAdmin, errorResponse, jsonResponse,
  invalidArgument, notFound, permissionDenied, failedPrecondition, isPlatformOwner,
} from '../_shared/auth.ts';
import { tokenDeNegocio, devolverPago } from '../_shared/mercadopago.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { appointmentId } = await req.json();
    if (!appointmentId) throw invalidArgument('Falta el turno.');

    const admin = supabaseAdmin();
    const { data: turno } = await admin.from('appointments')
      .select('id, business_id, deposit_status, mp_payment_id')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!turno) throw notFound('El turno no existe.');

    if (!isPlatformOwner(caller) && !(caller.role === 'owner' && caller.businessId === turno.business_id)) {
      throw permissionDenied('Solo el dueño del negocio puede devolver una seña.');
    }
    if (turno.deposit_status === 'devuelta') return jsonResponse({ status: 'ya-devuelta' }, corsHeaders);
    if (turno.deposit_status !== 'pagada' || !turno.mp_payment_id) {
      throw failedPrecondition('Este turno no tiene una seña pagada para devolver.');
    }

    const token = await tokenDeNegocio(admin, turno.business_id);
    try {
      await devolverPago(token, turno.mp_payment_id);
    } catch (err) {
      console.error('[mp-refund] Mercado Pago rechazó la devolución:', err);
      throw failedPrecondition(
        'Mercado Pago no permitió la devolución (puede que no tengas saldo suficiente o que el pago sea muy viejo). Probá desde tu cuenta de Mercado Pago.',
      );
    }

    await admin.from('appointments')
      .update({ deposit_status: 'devuelta', deposit_refunded_at: new Date().toISOString() })
      .eq('id', turno.id);

    return jsonResponse({ status: 'devuelta' }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
