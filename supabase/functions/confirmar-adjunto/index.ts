// ============================================================================
// confirmar-adjunto
// ============================================================================
// Último paso de la subida de un archivo a un turno (ver PLAN-CLIENTES.md):
//   1. iniciar_adjunto() reservó la fila 'pendiente' y la ruta.
//   2. El navegador subió el archivo DIRECTO a Storage con una URL firmada.
//   3. Acá se valida, con la sesión de quien subió, que la fila es suya y
//      que sigue teniendo acceso al turno; se lee solo la cabecera del
//      objeto para comprobar el tipo REAL (no la extensión ni lo que dijo el
//      navegador) y el tamaño real; y recién ahí queda 'listo'.
// Si el contenido no corresponde, se borran objeto y fila: no quedan
// registros a medias. Si el objeto todavía no está (subida cortada), la
// fila queda pendiente y la limpia limpiar-adjuntos.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller, supabaseAdmin, errorResponse, jsonResponse,
  invalidArgument, notFound, failedPrecondition, permissionDenied,
} from '../_shared/auth.ts';
import { BUCKET_ADJUNTOS, borrarObjetos, detectarTipo, leerCabecera, tipoCoincide } from '../_shared/adjuntos.ts';

const ETIQUETAS: Record<string, string> = {
  'image/jpeg': 'una foto JPG', 'image/png': 'una imagen PNG', 'image/webp': 'una imagen WebP',
  'image/heic': 'una foto HEIC', 'image/heif': 'una foto HEIF', 'application/pdf': 'un PDF',
  'application/msword': 'un documento de Word (.doc)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'un documento de Word (.docx)',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { adjuntoId } = await req.json().catch(() => ({}));
    if (typeof adjuntoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(adjuntoId)) {
      throw invalidArgument('Falta el archivo a confirmar.');
    }

    // Con la sesión de quien llama: la RLS decide si puede ver la fila.
    const comoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: fila, error } = await comoUsuario
      .from('turno_adjuntos')
      .select('id, appointment_id, subido_por, estado, categoria, mime, ruta_objeto, ruta_miniatura')
      .eq('id', adjuntoId)
      .maybeSingle();
    if (error) throw error;
    if (!fila) throw notFound('No encontramos ese archivo.');
    if (fila.subido_por !== caller.id) throw permissionDenied('Ese archivo lo está subiendo otra persona.');
    if (fila.estado === 'listo') return jsonResponse({ status: 'listo', id: fila.id }, corsHeaders);

    const { data: puede } = await comoUsuario.rpc('turno_documentable', { p_appointment_id: fila.appointment_id });
    if (!puede) throw permissionDenied('Ya no tenés acceso a ese turno.');

    const admin = supabaseAdmin();
    const descartar = async (mensaje: string) => {
      await borrarObjetos(admin, [fila.ruta_objeto, fila.ruta_miniatura]);
      await admin.from('turno_adjuntos').delete().eq('id', fila.id);
      throw invalidArgument(mensaje);
    };

    const original = await leerCabecera(admin, fila.ruta_objeto);
    if (!original) throw failedPrecondition('El archivo todavía no terminó de subirse. Probá de nuevo.');

    const detectado = detectarTipo(original.bytes);
    if (!tipoCoincide(fila.mime, detectado)) {
      await descartar(`El contenido del archivo no es ${ETIQUETAS[fila.mime] || 'del tipo que dice ser'}. No se guardó.`);
    }

    const { data: limites } = await admin.rpc('adjuntos_limites');
    const maximo = Number(limites?.[fila.categoria]?.maxBytes || 0);
    if (!original.tamano || (maximo && original.tamano > maximo)) {
      await descartar(`El archivo supera el máximo de ${Math.round(maximo / 1048576)} MB. No se guardó.`);
    }

    // La miniatura es opcional: si falta o no es una imagen, el archivo se
    // guarda igual y la pantalla muestra un ícono.
    let rutaMiniatura = fila.ruta_miniatura;
    if (rutaMiniatura) {
      const mini = await leerCabecera(admin, rutaMiniatura);
      const tipoMini = mini && detectarTipo(mini.bytes);
      if (!tipoMini || !tipoMini.startsWith('image/') || mini!.tamano > 1048576) {
        await borrarObjetos(admin, [rutaMiniatura]);
        rutaMiniatura = null;
      }
    }

    const { error: errUpd } = await admin
      .from('turno_adjuntos')
      .update({
        estado: 'listo',
        tamano_bytes: original.tamano,
        ruta_miniatura: rutaMiniatura,
        confirmado_at: new Date().toISOString(),
      })
      .eq('id', fila.id)
      .eq('estado', 'pendiente');
    if (errUpd) throw errUpd;

    return jsonResponse({ status: 'listo', id: fila.id, bucket: BUCKET_ADJUNTOS }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
