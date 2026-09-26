import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { updateInSubcollection } from '../../lib/repository';
import { datosDe, HORARIO_INICIAL } from '../../utils/sucursales';
import { validarHorarioNegocio } from '../../utils/validaciones';
import HorarioAtencion from '../../components/admin/HorarioAtencion';
import Icon from '../../components/Icon';

/**
 * La sucursal del administrador (role 'manager'): sus datos (solo lectura —
 * los cambia el dueño) y su horario de atención, que sí puede cambiar. La
 * base lo hace cumplir igual: el trigger proteger_campos_sucursal solo le
 * deja tocar el horario.
 */
export default function MiSucursalPage() {
  const { user } = useAuth();
  const { branches, business, businessId } = useTenant();
  const sucursal = (branches || []).find((b) => b.id === user?.branchId);

  // null = sin tocar: el formulario sigue al dato vivo (mismo criterio que Configuración).
  const [editado, setEditado] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState(false);

  if (!sucursal) return <div className="empty-state"><p>No encontramos tu sucursal. Escribile al dueño del negocio.</p></div>;

  const actual = { propio: Boolean(sucursal.businessHours), dias: sucursal.businessHours || business?.businessHours || HORARIO_INICIAL };
  const form = editado || actual;
  const datos = datosDe(sucursal, business);

  const guardar = async () => {
    if (form.propio) {
      const e = validarHorarioNegocio(form.dias);
      if (e) { setError(e); return; }
    }
    setGuardando(true);
    setError('');
    try {
      await updateInSubcollection(businessId, 'branches', sucursal.id, { businessHours: form.propio ? form.dias : null });
      setEditado(null);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 3000);
    } catch (e) {
      setError('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>{sucursal.name}</h1>
        {guardado && <span className="badge badge-success"><Icon name="check-circle" /> Guardado</span>}
      </div>

      <div className="card">
        <h3 className="mb-sm">Datos</h3>
        <div className="text-sm flex flex-col gap-sm">
          <span><Icon name="pin" /> {datos.address || 'Sin dirección'}</span>
          <span><Icon name="phone" /> {datos.phone || 'Sin teléfono'}</span>
        </div>
        <p className="text-xs text-muted mt-sm">Para cambiar estos datos, pedíselo al dueño del negocio.</p>
      </div>

      <div className="card mt-md">
        <h3 className="mb-sm">Horario de atención</h3>
        <label className="flex items-center gap-sm mb-md" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={form.propio} onChange={(e) => setEditado({ ...form, propio: e.target.checked })} />
          <span>Horario propio de {sucursal.name}</span>
        </label>
        {form.propio
          ? <HorarioAtencion dias={form.dias} onChange={(dias) => setEditado({ ...form, dias })} />
          : <p className="text-sm text-secondary">Usa el horario general del negocio.</p>}
        {error && <div className="notice notice-danger mt-md">{error}</div>}
        <div className="flex gap-sm mt-lg">
          <button className="btn btn-primary" onClick={guardar} disabled={guardando || !editado}>
            {guardando ? 'Guardando…' : <><Icon name="save" /> Guardar horario</>}
          </button>
        </div>
      </div>
    </div>
  );
}
