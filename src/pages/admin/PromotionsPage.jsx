import { useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { addToSubcollection, updateInSubcollection, removeFromSubcollection } from '../../lib/repository';
import { formatPrice, getDayName } from '../../utils/dateUtils';
import Icon from '../../components/Icon';
import ErrorDeCampo from '../../components/ErrorDeCampo';
import { useErrorDeCampo } from '../../hooks/useErrorDeCampo';
import { problema, esHora } from '../../utils/validaciones';

const FORM_VACIO = {
  serviceId: '', dayOfWeek: 0, startTime: '14:00', endTime: '17:00',
  discountType: 'percentage', discountValue: 20, isActive: true,
};

export default function PromotionsPage() {
  const { promotions, services, business, businessId } = useTenant();
  const [guardando, setGuardando] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [error, setError] = useState('');
  const errorCampo = useErrorDeCampo();

  const serviciosActivos = services.filter((s) => s.isActive);
  const nombreServicio = (id) => services.find((s) => s.id === id)?.name || 'Servicio eliminado';

  const openAdd = () => {
    if (serviciosActivos.length === 0) return;
    setEditing(null);
    setForm({ ...FORM_VACIO, serviceId: serviciosActivos[0].id });
    setError('');
    errorCampo.limpiar();
    setShowModal(true);
  };

  const openEdit = (promo) => {
    setEditing(promo);
    setForm({
      serviceId: promo.serviceId, dayOfWeek: promo.dayOfWeek,
      startTime: promo.startTime, endTime: promo.endTime,
      discountType: promo.discountType, discountValue: promo.discountValue,
      isActive: promo.isActive !== false,
    });
    setError('');
    errorCampo.limpiar();
    setShowModal(true);
  };

  const handleSave = async () => {
    const valor = Number(form.discountValue);
    const falla = (!form.serviceId && problema('serviceId', 'Elegí un servicio.'))
      || ((!esHora(form.startTime) || !esHora(form.endTime)) && problema('horario', 'Completá desde y hasta qué hora.'))
      || (form.startTime >= form.endTime && problema('horario', 'El horario "hasta" tiene que ser después del "desde".'))
      || (!(valor > 0) && problema('discountValue', 'El descuento tiene que ser mayor a cero.'))
      || (form.discountType === 'percentage' && valor >= 100 && problema('discountValue', 'El porcentaje tiene que ser menor a 100.'));
    if (errorCampo.marcar(falla)) return;

    setGuardando(true);
    setError('');
    try {
      if (editing) {
        await updateInSubcollection(businessId, 'promotions', editing.id, { ...form, discountValue: valor });
      } else {
        await addToSubcollection(businessId, 'promotions', { ...form, discountValue: valor });
      }
      setShowModal(false);
    } catch (err) {
      console.error('[PromotionsPage] No se pudo guardar:', err);
      setError('No se pudo guardar la promo: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const toggleActiva = async (promo) => {
    try {
      await updateInSubcollection(businessId, 'promotions', promo.id, { isActive: promo.isActive === false });
    } catch (err) {
      console.error('[PromotionsPage] No se pudo cambiar el estado:', err);
      alert('No se pudo cambiar el estado: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta promoción?')) return;
    try {
      await removeFromSubcollection(businessId, 'promotions', id);
    } catch (err) {
      console.error('[PromotionsPage] No se pudo eliminar:', err);
      alert('No se pudo eliminar: ' + err.message);
    }
  };

  const descripcionDescuento = (promo) =>
    promo.discountType === 'fixed'
      ? `Precio promo: ${formatPrice(promo.discountValue, business?.currency)}`
      : `${promo.discountValue}% OFF`;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Promociones</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Descuentos por día y horario para un servicio puntual — se ven reflejados en la reserva del cliente.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAdd} disabled={serviciosActivos.length === 0}>
          + Agregar Promo
        </button>
      </div>

      {serviciosActivos.length === 0 && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          Primero cargá al menos un servicio activo: la promo siempre es sobre un servicio puntual.
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Servicio</th>
              <th>Día</th>
              <th className="oculta-mobile">Horario</th>
              <th>Descuento</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((promo) => (
              <tr key={promo.id}>
                <td><strong>{nombreServicio(promo.serviceId)}</strong></td>
                <td>{getDayName(promo.dayOfWeek)}</td>
                <td className="oculta-mobile">{promo.startTime} — {promo.endTime}</td>
                <td>
                  <span className="badge badge-warning">
                    <Icon name="tag" /> {descripcionDescuento(promo)}
                  </span>
                </td>
                <td>
                  <button
                    className={`badge ${promo.isActive === false ? 'badge-neutral' : 'badge-success'}`}
                    style={{ border: 'none', cursor: 'pointer' }}
                    onClick={() => toggleActiva(promo)}
                    title="Tocar para activar/pausar"
                  >
                    {promo.isActive === false ? 'Pausada' : 'Activa'}
                  </button>
                </td>
                <td>
                  <div className="table-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => openEdit(promo)}><Icon name="edit" /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(promo.id)}><Icon name="trash" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {promotions.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon name="tag" /></div>
            <p style={{ marginBottom: 'var(--space-md)' }}>
              Todavía no hay promociones. Por ejemplo: "20% OFF en Corte, los martes de 14 a 17hs".
            </p>
            {serviciosActivos.length > 0 && (
              <button className="btn btn-primary" onClick={openAdd}>+ Agregar la primera</button>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>{editing ? 'Editar promoción' : 'Nueva promoción'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              {error && (
                <div className="badge badge-danger mb-md" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
                  {error}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Servicio <span className="required">*</span></label>
                <select className="form-input" {...errorCampo.campo('serviceId')} value={form.serviceId} onChange={(e) => setForm((f) => ({ ...f, serviceId: e.target.value }))}>
                  {serviciosActivos.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} — {formatPrice(s.price, business?.currency)}</option>
                  ))}
                </select>
                <ErrorDeCampo error={errorCampo} campo="serviceId" />
              </div>

              <div className="form-group">
                <label className="form-label">Día <span className="required">*</span></label>
                <select className="form-input" value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}>
                  {Array.from({ length: 7 }, (_, i) => (
                    <option key={i} value={i}>{getDayName(i)}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Desde <span className="required">*</span></label>
                  <input className="form-input" type="time" {...errorCampo.campo('horario')} value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Hasta <span className="required">*</span></label>
                  <input className="form-input" type="time" {...errorCampo.campo('horario')} value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
                </div>
              </div>
              <ErrorDeCampo error={errorCampo} campo="horario" />
              <p className="text-xs text-muted" style={{ marginTop: -8, marginBottom: 'var(--space-md)' }}>
                Aplica a los turnos que EMPIEZAN dentro de este horario.
              </p>

              <div className="form-group">
                <label className="form-label">Tipo de descuento <span className="required">*</span></label>
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <label className="card card-selectable" style={{ flex: 1, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: form.discountType === 'percentage' ? '2px solid var(--primary)' : '1px solid var(--border-color)', margin: 0 }}>
                    <input type="radio" checked={form.discountType === 'percentage'} onChange={() => setForm((f) => ({ ...f, discountType: 'percentage' }))} />
                    Porcentaje
                  </label>
                  <label className="card card-selectable" style={{ flex: 1, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: form.discountType === 'fixed' ? '2px solid var(--primary)' : '1px solid var(--border-color)', margin: 0 }}>
                    <input type="radio" checked={form.discountType === 'fixed'} onChange={() => setForm((f) => ({ ...f, discountType: 'fixed' }))} />
                    Precio fijo
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  {form.discountType === 'fixed' ? 'Precio promocional' : 'Porcentaje de descuento'} <span className="required">*</span>
                </label>
                <div className="flex items-center gap-sm">
                  <input
                    className="form-input" type="number" min="0" max={form.discountType === 'percentage' ? 99 : undefined}
                    {...errorCampo.campo('discountValue')}
                    value={form.discountValue}
                    inputMode="decimal"
                    // Como texto mientras se tipea (ver ServicesPage): con
                    // `Number(valor) || 0` el campo nunca se podía vaciar.
                    onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                    style={{ maxWidth: 160 }}
                  />
                  <span className="text-sm text-muted">{form.discountType === 'fixed' ? (business?.currency || 'ARS') : '%'}</span>
                </div>
                <ErrorDeCampo error={errorCampo} campo="discountValue" />
                {form.discountType === 'percentage' && (() => {
                  const srv = services.find((s) => s.id === form.serviceId);
                  if (!srv) return null;
                  const final = Math.round(srv.price * (1 - form.discountValue / 100));
                  return (
                    <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                      {formatPrice(srv.price, business?.currency)} → {formatPrice(final, business?.currency)}
                    </p>
                  );
                })()}
              </div>

              <label className="flex items-center gap-sm" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Activa (se aplica ya mismo en la reserva)
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={guardando}>
                {guardando ? 'Guardando…' : <><Icon name="save" /> Guardar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
