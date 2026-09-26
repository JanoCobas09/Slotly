// ============================================================================
// Sucursales: qué horario, datos y precio rigen en cada una
// ============================================================================
// Una sucursal hereda del negocio todo lo que no define: horario de
// atención, dirección, teléfono y link de Maps. Un servicio vale lo que dice
// el servicio salvo que la sucursal tenga precio propio. Un profesional
// trabaja en una sucursal si tiene alguna franja de horario ahí.
//
// Mismo criterio que la base (create_appointment en
// 20261009000000_sucursales.sql): si cambia allá, cambia acá.
import { calculateAvailableSlots, professionalWorksOnDate } from './availabilityEngine';

/** Activas, la principal primero y el resto por nombre. */
export function sucursalesActivas(branches) {
  return (branches || [])
    .filter((b) => b.isActive !== false)
    .sort((a, b) => (a.isMain === b.isMain ? a.name.localeCompare(b.name) : a.isMain ? -1 : 1));
}

export const hayVariasSucursales = (branches) => sucursalesActivas(branches).length > 1;

export const sucursalPrincipal = (branches) => (branches || []).find((b) => b.isMain) || (branches || [])[0] || null;

export const nombreSucursal = (branches, id) => (branches || []).find((b) => b.id === id)?.name || '';

/** Horario de atención que rige en la sucursal (el propio o el general). `undefined` = sin límite. */
export function horarioDe(branch, business) {
  return branch?.businessHours || business?.businessHours || undefined;
}

/** Dirección, teléfono y link de Maps que se muestran para la sucursal. */
export function datosDe(branch, business) {
  return {
    address: branch?.address || business?.address || '',
    phone: branch?.phone || business?.phone || '',
    mapsUrl: branch?.mapsUrl || business?.mapsUrl || '',
  };
}

/** Precio de un servicio en una sucursal. */
export function precioEn(service, branchId, prices) {
  const propio = (prices || []).find((p) => p.branchId === branchId && p.serviceId === service?.id);
  return propio ? Number(propio.price) : service?.price;
}

export const schedulesDeSucursal = (schedules, branchId) => (schedules || []).filter((s) => s.branchId === branchId);

/** Profesionales con al menos una franja activa en la sucursal. */
export function profesionalesDeSucursal(professionals, schedules, branchId) {
  return (professionals || []).filter((p) =>
    (schedules || []).some((s) => s.professionalId === p.id && s.branchId === branchId && s.isActive !== false));
}

/** Sucursales donde trabaja un profesional. */
export function sucursalesDeProfesional(branches, schedules, professionalId) {
  const ids = new Set((schedules || []).filter((s) => s.professionalId === professionalId && s.isActive !== false).map((s) => s.branchId));
  return sucursalesActivas(branches).filter((b) => ids.has(b.id));
}

/**
 * Horarios libres de un profesional un día, sucursal por sucursal: cada
 * franja se recorta con el horario de SU sucursal. Cada horario sale con su
 * `branchId`. `soloSucursal` limita a una (la reserva del cliente, o el
 * administrador de una sucursal). availabilityEngine no se toca: se le pasan
 * los horarios ya filtrados por sucursal.
 */
export function horariosLibresPorSucursal({ branches, business, schedules, soloSucursal = null, ...resto }) {
  const lista = soloSucursal
    ? sucursalesActivas(branches).filter((b) => b.id === soloSucursal)
    : sucursalesActivas(branches);
  const todos = lista.flatMap((b) =>
    calculateAvailableSlots({
      ...resto,
      schedules: schedulesDeSucursal(schedules, b.id),
      businessHours: horarioDe(b, business),
    }).map((slot) => ({ ...slot, branchId: b.id })));
  const vistos = new Set();
  return todos
    .filter((s) => (vistos.has(s.startTime) ? false : vistos.add(s.startTime)))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** ¿El profesional trabaja ese día en esa sucursal (con su horario)? */
export function trabajaEnSucursal(professionalId, date, schedules, branch, business) {
  return professionalWorksOnDate(professionalId, date, schedulesDeSucursal(schedules, branch?.id), horarioDe(branch, business));
}

/** Lunes a sábado de 9 a 20, domingo cerrado: el punto de partida de un horario propio. */
export const HORARIO_INICIAL = Array.from({ length: 7 }, (_, i) => ({
  dayOfWeek: i,
  startTime: i < 6 ? '09:00' : '',
  endTime: i < 6 ? (i === 5 ? '18:00' : '20:00') : '',
  isActive: i < 6,
}));
