/**
 * ¿Lo reservó el propio cliente desde el link (y no lo cargó el negocio)?
 * Los viejos pueden no tener `type`: el default de la base es 'client'.
 */
export function esReservaDelCliente(apt) {
  return !apt?.type || apt.type === 'client';
}

/**
 * ¿El dueño puede editar este turno? Cualquiera que siga vivo, lo haya
 * cargado él o reservado el cliente. Los walk-in no: son un bloque de
 * horario sin servicio ni cliente, no hay nada que editar ahí.
 */
export function esTurnoEditable(apt, isOwner) {
  return Boolean(isOwner)
    && apt?.type !== 'walkin'
    && (apt?.status === 'pendiente' || apt?.status === 'confirmada');
}

/**
 * Texto del "¿seguro?" antes de cancelar. Si lo reservó el cliente, se le
 * recomienda al dueño hablar primero con él: el turno es un acuerdo con esa
 * persona, y enterarse de la cancelación al llegar es lo peor que le puede
 * pasar.
 */
export function confirmacionCancelar(apt) {
  if (!esReservaDelCliente(apt)) return '¿Cancelar este turno?';
  const quien = apt.clientName ? ` (${apt.clientName})` : '';
  // La seña no se devuelve sola al cancelar: si corresponde, el dueño la
  // devuelve desde Citas ("Devolver seña").
  const sena = apt.depositStatus === 'pagada'
    ? 'Tiene una seña pagada: cancelar no la devuelve. Si corresponde, devolvela desde Citas con "Devolver seña".\n\n'
    : '';
  return `Este turno lo reservó el cliente${quien}.\n\n`
    + 'Te recomendamos hablar con él antes de cancelarlo, así no se entera recién al llegar.\n\n'
    + sena
    + '¿Cancelarlo igual?';
}
