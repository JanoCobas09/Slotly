import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import { capitalize } from '../../utils/text';
import { esReservaDelCliente } from '../../utils/turnos';
import { datosDe, hayVariasSucursales, nombreSucursal } from '../../utils/sucursales';
import AvisoWhatsApp from './AvisoWhatsApp';
import SenaTurno from './SenaTurno';
import Icon from '../Icon';

const ESTADOS = {
  pendiente:  { label: 'Pendiente',  clase: 'badge-warning' },
  confirmada: { label: 'Confirmada', clase: 'badge-success' },
  completada: { label: 'Completada', clase: 'badge-primary' },
  cancelada:  { label: 'Cancelada',  clase: 'badge-danger' },
  no_asistio: { label: 'No asistió', clase: 'badge-danger' },
};

const fechaHora = (iso) => new Date(iso).toLocaleString('es-AR', {
  day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Un turno abierto como tarjeta: todos sus datos, los avisos por WhatsApp
 * (el que corresponde ahora + cuáles ya se mandaron) y las acciones de la
 * pantalla que lo abre (`acciones(apt)`, las mismas de la fila). Se abre al
 * tocar un turno en Citas, en la agenda de Inicio / Hoy y en la semana, y
 * solo después de cancelar uno, para avisarle al cliente en el momento.
 *
 * Recibe el id y lee el turno vivo de useTenant: así lo que se toca acá
 * (marcar un aviso, confirmar...) se ve al instante en la tarjeta.
 */
export default function DetalleTurnoModal({ aptId, onClose, acciones = null, isOwner = false }) {
  const { appointments, professionals, services, branches, business } = useTenant();
  const { terminology } = useBusinessContext();
  const apt = (appointments || []).find((a) => a.id === aptId);
  if (!apt) return null;

  const walkin = apt.type === 'walkin';
  const est = ESTADOS[apt.status] || { label: apt.status, clase: 'badge-neutral' };
  const profesional = (professionals || []).find((p) => p.id === apt.professionalId);
  const servicio = apt.serviceName || (services || []).find((s) => s.id === apt.serviceId)?.name;
  const branch = (branches || []).find((b) => b.id === apt.branchId);
  const direccion = datosDe(branch, business).address;
  const cancelada = apt.status === 'cancelada';

  const filas = [
    ['calendar', 'Día', capitalize(formatDate(apt.appointmentDate).split(',')[0])],
    ['clock', 'Hora', `${apt.startTime}${apt.endTime ? ` a ${apt.endTime}` : ''} hs`],
    servicio && ['services', 'Servicio', servicio],
    profesional && ['user', capitalize(terminology.professionalNoun), profesional.name],
    hayVariasSucursales(branches) && apt.branchId && ['building', 'Sucursal', nombreSucursal(branches, apt.branchId)],
    direccion && !walkin && ['pin', 'Dirección', direccion],
    !walkin && Number(apt.price) > 0 && ['money', 'Precio', formatPrice(Number(apt.price), business?.currency)],
  ].filter(Boolean);

  const avisos = [
    apt.whatsappConfirmacionAt && `Confirmación enviada el ${fechaHora(apt.whatsappConfirmacionAt)}`,
    apt.whatsappRecordatorioAt && `Recordatorio enviado el ${fechaHora(apt.whatsappRecordatorioAt)}`,
    apt.whatsappCancelacionAt && `Cancelación avisada el ${fechaHora(apt.whatsappCancelacionAt)}`,
  ].filter(Boolean);

  const quienCancelo = apt.cancelledBy === 'client'
    ? 'el cliente'
    : apt.cancelledByName || 'el negocio';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content detalle-turno" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {walkin ? <><Icon name="clipboard" /> Servicio sin turno</> : (apt.clientName || 'Cliente')}
              <span className={`badge ${est.clase}`}>{est.label}</span>
            </h3>
            <p className="text-xs text-muted" style={{ marginTop: 2 }}>
              {walkin ? 'Registrado en el momento' : esReservaDelCliente(apt) ? 'Lo reservó el cliente desde tu link' : 'Lo cargó el negocio'}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>

        <div className="modal-body">
          <dl className="detalle-turno-datos">
            {filas.map(([icono, etiqueta, valor]) => (
              <div key={etiqueta} className="detalle-turno-fila">
                <dt><Icon name={icono} /> {etiqueta}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
            {!walkin && (
              <div className="detalle-turno-fila">
                <dt><Icon name="phone" /> Teléfono</dt>
                <dd>{apt.clientPhone ? <a href={`tel:${apt.clientPhone}`}>{apt.clientPhone}</a> : <span className="text-muted">Sin teléfono</span>}</dd>
              </div>
            )}
            {apt.clientEmail && (
              <div className="detalle-turno-fila">
                <dt><Icon name="mail" /> Email</dt>
                <dd><a href={`mailto:${apt.clientEmail}`}>{apt.clientEmail}</a></dd>
              </div>
            )}
            {apt.notes && (
              <div className="detalle-turno-fila">
                <dt><Icon name="note" /> Notas</dt>
                <dd>{apt.notes}</dd>
              </div>
            )}
          </dl>

          {apt.depositStatus && <div style={{ marginTop: 'var(--space-sm)' }}><SenaTurno apt={apt} isOwner={isOwner} /></div>}

          {cancelada && (
            <div className="notice notice-danger" style={{ marginTop: 'var(--space-md)' }}>
              <strong>Cancelado por {quienCancelo}</strong>
              {apt.cancelledAt && <> el {fechaHora(apt.cancelledAt)}</>}
              {apt.cancellationReason && <div style={{ marginTop: 4 }}>Motivo: {apt.cancellationReason}</div>}
            </div>
          )}

          {!walkin && (
            <div className="detalle-turno-avisos">
              <div className="detalle-turno-avisos-titulo"><Icon name="whatsapp" /> Avisos por WhatsApp</div>
              <AvisoWhatsApp apt={apt} />
              {avisos.map((t) => <div key={t} className="text-xs text-muted"><Icon name="check" /> {t}</div>)}
              {avisos.length === 0 && (
                <div className="text-xs text-muted">Todavía no se le mandó ningún aviso.</div>
              )}
            </div>
          )}
        </div>

        {/* Las acciones (editar, completar, cancelar...) son solo de un turno
            vivo: en uno terminado quedaba el pie vacío. */}
        {acciones && (apt.status === 'pendiente' || apt.status === 'confirmada') && (
          <div className="modal-footer detalle-turno-acciones">
            {acciones(apt)}
          </div>
        )}
      </div>
    </div>
  );
}
