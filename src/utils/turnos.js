/**
 * ¿El dueño puede editar este turno? Solo los que cargó el propio negocio
 * desde el panel ('manual') y que siguen vivos. Los que reservó el cliente
 * no: moverlos sin avisarle lo deja yendo a un horario que ya no es el suyo.
 */
export function esTurnoEditable(apt, isOwner) {
  return Boolean(isOwner) && apt?.type === 'manual' && (apt.status === 'pendiente' || apt.status === 'confirmada');
}
