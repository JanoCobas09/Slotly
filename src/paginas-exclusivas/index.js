// ============================================================================
// Páginas exclusivas: perfil personalizado, hecho a mano para UN negocio
// ============================================================================
// Mismo modelo que BarberOS (`src/paginas-exclusivas/`, la de Neytan). No es
// una plantilla que elige cualquiera: es una página diseñada para un cliente
// puntual con su marca, y por eso vive fuera del resto de la reserva.
//
// Lo que NO cambia es la reserva: la página exclusiva reemplaza solamente lo
// que se ve en `/:slug`. El flujo de siempre pasa a `/:slug/reservar`, con el
// mismo motor, las mismas validaciones y los mismos colores del negocio. Los
// negocios sin página exclusiva no notan nada: `/:slug` sigue siendo la
// reserva (y `/:slug/reservar` es un alias).
//
// Se indexa por `businessId` y no por slug: el slug lo puede cambiar el dueño
// desde Configuración, y un link nuevo no tiene que hacerle perder su página.
//
// Cada página es un `lazy()`: el resto de los negocios no se baja ni un byte
// de su código, sus fuentes ni su CSS.
//
// Reglas para una página nueva (ver CLAUDE.md, "Perfil personalizado"):
// - Todo dato sale de lo que el negocio ya tiene cargado (servicios, precios,
//   horarios, WhatsApp, Instagram, Maps, colores). Nada escrito a mano que
//   haya que actualizar cuando sube un precio.
// - El botón de reservar se ve sin scrollear, en el celular más chico.
// - CSS propio con un prefijo de clase único, para no pisar el resto.
// - Fotos: solo de la marca (logo, portada). Nada de galería de trabajos.

// Para sumar una: `import { lazy } from 'react'` arriba y una línea acá.
export const PAGINAS = {
  // '<businessId>': lazy(() => import('./<negocio>/Pagina<Negocio>')),
};

/** ¿Este negocio tiene página exclusiva? */
export function paginaExclusiva(businessId) {
  return Boolean(businessId && PAGINAS[businessId]);
}

/**
 * Adónde lleva "reservar" para este negocio. Con página exclusiva, `/:slug`
 * es la página y la reserva vive en `/:slug/reservar`; sin ella, el link de
 * siempre.
 */
export function rutaDeReserva(slug, businessId) {
  return paginaExclusiva(businessId) ? `/${slug}/reservar` : `/${slug}`;
}
