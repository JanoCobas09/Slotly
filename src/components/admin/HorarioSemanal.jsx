import { getDayName } from '../../utils/dateUtils';
import Icon from '../Icon';
import { FRANJA_VACIA } from '../../utils/horarioSemanal';

// ============================================================================
// Horario semanal de un profesional, con varias franjas por día
// ============================================================================
// Lo usan las dos pantallas que editan horarios: Profesionales (el dueño) y
// "Mi configuración" (el propio profesional). Antes "Mi configuración" tenía
// su propio editor de una sola franja por día, y al guardar le borraba al
// profesional la segunda franja de un horario cortado (9 a 13 y 17 a 20)
// que el dueño le había cargado desde Profesionales.
//
// Forma del estado y conversión desde/hacia `schedules`: utils/horarioSemanal.js.

/**
 * Editor de la semana. Controlado: recibe `dias` y avisa cada cambio con
 * `onChange(nuevosDias)`. `diaCorto` muestra "lun" en vez de "lunes" (el
 * modal de Profesionales es angosto).
 */
export default function HorarioSemanal({ dias, onChange, diaCorto = false }) {
  const cambiarDia = (dayIndex, fn) => onChange(dias.map((d, i) => (i === dayIndex ? fn(d) : d)));

  const toggleDia = (dayIndex) => cambiarDia(dayIndex, (d) => ({ ...d, isActive: !d.isActive }));

  const editarFranja = (dayIndex, franjaIdx, campo, valor) => cambiarDia(dayIndex, (d) => ({
    ...d, franjas: d.franjas.map((f, j) => (j === franjaIdx ? { ...f, [campo]: valor } : f)),
  }));

  // Arranca donde termina la última franja cargada, para no pisarla: solo
  // hay que ajustar el fin.
  const agregarFranja = (dayIndex) => cambiarDia(dayIndex, (d) => {
    const ultima = d.franjas[d.franjas.length - 1];
    return { ...d, franjas: [...d.franjas, { startTime: ultima?.endTime || '', endTime: '' }] };
  });

  // Nunca queda un día activo sin ninguna fila: si se borra la última, queda
  // una vacía para completar (o se apaga el día con el toggle).
  const quitarFranja = (dayIndex, franjaIdx) => cambiarDia(dayIndex, (d) => {
    const franjas = d.franjas.filter((_, j) => j !== franjaIdx);
    return { ...d, franjas: franjas.length ? franjas : [{ ...FRANJA_VACIA }] };
  });

  const nombre = (i) => (diaCorto ? getDayName(i).substring(0, 3) : getDayName(i));

  return (
    <div className="schedule-grid">
      {dias.map((dia, dayIdx) => (
        <div key={dayIdx}>
          {dia.isActive ? (
            dia.franjas.map((franja, franjaIdx) => (
              <div key={franjaIdx} className="schedule-row">
                {franjaIdx === 0 ? (
                  <>
                    <label style={{ textTransform: 'capitalize' }}>{nombre(dayIdx)}</label>
                    <button type="button" className="schedule-toggle active" onClick={() => toggleDia(dayIdx)} />
                  </>
                ) : (
                  <><span /><span /></>
                )}
                <input
                  className="form-input" type="time" value={franja.startTime}
                  onChange={(e) => editarFranja(dayIdx, franjaIdx, 'startTime', e.target.value)}
                />
                <input
                  className="form-input" type="time" value={franja.endTime}
                  onChange={(e) => editarFranja(dayIdx, franjaIdx, 'endTime', e.target.value)}
                />
                {dia.franjas.length > 1 ? (
                  <button
                    type="button" className="schedule-franja-quitar" title="Quitar franja"
                    onClick={() => quitarFranja(dayIdx, franjaIdx)}
                  >
                    <Icon name="x" />
                  </button>
                ) : <span />}
              </div>
            ))
          ) : (
            <div className="schedule-row">
              <label style={{ textTransform: 'capitalize' }}>{nombre(dayIdx)}</label>
              <button type="button" className="schedule-toggle" onClick={() => toggleDia(dayIdx)} />
              <span className="text-muted text-sm">—</span>
              <span className="text-muted text-sm">—</span>
              <span />
            </div>
          )}
          {dia.isActive && (
            <button type="button" className="schedule-franja-agregar" onClick={() => agregarFranja(dayIdx)}>
              <Icon name="link" size="0.85em" /> Agregar franja
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
