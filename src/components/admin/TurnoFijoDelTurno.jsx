import { useEffect, useState } from 'react';
import { getTurnoFijo, terminarTurnoFijo } from '../../lib/repository';
import { describirTurnoFijo, ddmm } from '../../utils/turnosFijos';
import { mensajeDeError } from '../../utils/errores';
import Icon from '../Icon';

/**
 * En la tarjeta de un turno que es parte de un turno fijo: cada cuánto se
 * repite, hasta cuándo, qué fechas que vienen no se pudieron agendar, y
 * "Terminar el turno fijo" (desde este turno en adelante). Para faltar una
 * sola vez alcanza con cancelar este turno: los demás siguen.
 */
export default function TurnoFijoDelTurno({ apt, onTerminado }) {
  const [fijo, setFijo] = useState(null);
  const [error, setError] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vigente = true;
    getTurnoFijo(apt.turnoFijoId)
      .then((t) => { if (vigente) setFijo(t); })
      .catch((e) => { if (vigente) setError(mensajeDeError(e, 'No se pudo leer el turno fijo.')); });
    return () => { vigente = false; };
  }, [apt.turnoFijoId]);

  if (!fijo) return error ? <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p> : null;

  const terminar = async () => {
    setTrabajando(true);
    setError('');
    try {
      await terminarTurnoFijo(fijo.id, apt.appointmentDate);
      onTerminado?.();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo terminar el turno fijo.'));
      setTrabajando(false);
    }
  };

  const vivo = apt.status === 'pendiente' || apt.status === 'confirmada';
  return (
    <div className="turno-fijo-caja">
      <div className="turno-fijo-titulo">
        <Icon name="calendar" /> <strong>Turno fijo:</strong> {describirTurnoFijo(fijo)}
      </div>
      <p className="text-xs text-muted">
        {fijo.activo
          ? (fijo.fechaFin ? `Hasta el ${ddmm(fijo.fechaFin)}.` : 'Sin fecha de fin: se va agendando solo.')
          : `Terminado${fijo.fechaFin ? ` (el último fue el ${ddmm(fijo.fechaFin)})` : ''}.`}
        {fijo.activo && vivo && ' Para que falte solo esta vez, cancelá este turno: los demás siguen.'}
      </p>

      {fijo.saltados?.length > 0 && (
        <div className="notice notice-warn" style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Próximas fechas que no se agendaron:</strong>
          <ul className="turno-fijo-saltados">
            {fijo.saltados.map((x) => <li key={x.fecha}>{ddmm(x.fecha)} — {x.motivo}</li>)}
          </ul>
        </div>
      )}

      {fijo.activo && vivo && (
        confirmando ? (
          <div className="doc-confirmar" role="alertdialog" aria-label="Terminar turno fijo" style={{ marginTop: 8 }}>
            <p>¿Terminar el turno fijo de <strong>{fijo.clientName}</strong>? Se borran este turno y todos los que siguen. Los anteriores quedan en el historial.</p>
            <div className="flex gap-sm">
              <button type="button" className="btn btn-danger btn-sm" onClick={terminar} disabled={trabajando}>
                {trabajando ? 'Terminando…' : 'Sí, terminar'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmando(false)} disabled={trabajando}>No</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setConfirmando(true)}>
            Terminar el turno fijo desde este día
          </button>
        )
      )}
      {error && <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</p>}
    </div>
  );
}
