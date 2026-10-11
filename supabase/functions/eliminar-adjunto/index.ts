// ============================================================================
// eliminar-adjunto
// ============================================================================
// Borra un archivo de un turno: el objeto de Storage y su fila, juntos. Los
// usuarios no tienen permiso de DELETE ni en el bucket ni en la tabla: el
// permiso se decide acá con adjunto_borrable() evaluado con la sesión de
// quien llama (quien lo subió, si sigue teniendo acceso al turno, o el
// dueño del negocio). Primero el objeto y después la fila: si el borrado
// del objeto falla, la fila queda y se puede reintentar; nunca queda una
// fila apuntando a un archivo que ya no existe por culpa de este orden.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getCaller, supabaseAdmin, errorResponse, jsonResponse, invalidArgument, permissionDenied } from '../_shared/auth.ts';
import { borrarObjetos } from '../_shared/adjuntos.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    await getCaller(req);
    const { adjuntoId } = await req.json().catch(() => ({}));
    if (typeof adjuntoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(adjuntoId)) {
      throw invalidArgument('Falta el archivo a borrar.');
    }

    const comoUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: puede, error } = await comoUsuario.rpc('adjunto_borrable', { p_adjunto_id: adjuntoId });
    if (error) throw error;
    if (!puede) throw permissionDenied('No podés borrar ese archivo.');

    const admin = supabaseAdmin();
    const { data: fila } = await admin
      .from('turno_adjuntos')
      .select('id, ruta_objeto, ruta_miniatura')
      .eq('id', adjuntoId)
      .maybeSingle();
    if (!fila) return jsonResponse({ status: 'borrado' }, corsHeaders);

    await borrarObjetos(admin, [fila.ruta_objeto, fila.ruta_miniatura]);
    const { error: errDel } = await admin.from('turno_adjuntos').delete().eq('id', fila.id);
    if (errDel) throw errDel;

    return jsonResponse({ status: 'borrado' }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
