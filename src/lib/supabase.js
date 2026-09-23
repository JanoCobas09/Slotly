// ============================================
// Inicialización de Supabase
// ============================================
// Reemplaza a firebase.js. La anon key es PÚBLICA por diseño (viaja en el
// bundle) — lo que protege los datos son las políticas de RLS
// (supabase/migrations/..._rls.sql), no esta clave. La service role key
// (que sí es secreta, bypassa RLS) nunca va acá: vive solo en las Edge
// Functions (supabase/functions/_shared/auth.ts → supabaseAdmin()).
//
// A diferencia de Firebase, no hace falta una instancia separada por
// servicio (auth/db/functions/storage): un solo cliente expone
// `.auth`, `.from(tabla)`, `.storage`, `.functions.invoke()` y
// `.channel()` (Realtime).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Qué variables faltan. Mismo criterio que `faltanVariables` en firebase.js:
 * Vite congela las VITE_* en tiempo de compilación, así que si el build se
 * hizo sin ellas llegan vacías — mejor una pantalla que diga qué falta que
 * una pantalla en blanco.
 */
export const faltanVariables = [
  !SUPABASE_URL && 'VITE_SUPABASE_URL',
  !SUPABASE_ANON_KEY && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean);

export const supabaseListo = faltanVariables.length === 0;

if (!supabaseListo) {
  console.error(
    '[supabase] Falta configuración:', faltanVariables.join(', '),
    '\nEn local: archivo .env (ver .env.example).',
    '\nEn Vercel: Settings → Environment Variables, y volver a desplegar.'
  );
}

export const supabase = supabaseListo
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export default supabase;
