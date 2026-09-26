import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { addToSubcollection, updateInSubcollection, removeFromSubcollection } from '../../lib/repository';
import { profesionalesDeSucursal, sucursalesActivas, HORARIO_INICIAL } from '../../utils/sucursales';
import { validarHorarioNegocio, esTelefono, esUrl, LIMITES } from '../../utils/validaciones';
import { formatPrice, toDateString } from '../../utils/dateUtils';
import HorarioAtencion from '../../components/admin/HorarioAtencion';
import Icon from '../../components/Icon';

const VACIA = { name: '', address: '', phone: '', mapsUrl: '', horarioPropio: false, businessHours: HORARIO_INICIAL, precios: {} };

/**
 * Sucursales del negocio (solo el dueño). Cada una tiene sus datos de
 * contacto, su horario (propio o el general de Configuración) y, si hace
 * falta, precios propios. Los profesionales se asignan desde el horario de
 * cada uno (Profesionales → cada franja dice en qué sucursal es) y los
 * administradores de sucursal desde Administradores.
 */
export default function SucursalesPage() {
  const { branches, businessId, business, professionals, schedules, services, branchServicePrices, appointments, authorizedAdmins, slug } = useTenant();
  const { terminology } = useBusinessContext();
  const [editando, setEditando] = useState(null); // null | 'nueva' | branch
  const [form, setForm] = useState(VACIA);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [copiado, setCopiado] = useState(null);

  const lista = [...(branches || [])].sort((a, b) => (a.isMain === b.isMain ? a.name.localeCompare(b.name) : a.isMain ? -1 : 1));
  const serviciosActivos = services.filter((s) => s.isActive !== false);
  const hoy = toDateString(new Date());

  const abrir = (b) => {
    setError('');
    if (!b) {
      setForm(VACIA);
      setEditando('nueva');
      return;
    }
    const precios = Object.fromEntries(branchServicePrices.filter((p) => p.branchId === b.id).map((p) => [p.serviceId, String(p.price)]));
    setForm({
      name: b.name, address: b.address || '', phone: b.phone || '', mapsUrl: b.mapsUrl || '',
      horarioPropio: Boolean(b.businessHours), businessHours: b.businessHours || business?.businessHours || HORARIO_INICIAL, precios,
    });
    setEditando(b);
  };

  const validar = () => {
    const nombre = form.name.trim();
    if (nombre.length < 2 || nombre.length > 60) return 'El nombre de la sucursal tiene que tener entre 2 y 60 caracteres.';
    if (form.address.trim().length > LIMITES.direccion) return `La dirección puede tener hasta ${LIMITES.direccion} caracteres.`;
    if (!esTelefono(form.phone)) return 'El teléfono no es válido: usá solo números, con código de área.';
    if (!esUrl(form.mapsUrl)) return 'El link de Google Maps tiene que empezar con https://';
    if (form.horarioPropio) {
      const e = validarHorarioNegocio(form.businessHours);
      if (e) return e;
    }
    for (const [, v] of Object.entries(form.precios)) {
      if (String(v).trim() !== '' && !(Number(v) >= 0)) return 'Los precios no pueden ser negativos.';
    }
    return '';
  };

  const guardar = async () => {
    const e = validar();
    if (e) { setError(e); return; }
    setGuardando(true);
    setError('');
    try {
      const datos = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        mapsUrl: form.mapsUrl.trim() || null,
        businessHours: form.horarioPropio ? form.businessHours : null,
      };
      const branchId = editando === 'nueva'
        ? await addToSubcollection(businessId, 'branches', { ...datos, isMain: false, isActive: true })
        : (await updateInSubcollection(businessId, 'branches', editando.id, datos), editando.id);

      // Precios: con valor → se guarda; vacío → se borra (vale el del servicio).
      const actuales = branchServicePrices.filter((p) => p.branchId === branchId);
      for (const srv of serviciosActivos) {
        const valor = String(form.precios[srv.id] ?? '').trim();
        const fila = actuales.find((p) => p.serviceId === srv.id);
        if (valor === '' && fila) await removeFromSubcollection(businessId, 'branchServicePrices', fila.id);
        else if (valor !== '' && fila && Number(fila.price) !== Number(valor)) await updateInSubcollection(businessId, 'branchServicePrices', fila.id, { price: Number(valor) });
        else if (valor !== '' && !fila) await addToSubcollection(businessId, 'branchServicePrices', { branchId, serviceId: srv.id, price: Number(valor) });
      }
      setEditando(null);
    } catch (err) {
      setError('No se pudo guardar: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const turnosFuturos = (b) => appointments.filter((a) => a.branchId === b.id && a.appointmentDate >= hoy && (a.status === 'pendiente' || a.status === 'confirmada')).length;

  const alternarActiva = async (b) => {
    if (b.isActive !== false && turnosFuturos(b) > 0
      && !window.confirm(`${b.name} tiene ${turnosFuturos(b)} ${terminology.appointmentNoun}(s) por delante. Si la desactivás, esos quedan como están pero nadie más puede reservar ahí. ¿Desactivarla?`)) return;
    try {
      await updateInSubcollection(businessId, 'branches', b.id, { isActive: b.isActive === false });
    } catch (err) {
      alert('No se pudo cambiar: ' + err.message);
    }
  };

  const eliminar = async (b) => {
    const futuros = turnosFuturos(b);
    if (futuros > 0) {
      alert(`${b.name} tiene ${futuros} ${terminology.appointmentNoun}(s) por delante. Cancelalos o movelos antes de eliminarla, o desactivala.`);
      return;
    }
    if (!window.confirm(`¿Eliminar ${b.name}? Se borran también los horarios que los ${terminology.professionalNoun}s tenían ahí.`)) return;
    try {
      await removeFromSubcollection(businessId, 'branches', b.id);
    } catch (err) {
      alert('No se pudo eliminar: ' + err.message);
    }
  };

  const copiarLink = async (b) => {
    const link = `${window.location.origin}/${slug || business?.slug}?sucursal=${b.id}`;
    try { await navigator.clipboard.writeText(link); } catch { window.prompt('Copiá el link:', link); }
    setCopiado(b.id);
    setTimeout(() => setCopiado(null), 2000);
  };

  const variasActivas = sucursalesActivas(branches).length > 1;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Sucursales</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Los lugares donde atendés. {variasActivas
              ? 'Tus clientes eligen la sucursal al reservar.'
              : 'Con una sola, tus clientes reservan como siempre; al sumar otra, eligen dónde.'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => abrir(null)}>+ Agregar sucursal</button>
      </div>

      <div className="flex flex-col gap-md">
        {lista.map((b) => {
          const profs = profesionalesDeSucursal(professionals, schedules, b.id);
          const admins = (authorizedAdmins || []).filter((a) => a.role === 'manager' && a.branchId === b.id);
          return (
            <div key={b.id} className="card" style={{ opacity: b.isActive === false ? 0.6 : 1 }}>
              <div className="flex items-center gap-sm" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Icon name="building" /> {b.name}
                    {b.isMain && <span className="badge badge-primary">Principal</span>}
                    {b.isActive === false && <span className="badge badge-neutral">Desactivada</span>}
                  </h3>
                  <p className="text-sm text-secondary" style={{ marginTop: 4 }}>
                    {b.address || business?.address || 'Sin dirección'} · {b.businessHours ? 'Horario propio' : 'Horario general'}
                  </p>
                </div>
                <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                  {variasActivas && b.isActive !== false && (
                    <button className="btn btn-ghost btn-sm" onClick={() => copiarLink(b)}>
                      <Icon name={copiado === b.id ? 'check' : 'link'} /> {copiado === b.id ? 'Copiado' : 'Link directo'}
                    </button>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={() => abrir(b)}><Icon name="edit" /> Editar</button>
                  {!b.isMain && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => alternarActiva(b)}>{b.isActive === false ? 'Activar' : 'Desactivar'}</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => eliminar(b)} title="Eliminar"><Icon name="trash" /></button>
                    </>
                  )}
                </div>
              </div>
              <div className="text-sm" style={{ marginTop: 'var(--space-sm)', display: 'grid', gap: 4 }}>
                <span>
                  <Icon name="users" /> {profs.length
                    ? profs.map((p) => p.name).join(', ')
                    : <span className="text-muted">Sin {terminology.professionalNoun}s todavía — asignalos desde el horario de cada uno en <Link to="/admin/profesionales">Profesionales</Link>.</span>}
                </span>
                <span>
                  <Icon name="shield" /> {admins.length
                    ? admins.map((a) => a.name || a.email).join(', ')
                    : <span className="text-muted">Sin administrador — <Link to="/admin/admins">asignar uno</Link>.</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {editando && (
        <div className="modal-overlay" onClick={() => !guardando && setEditando(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-header">
              <h2>{editando === 'nueva' ? 'Nueva sucursal' : `Editar ${editando.name}`}</h2>
              <button className="modal-close" onClick={() => setEditando(null)}><Icon name="x" /></button>
            </div>
            <div className="modal-body flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Nombre <span className="required">*</span></label>
                <input className="form-input" value={form.name} maxLength={60} placeholder="Ej: Centro, Norte, Local de Palermo" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Dirección</label>
                  <input className="form-input" value={form.address} maxLength={LIMITES.direccion} placeholder={business?.address || 'Av. Siempre Viva 123'} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input className="form-input" type="tel" value={form.phone} maxLength={LIMITES.telefono} placeholder={business?.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Link de Google Maps</label>
                <input className="form-input" value={form.mapsUrl} maxLength={LIMITES.url} placeholder="https://maps.app.goo.gl/..." onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })} />
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>Lo que dejes vacío usa los datos generales del negocio (Configuración).</p>
              </div>

              <div className="form-group">
                <label className="flex items-center gap-sm" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.horarioPropio} onChange={(e) => setForm({ ...form, horarioPropio: e.target.checked })} />
                  <span><strong>Horario de atención propio</strong></span>
                </label>
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  {form.horarioPropio ? 'Esta sucursal abre en estos días y horarios.' : 'Usa el horario de atención general de Configuración.'}
                </p>
              </div>
              {form.horarioPropio && <HorarioAtencion dias={form.businessHours} onChange={(businessHours) => setForm({ ...form, businessHours })} />}

              {serviciosActivos.length > 0 && (
                <div>
                  <h3 style={{ marginBottom: 4 }}>Precios en esta sucursal</h3>
                  <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-sm)' }}>Dejalo vacío para cobrar el precio general del servicio.</p>
                  <div className="flex flex-col gap-sm">
                    {serviciosActivos.map((srv) => (
                      <div key={srv.id} className="flex items-center gap-sm" style={{ justifyContent: 'space-between' }}>
                        <span className="text-sm">{srv.name}</span>
                        <input
                          className="form-input" type="number" min={0} inputMode="decimal"
                          style={{ maxWidth: 160 }}
                          placeholder={formatPrice(srv.price, business?.currency)}
                          value={form.precios[srv.id] ?? ''}
                          onChange={(e) => setForm({ ...form, precios: { ...form.precios, [srv.id]: e.target.value } })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <div className="notice notice-danger">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setEditando(null)} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
