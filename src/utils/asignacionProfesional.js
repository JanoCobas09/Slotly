// ============================================================================
// "Cualquier profesional" y asignación automática
// ============================================================================
// businesses.modo_profesional decide quién elige al profesional en la reserva:
//   'elige'              → el cliente lo elige (lo de siempre)
//   'elige_o_cualquiera' → el cliente lo elige, o toca "Cualquier profesional"
//   'automatico'         → el cliente solo elige el servicio; el paso del
//                          profesional no se muestra
// En los dos últimos, la grilla junta los horarios de TODOS los que hacen el
// servicio y, al elegir un horario, queda asignado el que tiene menos turnos
// ese día entre los que están libres. El cliente lo ve en el resumen antes de
// confirmar. Todo se resuelve acá: el servidor recibe un profesional concreto
// y lo valida igual que siempre.
//
// Puro: recibe arrays, no sabe de dónde salen (igual que availabilityEngine,
// que se usa tal cual por cada profesional).

export const CUALQUIERA = 'cualquiera';

export const MODOS_PROFESIONAL = ['elige', 'elige_o_cualquiera', 'automatico'];

/** El modo del negocio, con 'elige' para los que no lo configuraron. */
export function modoProfesional(business) {
  return MODOS_PROFESIONAL.includes(business?.modoProfesional) ? business.modoProfesional : 'elige';
}

/** Profesionales activos que hacen ese servicio (en la lista que se pase). */
export function candidatosDelServicio(professionals, professionalServices, serviceId) {
  return professionals.filter((p) => p.isActive
    && professionalServices.some((ps) => ps.professionalId === p.id && ps.serviceId === serviceId));
}

/**
 * Desempate estable entre profesionales con la misma cantidad de turnos: un
 * hash chico de (fecha, hora, profesional). Al azar de verdad, la asignación
 * cambiaría cada vez que se recalcula la grilla; así reparte parejo entre
 * horarios sin moverse mientras el cliente mira.
 */
function desempate(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) | 0;
  return h;
}

/**
 * Junta las grillas de varios profesionales en una sola.
 *
 * `porProfesional`: [{ professionalId, slots, turnosDelDia }], con `slots` tal
 * como los devuelve calculateAvailableSlots para ESE profesional y
 * `turnosDelDia` la cantidad de turnos que ya tiene esa fecha.
 *
 * Devuelve los horarios en los que al menos uno está libre, ordenados, cada
 * uno con el profesional asignado (`professionalId`, `endTime` según SU
 * duración) y en `alternativas` los demás libres en ese horario, en orden de
 * preferencia (por si al confirmar el asignado ya se ocupó).
 */
export function juntarGrillas(porProfesional, fecha) {
  const porHora = new Map();
  for (const { professionalId, slots, turnosDelDia } of porProfesional) {
    for (const slot of slots) {
      if (!porHora.has(slot.startTime)) porHora.set(slot.startTime, []);
      porHora.get(slot.startTime).push({ professionalId, endTime: slot.endTime, turnosDelDia, startMinutes: slot.startMinutes });
    }
  }
  return [...porHora.entries()]
    .map(([startTime, libres]) => {
      const orden = [...libres].sort((a, b) =>
        a.turnosDelDia - b.turnosDelDia
        || desempate(`${fecha}|${startTime}|${a.professionalId}`) - desempate(`${fecha}|${startTime}|${b.professionalId}`));
      const [elegido, ...resto] = orden;
      return {
        startTime,
        endTime: elegido.endTime,
        startMinutes: elegido.startMinutes,
        professionalId: elegido.professionalId,
        alternativas: resto.map((r) => ({ professionalId: r.professionalId, endTime: r.endTime })),
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

/**
 * El error del servidor dice que ESE profesional ya no está libre en ese
 * horario (otro lo tomó mientras el cliente confirmaba): vale probar con el
 * siguiente libre. "Ya tenés un turno ese día" no: es del cliente, no del horario.
 */
export function esHorarioTomado(err) {
  return err?.code === 'already-exists'
    && /horario ya fue tomado|ya tiene un turno en ese horario/i.test(err.message || '');
}
