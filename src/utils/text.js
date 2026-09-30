/** Primera letra en mayúscula. `null`/`undefined`/'' pasan sin tocar. */
export function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * "reservado" o "reservada" según el sustantivo del rubro (turno, clase,
 * consulta, sesión...). El género sale del `confirmationMsg` del preset
 * ("Tu clase quedó confirmada."), así un rubro nuevo no necesita otro dato.
 * Si el mensaje no lo deja claro, masculino.
 */
export function reservadoPara(terminology) {
  return /confirmada\.?\s*$/i.test(terminology?.confirmationMsg || '') ? 'reservada' : 'reservado';
}
