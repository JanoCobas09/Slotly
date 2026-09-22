// ============================================
// Motor de Promociones
// ============================================
// Encuentra si hay una promo activa para un servicio+día+horario puntual, y
// calcula el precio resultante. Se usa del lado del cliente para MOSTRAR el
// precio con descuento antes de confirmar — quien de verdad decide el precio
// que se cobra es createAppointment (functions/index.js), que repite este
// mismo cálculo del lado del servidor. Nunca se confía en un precio
// calculado en el browser para lo que se cobra de verdad.
import { timeToMinutes } from './dateUtils';

/**
 * ¿Esta promo aplica a este servicio, en este día de la semana, a esta hora?
 * `startTime` es el inicio del turno — alcanza con que el turno EMPIECE
 * dentro de la ventana de la promo, no que quepa entero.
 */
export function promoAplica(promo, { serviceId, dayOfWeek, startTime }) {
  if (!promo || promo.isActive === false) return false;
  if (promo.serviceId !== serviceId) return false;
  if (promo.dayOfWeek !== dayOfWeek) return false;
  const inicio = timeToMinutes(startTime);
  return inicio >= timeToMinutes(promo.startTime) && inicio < timeToMinutes(promo.endTime);
}

/** La promo activa que aplica acá, o null. Si hay más de una, la primera que matchea. */
export function promoParaSlot(promotions, args) {
  return promotions.find((p) => promoAplica(p, args)) || null;
}

/** Precio final aplicando la promo (redondeado al peso). Sin promo, el precio base tal cual. */
export function precioConPromo(precioBase, promo) {
  if (!promo) return precioBase;
  if (promo.discountType === 'fixed') return promo.discountValue;
  if (promo.discountType === 'percentage') {
    return Math.round(precioBase * (1 - promo.discountValue / 100));
  }
  return precioBase;
}
