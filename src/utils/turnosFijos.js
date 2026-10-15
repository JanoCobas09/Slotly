// ============================================================================
// Turnos fijos: cómo se dicen en palabras (modal de turno nuevo, tarjeta)
// ============================================================================
// Mismas reglas que la base (fechas_turno_fijo): mensual = el mismo día de la
// semana, en la misma semana del mes que el primer turno; si el primero cae
// en la 5ta semana, "el último" de cada mes.

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
const ORDINAL = ['', '1er', '2do', '3er', '4to'];

const fecha = (iso) => new Date(`${iso}T12:00:00`);

/** Semana del mes del primer turno: 1..4, o 5 = "la última". */
export function semanaDelMes(iso) {
  return Math.min(5, Math.ceil(fecha(iso).getDate() / 7));
}

/** "el 2do miércoles" / "el último miércoles". */
function enElMes(iso) {
  const n = semanaDelMes(iso);
  const dia = DIAS[fecha(iso).getDay()];
  return n === 5 ? `el último ${dia}` : `el ${ORDINAL[n]} ${dia}`;
}

/** Opciones de "Repetir" para el día elegido. */
export function opcionesFrecuencia(iso) {
  const plural = iso ? DIAS_PLURAL[fecha(iso).getDay()] : 'mismos días';
  return [
    { value: 'semanal', label: `Todas las semanas (los ${plural})` },
    { value: 'quincenal', label: 'Cada 2 semanas' },
    { value: 'cada_3_semanas', label: 'Cada 3 semanas' },
    { value: 'mensual', label: iso ? `Una vez por mes (${enElMes(iso)} de cada mes)` : 'Una vez por mes' },
  ];
}

/** "todos los miércoles a las 18:00", "el 2do martes de cada mes a las 10:00"… */
export function describirTurnoFijo({ frecuencia, fechaInicio, hora }) {
  const plural = DIAS_PLURAL[fecha(fechaInicio).getDay()];
  const a = `a las ${hora}`;
  switch (frecuencia) {
    case 'semanal': return `todos los ${plural} ${a}`;
    case 'quincenal': return `cada 2 semanas, los ${plural} ${a}`;
    case 'cada_3_semanas': return `cada 3 semanas, los ${plural} ${a}`;
    case 'mensual': return `${enElMes(fechaInicio)} de cada mes ${a}`;
    default: return '';
  }
}

/** Fecha de fin para "durante N meses" desde el primer turno ('YYYY-MM-DD'). */
export function finEnMeses(iso, meses) {
  const d = fecha(iso);
  d.setMonth(d.getMonth() + Number(meses));
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "25/12" */
export const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
