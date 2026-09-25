import { useTenant } from '../../hooks/useTenantData';
import { updateAppointment } from '../../lib/repository';
import { esTurnoEditable, confirmacionCancelar } from '../../utils/turnos';
import Icon from '../Icon';

const yaEmpezo = (apt) => new Date(`${apt.appointmentDate}T${apt.startTime}:00`) <= new Date();

/**
 * Botones de un turno en la agenda: editar (solo el dueño), confirmar,
 * completar, no asistió y cancelar. Completar y "no asistió" recién cuando
 * el turno ya empezó. Lo usan Inicio (dueño) y "Hoy" (staff), así las dos
 * agendas se comportan igual.
 */
export default function AccionesTurno({ apt, isOwner, onEditar }) {
  const { businessId } = useTenant();
  if (apt.status !== 'pendiente' && apt.status !== 'confirmada') return null;

  const cambiarEstado = (status) => {
    if (status === 'cancelada' && !window.confirm(confirmacionCancelar(apt))) return;
    updateAppointment(businessId, apt.id, { status }).catch((err) => {
      console.error('[AccionesTurno] No se pudo actualizar el turno:', err);
      alert('No se pudo actualizar el turno: ' + err.message);
    });
  };

  const empezo = yaEmpezo(apt);
  const bloqueado = !empezo ? { opacity: 0.35 } : undefined;
  return (
    <>
      {onEditar && esTurnoEditable(apt, isOwner) && (
        <button className="btn btn-ghost btn-sm" title="Editar turno" onClick={() => onEditar(apt)}><Icon name="edit" /></button>
      )}
      {apt.status === 'pendiente' && (
        <button className="btn btn-ghost btn-sm" title="Confirmar" onClick={() => cambiarEstado('confirmada')}><Icon name="check" /></button>
      )}
      <button className="btn btn-ghost btn-sm" title={empezo ? 'Marcar como completada' : 'Todavía no empezó'} disabled={!empezo} style={bloqueado} onClick={() => cambiarEstado('completada')}><Icon name="check-circle" /></button>
      <button className="btn btn-ghost btn-sm" title={empezo ? 'No asistió' : 'Todavía no empezó'} disabled={!empezo} style={bloqueado} onClick={() => cambiarEstado('no_asistio')}><Icon name="user-x" /></button>
      <button className="btn btn-ghost btn-sm" title="Cancelar" onClick={() => cambiarEstado('cancelada')}><Icon name="x-circle" /></button>
    </>
  );
}
