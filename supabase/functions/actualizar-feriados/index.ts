// ============================================================================
// actualizar-feriados
// ============================================================================
// Trae los feriados nacionales de Argentina del año en curso y del siguiente
// (inamovibles, trasladables y puentes) de api.argentinadatos.com y los deja
// en la tabla `feriados`. Después vuelve a aplicar los feriados de los
// negocios que los cierran (aplicar_feriados_todos), por si se sumó uno
// (un decreto, un puente nuevo).
//
// La llama el cron `actualizar-feriados` el 1° de cada mes
// (pedir_actualizacion_feriados, 20261027000000_turnos_fijos_y_feriados.sql).
// Exige la service role key como Bearer, igual que send-push. Si la API no
// contesta, no borra nada: quedan los que ya estaban.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated } from '../_shared/auth.ts';

const API = 'https://api.argentinadatos.com/v1/feriados';
const TIPOS = new Set(['inamovible', 'trasladable', 'puente']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto.');
    }

    const anio = new Date().getFullYear();
    const filas: { fecha: string; nombre: string; tipo: string | null }[] = [];
    const fallas: string[] = [];
    for (const a of [anio, anio + 1]) {
      try {
        const res = await fetch(`${API}/${a}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const lista = await res.json();
        for (const f of Array.isArray(lista) ? lista : []) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(f?.fecha) || !f?.nombre) continue;
          filas.push({ fecha: f.fecha, nombre: String(f.nombre).slice(0, 200), tipo: TIPOS.has(f.tipo) ? f.tipo : null });
        }
      } catch (err) {
        // El año siguiente puede no estar publicado todavía: no es un error.
        fallas.push(`${a}: ${err instanceof Error ? err.message : err}`);
      }
    }

    const admin = supabaseAdmin();
    if (filas.length) {
      const { error } = await admin.from('feriados').upsert(filas, { onConflict: 'fecha' });
      if (error) throw error;
    }
    const { data: negocios, error: errAplicar } = await admin.rpc('aplicar_feriados_todos');
    if (errAplicar) throw errAplicar;

    return jsonResponse({ feriados: filas.length, negociosQueCierran: negocios, fallas }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
