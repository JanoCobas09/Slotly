// ============================================================================
// Horario semanal de un profesional: filas de `schedules` <-> días con franjas
// ============================================================================
// Estado que edita components/admin/HorarioSemanal.jsx:
// 7 días [{ dayOfWeek, isActive, franjas: [{ startTime, endTime }] }].
// En la base cada franja es una fila de `schedules`.

export const FRANJA_VACIA = { startTime: '', endTime: '' };

/** Filas de `schedules` de un profesional → los 7 días con sus franjas. */
export function diasDesdeSchedules(schedules) {
  return Array.from({ length: 7 }, (_, i) => {
    // Puede haber más de una fila el mismo día (horario cortado): se agrupan.
    const delDia = (schedules || []).filter((s) => s.dayOfWeek === i && s.isActive !== false && s.startTime && s.endTime);
    if (delDia.length === 0) return { dayOfWeek: i, isActive: false, franjas: [{ ...FRANJA_VACIA }] };
    // Una fila vieja con descanso interno (breakStart/breakEnd) se muestra
    // como dos franjas: es el mismo horario. Al guardar queda escrita así.
    const franjas = delDia
      .flatMap((s) => (s.breakStart && s.breakEnd
        ? [{ startTime: s.startTime, endTime: s.breakStart }, { startTime: s.breakEnd, endTime: s.endTime }]
        : [{ startTime: s.startTime, endTime: s.endTime }]))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    return { dayOfWeek: i, isActive: true, franjas };
  });
}

/** Los 7 días → filas para `schedules` (una por franja completa de cada día activo). */
export function schedulesDesdeDias(dias, professionalId) {
  return dias.flatMap((dia) => {
    if (!dia.isActive) return [];
    return dia.franjas
      .filter((f) => f.startTime && f.endTime)
      .map((f) => ({ dayOfWeek: dia.dayOfWeek, startTime: f.startTime, endTime: f.endTime, isActive: true, professionalId }));
  });
}
