// ============================================================================
// Días bloqueados — reglas compartidas (panel del dueño, reserva, modal)
// ============================================================================
// Un bloqueo (fila de blocked_days) es el día entero si no tiene horario, o
// solo un rango ('HH:MM'–'HH:MM') si lo tiene. Un día puede tener varios.
// Mismas reglas que el trigger enforce_blocked_days de la base.

/** ¿Es un bloqueo de día entero? */
export const esDiaEntero = (b) => !b.startTime;

/** ¿Ese día está bloqueado entero? */
export function diaEnteroBloqueado(blockedDays, fecha) {
  return blockedDays.some((b) => b.date === fecha && esDiaEntero(b));
}

/** Rangos horarios bloqueados de ese día (sin los de día entero), ordenados. */
export function rangosDelDia(blockedDays, fecha) {
  return blockedDays
    .filter((b) => b.date === fecha && !esDiaEntero(b))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** ¿Un turno (startTime/endTime) cae en algo bloqueado ese día? */
export function turnoBloqueado(blockedDays, fecha, startTime, endTime) {
  if (diaEnteroBloqueado(blockedDays, fecha)) return true;
  const fin = endTime || startTime;
  return rangosDelDia(blockedDays, fecha).some((r) => startTime < r.endTime && fin > r.startTime);
}

/**
 * Los rangos bloqueados del día con la forma de un turno ocupado, para
 * sumarlos a lo que recibe calculateAvailableSlots: así el motor de
 * disponibilidad los saca de la grilla sin saber que existen los bloqueos.
 */
export function rangosComoOcupados(blockedDays, fecha, professionalId) {
  return rangosDelDia(blockedDays, fecha).map((r) => ({
    professionalId,
    appointmentDate: fecha,
    startTime: r.startTime,
    endTime: r.endTime,
    status: 'confirmada',
  }));
}
