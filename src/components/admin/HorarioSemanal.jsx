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

// Las horas se eligen de una lista de 15 en 15 minutos (no un campo libre):
// así las que se pisan con otra franja se ven en gris y no se pueden elegir.
const HORAS = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);

/**
 * Lo que la franja `j` de un día no puede pisar: las otras franjas de ese
 * mismo día en el editor (de cualquier sucursal) y las `ocupadas` de afuera
 * (las que el profesional tiene en otra sucursal y este editor no muestra).
 */
function tomadosPara(dia, j, ocupadasDelDia, nombreSucursal) {
  return [
    ...dia.franjas
      .filter((f, k) => k !== j && f.startTime && f.endTime && f.startTime < f.endTime)
      .map((f) => ({ startTime: f.startTime, endTime: f.endTime, etiqueta: nombreSucursal(f.branchId) })),
    ...ocupadasDelDia,
  ];
}

/** Lista de horas con las que se pisan apagadas y diciendo con qué. */
function SelectorHora({ valor, onChange, tipo, inicio, tomados, ...resto }) {
  const motivo = (t) => {
    if (tipo === 'fin' && inicio && t <= inicio) return '';
    const choca = tomados.find((o) => (tipo === 'inicio'
      ? o.startTime <= t && t < o.endTime
      // El fin choca si el rango [inicio, t) se mete en otra franja.
      : (inicio ? inicio < o.endTime && t > o.startTime : o.startTime < t && t <= o.endTime)));
    if (!choca) return null;
    return choca.etiqueta ? `ocupado en ${choca.etiqueta}` : 'ocupado';
  };
  const opciones = valor && !HORAS.includes(valor) ? [...HORAS, valor].sort() : HORAS;
  return (
    <select className="form-input" value={valor || ''} onChange={(e) => onChange(e.target.value)} {...resto}>
      <option value="">--:--</option>
      {opciones.map((t) => {
        const m = motivo(t);
        return (
          <option key={t} value={t} disabled={m !== null}>
            {m ? `${t} · ${m}` : t}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Editor de la semana. Controlado: recibe `dias` y avisa cada cambio con
 * `onChange(nuevosDias)`. `diaCorto` muestra "lun" en vez de "lunes" (el
 * modal de Profesionales es angosto).
 *
 * `sucursales`: con más de una, cada franja muestra en qué sucursal es. Una
 * franja nueva arranca en `sucursalPorDefecto` (o la de la franja anterior).
 *
 * `errorCampo` (opcional, useErrorDeCampo): marca en rojo la franja que no
 * deja guardar — campo `franja-<dayOfWeek>-<índice>`, como validarFranjas.
 *
 * `ocupadas` (opcional): franjas del profesional que este editor no toca
 * ([{ dayOfWeek, startTime, endTime, etiqueta }], ej. las de otra sucursal
 * para el administrador de una). Se muestran en gris en su día y sus horas
 * no se pueden elegir. La base igual rechaza dos franjas que se pisen.
 */
export default function HorarioSemanal({ dias, onChange, diaCorto = false, sucursales = [], sucursalPorDefecto = null, errorCampo, ocupadas = [] }) {
  const conSucursal = sucursales.length > 1;
  const nombreSucursal = (id) => (conSucursal ? sucursales.find((b) => b.id === id)?.name || '' : '');
  const ocupadasDe = (dayOfWeek) => ocupadas.filter((o) => o.dayOfWeek === dayOfWeek && o.startTime && o.endTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const cambiarDia = (dayIndex, fn) => onChange(dias.map((d, i) => (i === dayIndex ? fn(d) : d)));

  const toggleDia = (dayIndex) => cambiarDia(dayIndex, (d) => ({ ...d, isActive: !d.isActive }));

  const editarFranja = (dayIndex, franjaIdx, campo, valor) => cambiarDia(dayIndex, (d) => ({
    ...d, franjas: d.franjas.map((f, j) => (j === franjaIdx ? { ...f, [campo]: valor } : f)),
  }));

  // Arranca donde termina la última franja cargada, para no pisarla: solo
  // hay que ajustar el fin.
  const agregarFranja = (dayIndex) => cambiarDia(dayIndex, (d) => {
    const ultima = d.franjas[d.franjas.length - 1];
    return { ...d, franjas: [...d.franjas, { startTime: ultima?.endTime || '', endTime: '', branchId: ultima?.branchId || sucursalPorDefecto }] };
  });

  // Al prender un día, sus franjas vacías arrancan en la sucursal por defecto.
  const prenderDia = (dayIndex) => cambiarDia(dayIndex, (d) => ({
    ...d,
    isActive: !d.isActive,
    franjas: d.franjas.map((f) => (f.branchId ? f : { ...f, branchId: sucursalPorDefecto })),
  }));

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
                  // El hueco del toggle con su mismo ancho: si no, las franjas
                  // siguientes quedaban corridas respecto de la primera.
                  <><span /><span style={{ width: 44 }} /></>
                )}
                <SelectorHora
                  tipo="inicio" valor={franja.startTime} aria-label="Desde"
                  tomados={tomadosPara(dia, franjaIdx, ocupadasDe(dia.dayOfWeek ?? dayIdx), nombreSucursal)}
                  {...errorCampo?.campo(`franja-${dia.dayOfWeek ?? dayIdx}-${franjaIdx}`)}
                  onChange={(v) => editarFranja(dayIdx, franjaIdx, 'startTime', v)}
                />
                <SelectorHora
                  tipo="fin" valor={franja.endTime} inicio={franja.startTime} aria-label="Hasta"
                  tomados={tomadosPara(dia, franjaIdx, ocupadasDe(dia.dayOfWeek ?? dayIdx), nombreSucursal)}
                  {...errorCampo?.campo(`franja-${dia.dayOfWeek ?? dayIdx}-${franjaIdx}`)}
                  onChange={(v) => editarFranja(dayIdx, franjaIdx, 'endTime', v)}
                />
                {dia.franjas.length > 1 ? (
                  <button
                    type="button" className="schedule-franja-quitar" title="Quitar franja"
                    onClick={() => quitarFranja(dayIdx, franjaIdx)}
                  >
                    <Icon name="x" />
                  </button>
                ) : <span />}
                {conSucursal && (
                  <select
                    className="form-input schedule-franja-sucursal"
                    aria-label="Sucursal"
                    value={franja.branchId || sucursalPorDefecto || ''}
                    onChange={(e) => editarFranja(dayIdx, franjaIdx, 'branchId', e.target.value)}
                  >
                    {sucursales.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
              </div>
            ))
          ) : (
            <div className="schedule-row">
              <label style={{ textTransform: 'capitalize' }}>{nombre(dayIdx)}</label>
              <button type="button" className="schedule-toggle" onClick={() => prenderDia(dayIdx)} />
              <span className="text-muted text-sm">—</span>
              <span className="text-muted text-sm">—</span>
              <span />
            </div>
          )}
          {/* Lo que ya tiene en otra sucursal ese día: en gris, sin tocar. */}
          {ocupadasDe(dia.dayOfWeek ?? dayIdx).map((o, k) => (
            <div key={`ocupada-${k}`} className="schedule-row schedule-row-ocupada" title="Ya tiene este horario en otra sucursal">
              <span className="text-xs">{o.etiqueta ? `En ${o.etiqueta}` : 'Ocupado'}</span>
              <span style={{ width: 44 }} />
              <span className="schedule-ocupada-hora">{o.startTime}</span>
              <span className="schedule-ocupada-hora">{o.endTime}</span>
              <span />
            </div>
          ))}
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
