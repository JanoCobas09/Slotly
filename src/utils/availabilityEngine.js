// ============================================
// Motor de Disponibilidad
// ============================================
import { timeToMinutes, getLocalDayOfWeek, isToday } from './dateUtils';

/**
 * Calcula los slots disponibles para un profesional+servicio en una fecha.
 */
export function calculateAvailableSlots({
  professionalId,
  serviceId,
  date, // 'YYYY-MM-DD'
  schedules,
  appointments,
  services,
  professionalServices,
  slotInterval = 30,
  businessHours, // <-- Added parameter
}) {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = getLocalDayOfWeek(dateObj);

  // 1. Validar horario de la barbería para este día
  let businessStart = null;
  let businessEnd = null;
  if (businessHours) {
    const bizDay = businessHours.find((b) => b.dayOfWeek === dayOfWeek);
    if (!bizDay || !bizDay.isActive) {
      return []; // La barbería está cerrada este día
    }
    if (bizDay.startTime && bizDay.endTime) {
      businessStart = timeToMinutes(bizDay.startTime);
      businessEnd = timeToMinutes(bizDay.endTime);
    }
  }

  // 2. Horario del profesional para este día — puede ser más de una franja
  // (horario cortado: ej. 9 a 13 y de nuevo 17 a 21). Cada franja es
  // independiente; un profesional sin ninguna franja ese día no trabaja.
  const franjasDelDia = schedules.filter(
    (s) => s.professionalId === professionalId && s.dayOfWeek === dayOfWeek && s.isActive && s.startTime && s.endTime
  );

  if (franjasDelDia.length === 0) {
    return [];
  }

  // 3. Obtener la duración del servicio
  const ps = professionalServices.find(
    (ps) => ps.professionalId === professionalId && ps.serviceId === serviceId
  );
  const service = services.find((s) => s.id === serviceId);
  if (!service) return [];

  const duration = (ps && ps.customDuration) || service.durationMinutes;

  // 4. Generar los slots posibles de cada franja, clipeada contra el horario
  // comercial. Una franja vieja puede traer su propio breakStart/breakEnd
  // (dato de antes de que existiera el horario cortado): se sigue
  // respetando igual, no hace falta migrarla para que ande.
  const vistos = new Set(); // por si dos franjas se solapan, no duplicar el slot
  const allSlots = [];
  for (const franja of franjasDelDia) {
    let scheduleStart = timeToMinutes(franja.startTime);
    let scheduleEnd = timeToMinutes(franja.endTime);

    if (businessStart !== null && businessEnd !== null) {
      scheduleStart = Math.max(scheduleStart, businessStart);
      scheduleEnd = Math.min(scheduleEnd, businessEnd);
    }

    if (scheduleStart + duration > scheduleEnd) continue; // esta franja no alcanza, probar la próxima

    const breakStart = franja.breakStart ? timeToMinutes(franja.breakStart) : null;
    const breakEnd = franja.breakEnd ? timeToMinutes(franja.breakEnd) : null;

    for (let cursor = scheduleStart; cursor + duration <= scheduleEnd; cursor += slotInterval) {
      const slotEnd = cursor + duration;

      if (breakStart !== null && breakEnd !== null && cursor < breakEnd && slotEnd > breakStart) {
        continue; // se solapa con el descanso interno de esta franja
      }
      if (vistos.has(cursor)) continue;
      vistos.add(cursor);

      allSlots.push({
        startTime: minutesToTime(cursor),
        endTime: minutesToTime(slotEnd),
        startMinutes: cursor,
        endMinutes: slotEnd,
      });
    }
  }
  allSlots.sort((a, b) => a.startMinutes - b.startMinutes);

  // 5. Obtener citas existentes que bloquean
  const existingAppointments = appointments.filter(
    (a) =>
      a.professionalId === professionalId &&
      a.appointmentDate === date &&
      (a.status === 'pendiente' || a.status === 'confirmada')
  );

  // 6. Filtrar slots ocupados
  const availableSlots = allSlots.filter((slot) => {
    for (const apt of existingAppointments) {
      const aptStart = timeToMinutes(apt.startTime);
      const aptEnd = timeToMinutes(apt.endTime);
      if (slot.startMinutes < aptEnd && slot.endMinutes > aptStart) {
        return false; // Colisión
      }
    }
    return true;
  });

  // 7. Si es hoy, filtrar slots con menos de 10 minutos de antelación
  if (isToday(date)) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    // Se necesitan al menos 10 minutos de antelación para reservar
    return availableSlots.filter((slot) => slot.startMinutes >= nowMinutes + 10);
  }

  return availableSlots;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Verifica si un profesional trabaja en una fecha dada y si la barbería está abierta.
 */
export function professionalWorksOnDate(professionalId, date, schedules, businessHours) {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = getLocalDayOfWeek(dateObj);

  // Validar si la barbería está abierta este día
  if (businessHours) {
    const bizDay = businessHours.find((b) => b.dayOfWeek === dayOfWeek);
    if (!bizDay || !bizDay.isActive) {
      return false; // La barbería está cerrada
    }
  }

  return schedules.some(
    (s) => s.professionalId === professionalId && s.dayOfWeek === dayOfWeek && s.isActive
  );
}
