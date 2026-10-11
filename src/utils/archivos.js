// ============================================================================
// Archivos de los turnos, del lado del navegador
// ============================================================================
// Antes de subir: se reconoce el tipo REAL por la firma del archivo (no por
// la extensión ni por lo que diga el sistema operativo), y las fotos se
// achican y se les arma una miniatura acá, en el celular o la compu de
// quien sube: el servidor nunca procesa imágenes ni tiene el archivo en
// memoria. El servidor vuelve a validar el tipo (confirmar-adjunto).

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Fotos: lado mayor de la versión que se guarda y de la miniatura.
const LADO_MAXIMO = 2048;
const LADO_MINIATURA = 320;

const texto = (b, desde, largo) => String.fromCharCode(...b.slice(desde, desde + largo));
const empiezaCon = (b, firma, desde = 0) => firma.every((v, i) => b[desde + i] === v);

/** Tipo real según los primeros bytes. null si no es un tipo permitido. */
export async function detectarTipo(file) {
  const b = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (empiezaCon(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empiezaCon(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (texto(b, 0, 4) === 'RIFF' && texto(b, 8, 4) === 'WEBP') return 'image/webp';
  if (texto(b, 4, 4) === 'ftyp') {
    const marca = texto(b, 8, 4);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(marca)) return 'image/heic';
    if (['mif1', 'msf1'].includes(marca)) return 'image/heif';
  }
  if (texto(b, 0, b.length).includes('%PDF-')) return 'application/pdf';
  if (empiezaCon(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword';
  if (empiezaCon(b, [0x50, 0x4b, 0x03, 0x04])) return MIME_DOCX;
  return null;
}

export const esImagen = (mime) => String(mime || '').startsWith('image/');

/** 1536 → "1,5 KB". */
export function formatearTamano(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} KB`;
  return `${(n / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
}

/** Etiqueta corta para el ícono de un documento. */
export function etiquetaTipo(mime) {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'application/msword' || mime === MIME_DOCX) return 'Word';
  if (esImagen(mime)) return 'Foto';
  return 'Archivo';
}

async function decodificar(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* algunos navegadores no aceptan la opción: se prueba sin ella */ }
    try {
      return await createImageBitmap(file);
    } catch { /* formato que el navegador no sabe leer (ej. HEIC fuera de Safari) */ }
  }
  return null;
}

function aBlob(canvas, tipo, calidad) {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

/** Dibuja la imagen achicada y la codifica en WebP; si el navegador no sabe, en JPEG. */
async function codificar(imagen, ladoMaximo, calidad) {
  const escala = Math.min(1, ladoMaximo / Math.max(imagen.width, imagen.height));
  const ancho = Math.max(1, Math.round(imagen.width * escala));
  const alto = Math.max(1, Math.round(imagen.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(imagen, 0, 0, ancho, alto);
  let blob = await aBlob(canvas, 'image/webp', calidad);
  if (!blob || blob.type !== 'image/webp') {
    // JPEG no tiene transparencia: fondo blanco en vez de negro.
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    blob = await aBlob(canvas, 'image/jpeg', calidad);
  }
  return { blob, ancho, alto };
}

/**
 * Prepara una foto para subir: versión optimizada (lado mayor 2048 px) y
 * miniatura (320 px). Se guarda la optimizada, no el original pesado: una
 * foto de celular de 4–8 MB queda en ~300–700 KB sin perder lo que importa
 * para documentar una atención. Si la optimizada pesara más que el original
 * (foto ya chica), se sube el original. Si el navegador no puede leer el
 * formato (HEIC fuera de Safari), se sube tal cual y sin miniatura.
 */
export async function prepararImagen(file, mime) {
  const imagen = await decodificar(file);
  if (!imagen) return { blob: file, mime, ancho: null, alto: null, miniatura: null };

  try {
    const optimizada = await codificar(imagen, LADO_MAXIMO, 0.82);
    const miniatura = await codificar(imagen, LADO_MINIATURA, 0.7);
    const usarOriginal = !optimizada.blob
      || (optimizada.blob.size >= file.size && Math.max(imagen.width, imagen.height) <= LADO_MAXIMO
        && ['image/jpeg', 'image/png', 'image/webp'].includes(mime));
    return {
      blob: usarOriginal ? file : optimizada.blob,
      mime: usarOriginal ? mime : optimizada.blob.type,
      ancho: usarOriginal ? imagen.width : optimizada.ancho,
      alto: usarOriginal ? imagen.height : optimizada.alto,
      miniatura: miniatura.blob || null,
    };
  } finally {
    imagen.close?.();
  }
}
