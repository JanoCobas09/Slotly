// ============================================================================
// Abrir y bajar archivos de los turnos (URLs firmadas de 60 s)
// ============================================================================
// Lo comparten la documentación de cada turno y la vista "Archivos" de la
// ficha del cliente: así ver y descargar funciona igual en los dos lados.
import { urlDeAdjunto } from './repository';
import { esImagen } from '../utils/archivos';

/** ¿Se puede mostrar en el visor de la app? (HEIC no lo leen los navegadores, salvo Safari). */
export const seVeEnVisor = (a) => esImagen(a.mime) && a.mime !== 'image/heic' && a.mime !== 'image/heif';

/** URL firmada del original, para el visor de fotos. */
export function urlParaVisor(a) {
  return urlDeAdjunto(a.rutaObjeto);
}

/**
 * Abre un documento en otra pestaña. La pestaña se abre en el mismo toque
 * (si no, el navegador la bloquea) y después se le pone la URL firmada.
 */
export async function abrirEnPestana(a) {
  const pestana = window.open('', '_blank');
  try {
    const url = await urlDeAdjunto(a.rutaObjeto);
    if (pestana) { pestana.opener = null; pestana.location.href = url; } else window.location.assign(url);
  } catch (e) {
    pestana?.close();
    throw e;
  }
}

/** Baja el archivo con su nombre original. */
export async function descargarAdjunto(a) {
  const url = await urlDeAdjunto(a.rutaObjeto, { nombre: a.nombreOriginal });
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
