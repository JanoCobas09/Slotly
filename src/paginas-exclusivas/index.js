// ============================================================================
// Perfil personalizado: la página de marca de un negocio
// ============================================================================
// Mismo modelo que BarberOS (`src/paginas-exclusivas/`, la de Neytan), con una
// diferencia a propósito: acá la página es SIEMPRE LA MISMA plantilla
// (`marca/PaginaMarca.jsx`, con la estructura de la de Neytan) y lo que cambia
// de un negocio a otro son sus datos. Así el formato es siempre parecido y no
// hay pedidos sueltos de diseño: cada negocio es una entrada en MARCAS.
//
// Lo que NO cambia es la reserva: la página reemplaza solamente lo que se ve
// en `/:slug`. El flujo de siempre pasa a `/:slug/reservar`, con el mismo
// motor, las mismas validaciones y los mismos colores del negocio. Los
// negocios sin entrada no notan nada: `/:slug` sigue siendo la reserva (y
// `/:slug/reservar` es un alias).
//
// Se indexa por `businessId` y no por slug: el slug lo puede cambiar el dueño
// desde Configuración, y un link nuevo no tiene que hacerle perder su página.
// La plantilla es un `lazy()`: los negocios sin página no la descargan.
//
// Todo lo demás sale de lo que el negocio ya tiene cargado en el panel:
// nombre, logo, color principal, servicios y precios, horario, WhatsApp,
// Instagram y link de Maps. Si sube un precio, la página cambia sola.
//
// Campos de cada entrada (todos opcionales salvo `frase`):
//   frase     eslogan corto, va en la portada y en la cinta ("Cortes que hablan")
//   ciudad    arriba a la izquierda y en la cinta ("Santa Teresita")
//   sobre     { titulo, parrafos: [hasta 3] } — "Sobre nosotros"
//   portada   foto de la MARCA (local, fachada, cartel) en `public/marcas/<slug>/`
//             — nunca galería de trabajos
//   estrella  id del servicio a destacar; sin esto, el más caro (con 3 o más)
//   tema      'oscuro' (por defecto) o 'claro'

export const MARCAS = {
  // '<businessId>': {
  //   frase: 'Cortes que hablan',
  //   ciudad: 'Santa Teresita',
  //   sobre: { titulo: 'Neytan', parrafos: ['…', '…'] },
  //   portada: '/marcas/neytan/portada.webp',
  //   estrella: null,
  //   tema: 'oscuro',
  // },
};

/** La configuración de marca del negocio, o null si no tiene página. */
export function marcaDe(businessId) {
  return (businessId && MARCAS[businessId]) || null;
}

/** ¿Este negocio tiene página de marca? */
export function paginaExclusiva(businessId) {
  return Boolean(marcaDe(businessId));
}

/**
 * Adónde lleva "reservar" para este negocio. Con página de marca, `/:slug`
 * es la página y la reserva vive en `/:slug/reservar`; sin ella, el link de
 * siempre.
 */
export function rutaDeReserva(slug, businessId) {
  return paginaExclusiva(businessId) ? `/${slug}/reservar` : `/${slug}`;
}
