import { getDayName } from '../../utils/dateUtils';

/**
 * Días y horas de atención (7 días, uno por fila). Misma grilla que
 * "Horarios de atención" de Configuración; controlado: `dias` + `onChange`.
 * Lo usan el horario propio de una sucursal (Sucursales) y el administrador
 * de sucursal (Mi sucursal).
 */
export default function HorarioAtencion({ dias, onChange }) {
  const cambiar = (idx, cambios) => onChange(dias.map((d, i) => (i === idx ? { ...d, ...cambios } : d)));
  return (
    <div className="schedule-grid">
      {dias.map((d, idx) => (
        <div key={idx} className="schedule-row">
          <label style={{ textTransform: 'capitalize' }}>{getDayName(idx)}</label>
          <button
            type="button"
            className={`schedule-toggle ${d.isActive ? 'active' : ''}`}
            onClick={() => cambiar(idx, d.isActive
              ? { isActive: false }
              : { isActive: true, startTime: d.startTime || '09:00', endTime: d.endTime || '18:00' })}
          />
          {d.isActive ? (
            <>
              <input className="form-input" type="time" value={d.startTime || ''} onChange={(e) => cambiar(idx, { startTime: e.target.value })} />
              <input className="form-input" type="time" value={d.endTime || ''} onChange={(e) => cambiar(idx, { endTime: e.target.value })} />
            </>
          ) : (
            <>
              <span className="text-muted text-sm">—</span>
              <span className="text-muted text-sm">—</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
