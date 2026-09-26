import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { setBusinessAdmin, revokeBusinessAdmin } from '../../lib/functions';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { capitalize as cap } from '../../utils/text';
import Icon from '../../components/Icon';
import { validarEmailObligatorio, problema, LIMITES } from '../../utils/validaciones';
import ErrorDeCampo from '../../components/ErrorDeCampo';
import { useErrorDeCampo } from '../../hooks/useErrorDeCampo';
import { sucursalesActivas, nombreSucursal } from '../../utils/sucursales';
import { limiteSucursales } from '../../config/plans';

const ROLE_OWNER = { value: 'owner', label: 'Dueño/a — acceso total' };

const EMPTY_FORM = { email: '', role: 'admin', professionalId: '', branchId: '', name: '' };
const ROLE_MANAGER = { value: 'manager', label: 'Administrador de sucursal — los turnos de su sucursal' };

export default function AdminsPage() {
  const { user } = useAuth();
  const { authorizedAdmins, professionals, businessId, branches, business } = useTenant();
  const sucursales = sucursalesActivas(branches);
  const { terminology } = useBusinessContext();
  const roleAdmin = { value: 'admin', label: `${cap(terminology.professionalNoun)} — solo sus citas` };

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = nuevo, id = editar
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);
  const errorCampo = useErrorDeCampo();

  // Designar dueños es exclusivo de la plataforma: el dueño es quien paga la
  // cuenta, así que quién lo es no se delega al tenant. La Cloud Function
  // rechaza el intento; acá directamente no se ofrece la opción.
  // Administrador de sucursal: solo con un plan que tenga sucursales (o si ya
  // tiene varias de antes de bajar de plan: lo cargado se conserva).
  const conSucursales = limiteSucursales(business?.planId) !== 1 || sucursales.length > 1;
  const roleOptions = [
    ...(user?.isPlatformOwner ? [ROLE_OWNER] : []),
    roleAdmin,
    ...(conSucursales ? [ROLE_MANAGER] : []),
  ];

  // Solo el dueño entra acá. El corte va DESPUÉS de los hooks: si va antes,
  // React ve una cantidad distinta de hooks entre renders y explota cuando el
  // rol cambia en vivo (pasa al revocar permisos con la sesión abierta).
  if (user?.role !== 'owner') return <Navigate to="/admin" replace />;

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError('');
    errorCampo.limpiar();
    setShowModal(true);
  };

  const openEdit = (admin) => {
    setForm({ email: admin.email, role: admin.role, professionalId: admin.professionalId || '', branchId: admin.branchId || '', name: admin.name || '' });
    setEditTarget(admin.id);
    setError('');
    errorCampo.limpiar();
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setError('');
  };

  const handleSave = async () => {
    setError('');
    const falla = validarEmailObligatorio(form.email)
      || (form.name.trim().length > LIMITES.nombre && problema('name', `El nombre puede tener hasta ${LIMITES.nombre} caracteres.`))
      || (form.role === 'admin' && !form.professionalId && problema('professionalId', `Elegí a qué ${terminology.professionalNoun} corresponde esta cuenta.`))
      || (form.role === 'manager' && !form.branchId && problema('branchId', 'Elegí la sucursal que va a administrar.'))
      // Duplicado de email (solo en creación nueva)
      || (!editTarget
        && authorizedAdmins.some(a => a.email.toLowerCase() === form.email.trim().toLowerCase())
        && problema('email', 'Ese email ya está registrado como administrador.'));
    if (errorCampo.marcar(falla)) return;

    setGuardando(true);
    setError('');
    try {
      // Va por la Cloud Function y no por Firestore: lo que realmente da acceso
      // son los custom claims del token, y solo el Admin SDK los escribe. La
      // función también deja el registro que alimenta esta tabla, así que alta
      // y edición son la misma operación (el id del documento es el email).
      const res = await setBusinessAdmin({
        email: form.email.trim().toLowerCase(),
        businessId,
        role: form.role,
        professionalId: form.role === 'admin' ? form.professionalId : null,
        branchId: form.role === 'manager' ? form.branchId : null,
        name: form.name.trim(),
      });
      setAviso(
        res?.status === 'pending'
          ? `${form.email.trim().toLowerCase()} todavía no entró nunca. El permiso queda anotado y se activa solo la primera vez que inicie sesión.`
          : ''
      );
    } catch (err) {
      console.error('[AdminsPage] No se pudo guardar el admin:', err);
      return setError('No se pudo guardar: ' + err.message);
    } finally {
      setGuardando(false);
    }
    closeModal();
  };

  const handleRemove = async (admin) => {
    // No permitir que el dueño se elimine a sí mismo
    if (admin.email.toLowerCase() === user.email.toLowerCase()) {
      alert('No podés eliminarte a vos mismo como dueño.');
      return;
    }
    if (!window.confirm(`¿Quitar acceso a ${admin.email}?`)) return;
    try {
      // Además de borrar el registro, la función le vacía los claims y corta
      // las sesiones abiertas. Sin eso su token seguiría siendo válido —y
      // dándole acceso— hasta una hora después de quitarlo de la lista.
      await revokeBusinessAdmin({ email: admin.email, businessId });
      setAviso('');
    } catch (err) {
      console.error('[AdminsPage] No se pudo quitar el acceso:', err);
      alert('No se pudo quitar el acceso: ' + err.message);
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Administradores</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Gestioná quién puede acceder al panel. Solo las cuentas de esta lista tienen acceso.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Agregar</button>
      </div>

      {aviso && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          {aviso}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Email autorizado</th>
              <th className="oculta-mobile">Nombre</th>
              <th>Rol</th>
              <th className="oculta-mobile">Profesional o sucursal</th>
              <th className="oculta-mobile">Agregado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {authorizedAdmins.map(admin => {
              const prof = professionals.find(p => p.id === admin.professionalId);
              const isMe = admin.email.toLowerCase() === user.email.toLowerCase();
              return (
                <tr key={admin.id}>
                  <td>
                    <div className="flex items-center gap-sm">
                      <span style={{ fontSize: 20 }}><Icon name={admin.role === 'owner' ? 'crown' : admin.role === 'manager' ? 'building' : 'tag'} /></span>
                      <span>{admin.email}</span>
                      {isMe && <span className="badge badge-primary" style={{ fontSize: 10 }}>Vos</span>}
                    </div>
                  </td>
                  <td className="oculta-mobile">{admin.name || '—'}</td>
                  <td>
                    <span className={`badge ${admin.role === 'owner' ? 'badge-primary' : admin.role === 'manager' ? 'badge-warning' : 'badge-success'}`}>
                      {admin.role === 'owner' ? 'Dueño/a' : admin.role === 'manager' ? 'Admin. de sucursal' : cap(terminology.professionalNoun)}
                    </span>
                  </td>
                  <td className="oculta-mobile">
                    {admin.role === 'manager'
                      ? (nombreSucursal(branches, admin.branchId) || <span className="text-muted">Sin sucursal</span>)
                      : prof?.name || (admin.role === 'owner' ? '—' : <span className="text-muted">Sin asignar</span>)}
                  </td>
                  <td className="text-sm text-secondary oculta-mobile">
                    {/* Viene como Timestamp de Firestore; new Date(timestamp) da Invalid Date. */}
                    {admin.addedAt?.toDate ? admin.addedAt.toDate().toLocaleDateString('es-AR')
                      : admin.addedAt ? new Date(admin.addedAt).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(admin)}><Icon name="edit" /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleRemove(admin)} disabled={isMe}><Icon name="trash" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {authorizedAdmins.length === 0 && (
          <div className="empty-state"><p>No hay administradores configurados.</p></div>
        )}
      </div>

      {/* Info box */}
      <div className="card" style={{ marginTop: 'var(--space-lg)', background: 'var(--primary-light)', border: '1px solid var(--primary)' }}>
        <h4 style={{ color: 'var(--primary)', marginBottom: 'var(--space-sm)' }}>ℹ️ ¿Cómo funciona?</h4>
        <ul style={{ paddingLeft: 'var(--space-lg)', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8 }}>
          <li>Al agregar un email acá, el permiso queda escrito en su cuenta.</li>
          <li><strong>Si ya inició sesión alguna vez</strong> → el acceso queda activo enseguida, pero tiene que cerrar sesión y volver a entrar para que le tome.</li>
          <li><strong>Si nunca entró</strong> → el permiso queda anotado y se activa solo, la primera vez que inicie sesión.</li>
          <li><strong>Quien no está en la lista</strong> → va al flujo normal de reserva de clientes.</li>
          <li><strong>Dueño/a</strong>: ve todas las citas, estadísticas globales y puede modificar todo.</li>
          <li><strong>{cap(terminology.professionalNoun)}</strong>: solo ve las citas asignadas a su perfil de profesional.</li>
          <li><strong>Administrador de sucursal</strong>: ve y gestiona los turnos de su sucursal, su equipo, sus días bloqueados y su horario. No ve las otras sucursales.</li>
        </ul>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>{editTarget ? 'Editar administrador' : 'Agregar administrador'}</h3>
              <button className="modal-close" onClick={closeModal}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              {error && (
                <div className="badge badge-danger mb-md" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
                  {error}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Email <span className="required">*</span></label>
                <input
                  className="form-input"
                  {...errorCampo.campo('email')}
                  type="email"
                  placeholder="nombre@gmail.com"
                  value={form.email}
                  maxLength={LIMITES.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  autoFocus
                />
                <ErrorDeCampo error={errorCampo} campo="email" />
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Tiene que ser el email exacto con el que inicia sesión (su Gmail, o el usuario que le creamos).
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Nombre (opcional)</label>
                <input
                  className="form-input"
                  {...errorCampo.campo('name')}
                  type="text"
                  placeholder="Carlos Gómez"
                  value={form.name}
                  maxLength={LIMITES.nombre}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
                <ErrorDeCampo error={errorCampo} campo="name" />
              </div>

              <div className="form-group">
                <label className="form-label">Rol <span className="required">*</span></label>
                <select
                  className="form-input"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value, professionalId: '', branchId: '' }))}
                >
                  {roleOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {!user?.isPlatformOwner && (
                  <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                    Para designar otro dueño, escribinos: el dueño es la cuenta
                    responsable del abono y lo asignamos nosotros.
                  </p>
                )}
              </div>

              {form.role === 'manager' && (
                <div className="form-group">
                  <label className="form-label">Sucursal <span className="required">*</span></label>
                  <select
                    className="form-input"
                    {...errorCampo.campo('branchId')}
                    value={form.branchId}
                    onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}
                  >
                    <option value="">— Seleccioná una sucursal —</option>
                    {sucursales.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <ErrorDeCampo error={errorCampo} campo="branchId" />
                  <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                    Solo va a ver los turnos y el equipo de esta sucursal.
                  </p>
                </div>
              )}

              {form.role === 'admin' && (
                <div className="form-group">
                  <label className="form-label">Profesional vinculado <span className="required">*</span></label>
                  <select
                    className="form-input"
                    {...errorCampo.campo('professionalId')}
                    value={form.professionalId}
                    onChange={e => setForm(f => ({ ...f, professionalId: e.target.value }))}
                  >
                    <option value="">— Seleccioná un profesional —</option>
                    {professionals.filter(p => p.isActive).map(p => (
                      <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
                    ))}
                  </select>
                  <ErrorDeCampo error={errorCampo} campo="professionalId" />
                  <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                    Solo va a ver las citas asignadas a este perfil.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={guardando}>
                {guardando ? 'Guardando…' : editTarget ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
