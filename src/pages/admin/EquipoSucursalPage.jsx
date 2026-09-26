import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { replaceSchedulesDeSucursal } from '../../lib/repository';
import { profesionalesDeSucursal, schedulesDeSucursal, nombreSucursal } from '../../utils/sucursales';
import { diasDesdeSchedules, schedulesDesdeDias } from '../../utils/horarioSemanal';
import { validarFranjas } from '../../utils/validaciones';
import { getDayName } from '../../utils/dateUtils';
import HorarioSemanal from '../../components/admin/HorarioSemanal';
import Icon from '../../components/Icon';
import ErrorDeCampo from '../../components/ErrorDeCampo';
import { useErrorDeCampo } from '../../hooks/useErrorDeCampo';

/**
 * El equipo de UNA sucursal, para su administrador (role 'manager'): quién
 * atiende ahí y en qué horario. Edita solo las franjas de su sucursal — las
 * que el profesional tiene en otras no se tocan (RLS tampoco lo dejaría),
 * pero se tienen en cuenta para que no se pisen: nadie está en dos lugares.
 * Los datos del profesional (nombre, servicios, contacto) los maneja el dueño.
 */
export default function EquipoSucursalPage() {
  const { user } = useAuth();
  const { branches, professionals, schedules, businessId } = useTenant();
  const { terminology } = useBusinessContext();
  const [editando, setEditando] = useState(null); // profesional
  const [dias, setDias] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [sumar, setSumar] = useState('');
  const errorCampo = useErrorDeCampo();

  const branchId = user?.branchId;
  const sucursal = (branches || []).find((b) => b.id === branchId);
  if (!sucursal) return <div className="empty-state"><p>No encontramos tu sucursal. Escribile al dueño del negocio.</p></div>;

  const equipo = profesionalesDeSucursal(professionals, schedules, branchId);
  const otros = professionals.filter((p) => p.isActive !== false && !equipo.some((e) => e.id === p.id));
  const franjasEnSucursal = (profId) => schedulesDeSucursal(schedules, branchId).filter((s) => s.professionalId === profId);

  const abrir = (prof) => {
    setError('');
    errorCampo.limpiar();
    setDias(diasDesdeSchedules(franjasEnSucursal(prof.id)));
    setEditando(prof);
  };

  const guardar = async () => {
    // Las franjas de este profesional en OTRAS sucursales, para no pisarlas.
    const enOtras = schedules.filter((s) => s.professionalId === editando.id && s.branchId !== branchId && s.isActive !== false);
    // Las de otras sucursales van al final: los índices de las del editor no
    // cambian, así validarFranjas marca la franja correcta.
    const err = dias.filter((d) => d.isActive).map((d) => validarFranjas(
      [...d.franjas, ...enOtras.filter((s) => s.dayOfWeek === d.dayOfWeek).map((s) => ({ startTime: s.startTime, endTime: s.endTime }))],
      getDayName(d.dayOfWeek),
      d.dayOfWeek,
    )).find(Boolean);
    if (err) {
      errorCampo.marcar(err.mensaje.includes('se pisan') ? { ...err, mensaje: `${err.mensaje} (contando el horario que tiene en otra sucursal)` } : err);
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const filas = schedulesDesdeDias(dias, editando.id).map(({ dayOfWeek, startTime, endTime, isActive }) => ({ dayOfWeek, startTime, endTime, isActive }));
      await replaceSchedulesDeSucursal(businessId, editando.id, branchId, filas);
      setEditando(null);
    } catch (e) {
      setError('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  const resumen = (profId) => {
    const porDia = {};
    for (const s of franjasEnSucursal(profId)) (porDia[s.dayOfWeek] ||= []).push(`${s.startTime}–${s.endTime}`);
    return Object.keys(porDia).sort().map((d) => `${getDayName(Number(d)).substring(0, 3)} ${porDia[d].join(', ')}`).join(' · ');
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Equipo</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>Quién atiende en {sucursal.name} y en qué horario.</p>
        </div>
      </div>

      {equipo.length === 0 && (
        <div className="empty-state"><p>Todavía no hay {terminology.professionalNoun}s con horario en {sucursal.name}.</p></div>
      )}

      <div className="flex flex-col gap-md">
        {equipo.map((p) => (
          <div key={p.id} className="card flex items-center gap-md" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div className="flex items-center gap-md">
              <div className="avatar">{p.avatarUrl ? <img src={p.avatarUrl} alt={p.name} /> : p.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
              <div>
                <strong>{p.name}</strong>
                {p.specialty && <div className="text-sm text-secondary">{p.specialty}</div>}
                <div className="text-xs text-muted">{resumen(p.id)}</div>
              </div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={() => abrir(p)}><Icon name="clock" /> Horario en {sucursal.name}</button>
          </div>
        ))}
      </div>

      {otros.length > 0 && (
        <div className="card mt-md">
          <h3 className="mb-sm">Sumar a alguien del negocio</h3>
          <p className="text-sm text-secondary mb-md">Le cargás un horario en {sucursal.name} y pasa a atender también acá.</p>
          <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
            <select className="form-input" style={{ maxWidth: 280 }} value={sumar} onChange={(e) => setSumar(e.target.value)}>
              <option value="">Elegí un {terminology.professionalNoun}</option>
              {otros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn btn-primary" disabled={!sumar} onClick={() => { abrir(otros.find((p) => p.id === sumar)); setSumar(''); }}>
              Cargar horario
            </button>
          </div>
        </div>
      )}

      {editando && (
        <div className="modal-overlay" onClick={() => !guardando && setEditando(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2>{editando.name} en {sucursal.name}</h2>
              <button className="modal-close" onClick={() => setEditando(null)}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-sm)' }}>
                Solo el horario en esta sucursal. Para horario cortado, agregá más de una franja el mismo día.
              </p>
              <HorarioSemanal
                dias={dias} onChange={setDias} diaCorto errorCampo={errorCampo}
                ocupadas={schedules
                  .filter((s) => s.professionalId === editando.id && s.branchId !== branchId && s.isActive !== false && s.startTime && s.endTime)
                  .map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, etiqueta: nombreSucursal(branches, s.branchId) }))}
              />
              <ErrorDeCampo error={errorCampo} prefijo="franja-" />
              {error && <div className="notice notice-danger mt-md">{error}</div>}
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
