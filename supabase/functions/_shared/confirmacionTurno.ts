// ============================================================================
// Mail de confirmación de un turno al cliente
// ============================================================================
// Lo manda la Edge Function mandar-confirmacion, que encola el trigger del
// turno nuevo (notificar_nuevo_turno) apenas se reserva un turno sin seña, o
// cuando se paga la seña de uno que la pedía (antes de eso el turno todavía
// no está confirmado: si no se paga, se libera solo). Si el mail no sale, la
// cola de avisos lo reintenta (20261022000000_cola_de_avisos.sql).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { enviarMail } from './mail.ts';
import { plantillaHtml } from './emailTemplate.ts';

export function fechaLinda(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export interface TurnoParaMail {
  business_id: string; professional_id: string; client_email: string | null; client_name: string | null;
  service_name: string | null; appointment_date: string; start_time: string; end_time: string | null; price: number | null;
  deposit_amount?: number | null; deposit_status?: string | null;
  branch_id?: string | null;
}

/**
 * Sale al toque — a diferencia del recordatorio de send-reminders (que sale
 * recién ~3hs antes): quien acaba de reservar tiene el teléfono en la mano
 * en ese momento. Nunca tira error: devuelve si el mail salió (false = hay
 * que reintentar).
 */
export async function mandarConfirmacion(admin: SupabaseClient, turno: TurnoParaMail): Promise<boolean> {
  if (!turno.client_email) return false;
  try {
    const { data: negocioBase } = await admin.from('businesses').select('name, address, phone').eq('id', turno.business_id).maybeSingle();
    const { data: profesional } = await admin.from('professionals').select('name').eq('id', turno.professional_id).maybeSingle();
    if (!negocioBase) return false; // no debería pasar (el turno ya se creó contra este negocio), pero sin nombre no hay mail que armar

    // Sucursal: su dirección y teléfono pisan los del negocio, y si el
    // negocio tiene más de una se aclara en cuál es el turno.
    const { data: sucursales } = await admin.from('branches').select('id, name, address, phone').eq('business_id', turno.business_id).eq('is_active', true);
    const suc = (sucursales || []).find((b) => b.id === turno.branch_id) || null;
    const nombreSucursal = (sucursales || []).length > 1 && suc ? suc.name : null;
    const negocio = { name: negocioBase.name, address: suc?.address || negocioBase.address, phone: suc?.phone || negocioBase.phone };

    const senaPagada = turno.deposit_status === 'pagada' && turno.deposit_amount != null;
    const conProfesional = profesional?.name ? ` con ${profesional.name}` : '';
    const asunto = `Turno confirmado en ${negocio.name} · ${fechaLinda(turno.appointment_date)} ${turno.start_time}`;
    const nota = 'Si no podés asistir, avisale al negocio con anticipación.';
    const texto =
      `Hola ${turno.client_name || ''},\n\n` +
      `Tu turno${conProfesional} en ${negocio.name} quedó confirmado.\n\n` +
      `Fecha: ${fechaLinda(turno.appointment_date)}\n` +
      `Horario: ${turno.start_time}${turno.end_time ? ` a ${turno.end_time}` : ''}\n` +
      (nombreSucursal ? `Sucursal: ${nombreSucursal}\n` : '') +
      (turno.service_name ? `Servicio: ${turno.service_name}\n` : '') +
      (turno.price != null ? `Precio: $${turno.price}\n` : '') +
      (senaPagada ? `Seña pagada: $${turno.deposit_amount}\n` : '') +
      (negocio.address ? `Dirección: ${negocio.address}\n` : '') +
      (negocio.phone ? `Teléfono: ${negocio.phone}\n` : '') +
      `\n${nota}`;

    const filas = [
      { label: 'Fecha', value: fechaLinda(turno.appointment_date) },
      { label: 'Horario', value: turno.end_time ? `${turno.start_time} a ${turno.end_time}` : turno.start_time },
      ...(nombreSucursal ? [{ label: 'Sucursal', value: nombreSucursal }] : []),
      ...(turno.service_name ? [{ label: 'Servicio', value: turno.service_name }] : []),
      ...(profesional?.name ? [{ label: 'Con', value: profesional.name }] : []),
      ...(turno.price != null ? [{ label: 'Precio', value: `$${turno.price}` }] : []),
      ...(senaPagada ? [{ label: 'Seña pagada', value: `$${turno.deposit_amount}` }] : []),
      ...(negocio.address ? [{ label: 'Dirección', value: negocio.address }] : []),
      ...(negocio.phone ? [{ label: 'Teléfono', value: negocio.phone }] : []),
    ];
    const html = plantillaHtml({
      eyebrow: negocio.name,
      titulo: 'Turno confirmado',
      intro: `Hola ${turno.client_name || ''}, tu turno${conProfesional} quedó confirmado.`,
      filas,
      nota,
    });

    return await enviarMail({ to: turno.client_email, subject: asunto, text: texto, html, fromName: negocio.name });
  } catch (err) {
    console.error('[confirmacionTurno] No se pudo mandar la confirmación por mail:', err);
    return false;
  }
}
