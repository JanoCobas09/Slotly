// CORS para que el browser pueda invocar las funciones desde otro origen que
// la API de Supabase (el front corre en localhost:5173 / el dominio de
// Vercel, la API en :55321 local o en supabase.co en producción).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
