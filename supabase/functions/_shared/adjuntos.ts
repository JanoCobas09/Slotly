// ============================================================================
// Archivos de los turnos: lo común a confirmar/eliminar/limpiar
// ============================================================================
// El contenido vive en el bucket privado `turno-adjuntos`; la base solo
// guarda metadatos (tabla turno_adjuntos). Ver PLAN-CLIENTES.md y
// 20261023000000_clientes.sql.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const BUCKET_ADJUNTOS = 'turno-adjuntos';

// Lo justo para reconocer el tipo: nunca se baja el archivo entero.
const BYTES_CABECERA = 1024;

const empiezaCon = (b: Uint8Array, firma: number[], desde = 0) =>
  firma.every((v, i) => b[desde + i] === v);
const texto = (b: Uint8Array, desde: number, largo: number) =>
  String.fromCharCode(...b.slice(desde, desde + largo));

/**
 * Tipo REAL del archivo según su firma (magic bytes), sin mirar la
 * extensión ni el Content-Type que mandó el navegador. null = desconocido.
 */
export function detectarTipo(b: Uint8Array): string | null {
  if (empiezaCon(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empiezaCon(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (texto(b, 0, 4) === 'RIFF' && texto(b, 8, 4) === 'WEBP') return 'image/webp';
  if (texto(b, 4, 4) === 'ftyp') {
    const marca = texto(b, 8, 4);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(marca)) return 'image/heic';
    if (['mif1', 'msf1'].includes(marca)) return 'image/heif';
  }
  // El estándar permite basura antes de %PDF- dentro del primer KB.
  if (texto(b, 0, Math.min(b.length, BYTES_CABECERA)).includes('%PDF-')) return 'application/pdf';
  if (empiezaCon(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword';
  // DOCX es un ZIP (Office Open XML). Más no se puede saber sin descomprimir.
  if (empiezaCon(b, [0x50, 0x4b, 0x03, 0x04])) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}

/** ¿El tipo detectado corresponde al declarado? HEIC y HEIF son la misma familia. */
export function tipoCoincide(declarado: string, detectado: string | null): boolean {
  if (!detectado) return false;
  if (declarado === detectado) return true;
  const familiaHeif = ['image/heic', 'image/heif'];
  return familiaHeif.includes(declarado) && familiaHeif.includes(detectado);
}

/**
 * Lee la cabecera del objeto y su tamaño real con una petición Range sobre
 * una URL firmada de pocos segundos: la función nunca carga el archivo en
 * memoria. null si el objeto no existe.
 */
export async function leerCabecera(
  admin: SupabaseClient,
  ruta: string,
): Promise<{ bytes: Uint8Array; tamano: number } | null> {
  const { data, error } = await admin.storage.from(BUCKET_ADJUNTOS).createSignedUrl(ruta, 30);
  if (error || !data?.signedUrl) return null;

  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${BYTES_CABECERA - 1}` } });
  if (res.status === 404 || res.status === 400) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Storage respondió ${res.status} al leer el archivo`);
  }

  // 206 → "bytes 0-1023/123456". Si el servidor ignoró el Range (200), el
  // tamaño sale del Content-Length y se corta la lectura en el primer KB.
  const rango = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
  const tamano = Number(rango?.[1] ?? res.headers.get('content-length') ?? 0);

  const lector = res.body!.getReader();
  const partes: Uint8Array[] = [];
  let leidos = 0;
  while (leidos < BYTES_CABECERA) {
    const { done, value } = await lector.read();
    if (done || !value) break;
    partes.push(value);
    leidos += value.length;
  }
  await lector.cancel().catch(() => {});

  const bytes = new Uint8Array(Math.min(leidos, BYTES_CABECERA));
  let pos = 0;
  for (const p of partes) {
    const trozo = p.slice(0, bytes.length - pos);
    bytes.set(trozo, pos);
    pos += trozo.length;
    if (pos >= bytes.length) break;
  }
  return { bytes, tamano };
}

/** Borra los objetos de un adjunto (original y miniatura). Ignora los que ya no estaban. */
export async function borrarObjetos(admin: SupabaseClient, rutas: (string | null | undefined)[]) {
  const validas = rutas.filter((r): r is string => Boolean(r));
  if (validas.length === 0) return;
  const { error } = await admin.storage.from(BUCKET_ADJUNTOS).remove(validas);
  if (error && !/not.?found/i.test(error.message || '')) throw error;
}
