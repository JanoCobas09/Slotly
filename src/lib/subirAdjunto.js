// ============================================================================
// Subida de un archivo a un turno, de punta a punta
// ============================================================================
// 1. Tipo real + optimización de fotos en el navegador (utils/archivos.js).
// 2. iniciar_adjunto(): la base valida permiso, tipo, tamaño y tope, y
//    reserva la fila 'pendiente' y la ruta.
// 3. URL firmada de subida y PUT directo a Storage con XHR (fetch no da
//    progreso de subida). El archivo nunca pasa por un servidor nuestro.
// 4. confirmar-adjunto: el servidor revisa el contenido real y lo deja listo.
// Si algo falla o se cancela después del paso 2, se borra lo reservado; si
// ni eso se puede (sin conexión), lo limpia limpiar-adjuntos a las 24 h.
import { iniciarAdjunto, urlDeSubida } from './repository';
import { confirmarAdjunto, eliminarAdjunto } from './functions';
import { detectarTipo, esImagen, prepararImagen, formatearTamano } from '../utils/archivos';

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export class SubidaCancelada extends Error {
  constructor() {
    super('Subida cancelada.');
    this.name = 'SubidaCancelada';
  }
}

function putConProgreso(url, blob, { onProgreso, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new SubidaCancelada()); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', blob.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    if (ANON_KEY) xhr.setRequestHeader('apikey', ANON_KEY);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.status === 413
        ? 'El archivo es demasiado grande.'
        : 'No se pudo subir el archivo. Revisá la conexión y probá de nuevo.'));
    };
    xhr.onerror = () => reject(new Error('Se cortó la conexión mientras se subía el archivo.'));
    xhr.onabort = () => reject(new SubidaCancelada());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/**
 * Sube `file` al turno. `limites`: lo que devuelve getLimitesAdjuntos().
 * `onEtapa(texto)` y `onProgreso(0..1)` para la pantalla; `signal` para
 * cancelar. Devuelve el id del adjunto ya confirmado.
 */
export async function subirAdjunto(appointmentId, file, { limites, onEtapa, onProgreso, signal } = {}) {
  const mimeReal = await detectarTipo(file);
  const categoria = limites?.imagen?.mimes?.includes(mimeReal) ? 'imagen'
    : limites?.documento?.mimes?.includes(mimeReal) ? 'documento' : null;
  if (!categoria) {
    throw new Error('Ese tipo de archivo no está permitido. Podés subir fotos (JPG, PNG, WebP, HEIC), PDF o Word.');
  }

  let preparado = { blob: file, mime: mimeReal, ancho: null, alto: null, miniatura: null };
  if (esImagen(mimeReal)) {
    onEtapa?.('Optimizando la foto…');
    preparado = await prepararImagen(file, mimeReal);
  }
  if (signal?.aborted) throw new SubidaCancelada();

  const maximo = limites[categoria].maxBytes;
  if (preparado.blob.size > maximo) {
    throw new Error(`El archivo pesa ${formatearTamano(preparado.blob.size)} y el máximo es ${formatearTamano(maximo)}.`);
  }

  onEtapa?.('Preparando…');
  const reserva = await iniciarAdjunto(appointmentId, {
    nombre: file.name,
    mime: preparado.mime,
    tamano: preparado.blob.size,
    conMiniatura: Boolean(preparado.miniatura),
    ancho: preparado.ancho,
    alto: preparado.alto,
  });

  try {
    if (reserva.rutaMiniatura && preparado.miniatura) {
      const urlMini = await urlDeSubida(reserva.rutaMiniatura);
      await putConProgreso(urlMini, preparado.miniatura, { signal });
    }
    onEtapa?.('Subiendo…');
    const url = await urlDeSubida(reserva.ruta);
    await putConProgreso(url, preparado.blob, { onProgreso, signal });

    onEtapa?.('Verificando…');
    await confirmarAdjunto({ adjuntoId: reserva.id });
    return reserva.id;
  } catch (err) {
    // Lo reservado no sirve: se borra para no dejar una fila a medias. Si
    // falla (sin conexión), la limpieza programada se encarga.
    eliminarAdjunto({ adjuntoId: reserva.id }).catch(() => {});
    throw err;
  }
}
