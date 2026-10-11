// ============================================================================
// limpiar-adjuntos — mantenimiento diario del bucket `turno-adjuntos`
// ============================================================================
// Pensada para pg_cron una vez por día (ver el bloque comentado al final de
// PLAN-CLIENTES.md). Solo la llama el propio proyecto: mismo control que
// send-reminders (Bearer == SUPABASE_SERVICE_ROLE_KEY).
//
// Qué limpia, y qué NO:
//   - Filas 'pendiente' de más de 24 h (subidas abandonadas o que nunca se
//     confirmaron): borra sus objetos y la fila.
//   - Objetos sin fila de más de 24 h (adjuntos_huerfanos()).
//   - NUNCA toca filas 'listo': un error temporal de Storage no puede hacer
//     desaparecer un archivo válido. Si un objeto de una fila 'listo' falta,
//     solo se informa en la respuesta.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated } from '../_shared/auth.ts';
import { borrarObjetos } from '../_shared/adjuntos.ts';

const LOTE = 200;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) throw unauthenticated('Solo el propio proyecto.');

    const admin = supabaseAdmin();
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Pendientes vencidas.
    const { data: pendientes, error } = await admin
      .from('turno_adjuntos')
      .select('id, ruta_objeto, ruta_miniatura')
      .eq('estado', 'pendiente')
      .lt('created_at', limite)
      .limit(LOTE);
    if (error) throw error;

    let pendientesBorradas = 0;
    const errores: string[] = [];
    for (const fila of pendientes || []) {
      try {
        await borrarObjetos(admin, [fila.ruta_objeto, fila.ruta_miniatura]);
        const { error: errDel } = await admin.from('turno_adjuntos').delete().eq('id', fila.id).eq('estado', 'pendiente');
        if (errDel) throw errDel;
        pendientesBorradas++;
      } catch (e) {
        // Sin rutas ni URLs en el log: solo el id de la fila.
        errores.push(`pendiente ${fila.id}: ${(e as Error).message}`);
      }
    }

    // 2. Objetos sin fila.
    const { data: huerfanos, error: errHuer } = await admin.rpc('adjuntos_huerfanos', { p_limite: LOTE });
    if (errHuer) throw errHuer;
    const rutas = (huerfanos || []).map((h: { ruta: string }) => h.ruta);
    let huerfanosBorrados = 0;
    if (rutas.length > 0) {
      try {
        await borrarObjetos(admin, rutas);
        huerfanosBorrados = rutas.length;
      } catch (e) {
        errores.push(`huérfanos: ${(e as Error).message}`);
      }
    }

    return jsonResponse({ pendientesBorradas, huerfanosBorrados, errores }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
