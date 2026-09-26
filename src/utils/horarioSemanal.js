// ============================================================================
// Horario semanal de un profesional: filas de `schedules` <-> días con franjas
// ============================================================================
// Estado que edita components/admin/HorarioSemanal.jsx:
// 7 días [{ dayOfWeek, isActive, franjas: [{ startTime, endTime, branchId }] }].
// En la base cada franja es una fila de `schedules`; `branchId` es la
// sucursal donde atiende en esa franja (sin sucursal = la principal, lo pone
// la base). Un profesional puede trabajar en varias sucursales.

export const FRANJA_VACIA = { startTime: '', endTime: '', branchId: null };

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
        ? [{ startTime: s.startTime, endTime: s.breakStart, branchId: s.branchId ?? null }, { startTime: s.breakEnd, endTime: s.endTime, branchId: s.branchId ?? null }]
        : [{ startTime: s.startTime, endTime: s.endTime, branchId: s.branchId ?? null }]))
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
      .map((f) => ({ dayOfWeek: dia.dayOfWeek, startTime: f.startTime, endTime: f.endTime, isActive: true, professionalId, branchId: f.branchId || null }));
  });
}
