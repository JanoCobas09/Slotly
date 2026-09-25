import { useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { devolverSena } from '../../lib/functions';
import { formatPrice } from '../../utils/dateUtils';
import Icon from '../Icon';

/**
 * Estado de la seña de un turno en el panel (Citas y la agenda de Inicio):
 * esperando pago, pagada o devuelta. Al dueño le suma "Devolver seña" sobre
 * una pagada — la devolución sale de SU cuenta de Mercado Pago (mp-refund).
 * Nada si el turno no lleva seña.
 */
export default function SenaTurno({ apt, isOwner }) {
  const { business } = useTenant();
  const [devolviendo, setDevolviendo] = useState(false);
  if (!apt?.depositStatus) return null;
  const monto = formatPrice(apt.depositAmount, business?.currency);

  const devolver = async (e) => {
    e.stopPropagation();
    const quien = apt.clientName ? ` a ${apt.clientName}` : '';
    if (!window.confirm(`¿Devolverle la seña de ${monto}${quien}?\n\nSale de tu cuenta de Mercado Pago y no se puede deshacer.`)) return;
    setDevolviendo(true);
    try {
      await devolverSena({ appointmentId: apt.id });
    } catch (err) {
      console.error('[SenaTurno] No se pudo devolver la seña:', err);
      alert(err.message);
    } finally {
      setDevolviendo(false);
    }
  };

  if (apt.depositStatus === 'pendiente') {
    return <span className="badge badge-warning" title="El cliente tiene 15 minutos para pagarla; si no, el turno se libera solo."><Icon name="clock" /> Esperando seña</span>;
  }
  if (apt.depositStatus === 'devuelta') {
    return <span className="badge badge-neutral"><Icon name="lock" /> Seña devuelta</span>;
  }
  return (
    <span className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
      <span className="badge badge-success"><Icon name="lock" /> Seña {monto}</span>
      {isOwner && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={devolver} disabled={devolviendo}>
          {devolviendo ? 'Devolviendo…' : 'Devolver seña'}
        </button>
      )}
    </span>
  );
}
