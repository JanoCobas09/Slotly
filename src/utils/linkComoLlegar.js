/**
 * Link para "Cómo llegar" y el mapa de la página de reserva: SOLO el que
 * cargó el negocio. Sin link de Maps no se muestra nada de ubicación — ni
 * mapa ni botón —, en vez de adivinar el lugar buscando por el texto de la
 * dirección.
 */
export function linkComoLlegar(business) {
  return business?.mapsUrl?.trim() || null;
}
