// ============================================================================
// Utilidades de color para el tema de cada negocio
// ============================================================================
// El dueño elige su color principal desde Configuración con un selector libre:
// puede ser un azul oscuro o un amarillo patito. Lo que se pinta encima de ese
// color (texto de la cabecera de reserva, hover, fondo suave de una tarjeta
// elegida) no se puede fijar de antemano — se deriva de acá.

function hexToRgb(hex) {
  const limpio = String(hex || '').trim().replace(/^#/, '');
  const largo = limpio.length === 3 ? limpio.split('').map((c) => c + c).join('') : limpio;
  if (!/^[0-9a-f]{6}$/i.test(largo)) return null;
  return [0, 2, 4].map((i) => parseInt(largo.slice(i, i + 2), 16));
}

function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Mezcla `hex` con `otro` en proporción `peso` (0 = hex intacto, 1 = otro). */
export function mixColor(hex, otro, peso) {
  const a = hexToRgb(hex);
  const b = hexToRgb(otro);
  if (!a || !b) return hex;
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * peso));
}

/**
 * ¿El texto encima de este color tiene que ser oscuro? Luminancia relativa
 * WCAG: por encima de ~0.45 el blanco deja de leerse bien (amarillos, verdes
 * claros, celestes).
 */
export function necesitaTextoOscuro(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}
