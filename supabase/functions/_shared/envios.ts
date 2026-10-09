// ============================================================================
// Cola de avisos (envios_pendientes) — lado de las Edge Functions
// ============================================================================
// Los triggers encolan cada aviso y lo mandan con `envioId` en el cuerpo
// (ver 20261022000000_cola_de_avisos.sql). La función que lo procesa tiene
// que marcarlo cuando terminó: si no lo marca, reintentar_envios() lo vuelve
// a mandar. Sin `envioId` (llamada a mano, tests viejos) todo esto no hace nada.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface Progreso {
  /** Claves de quienes ya recibieron el aviso (user_id, o `mail:<correo>`): un reintento no se los repite. */
  avisados?: string[];
}

export async function leerProgreso(admin: SupabaseClient, envioId?: string | null): Promise<Progreso> {
  if (!envioId) return {};
  const { data } = await admin.from('envios_pendientes').select('progreso').eq('id', envioId).maybeSingle();
  return (data?.progreso as Progreso) || {};
}

/**
 * `listo`: el aviso salió a todos (o no hay forma de que salga) → no se
 * reintenta. Si no, solo se guarda el progreso y el cron lo vuelve a mandar.
 */
export async function marcarEnvio(
  admin: SupabaseClient,
  envioId: string | null | undefined,
  { listo, progreso }: { listo: boolean; progreso?: Progreso },
) {
  if (!envioId) return;
  const cambios: Record<string, unknown> = {};
  if (progreso) cambios.progreso = progreso;
  if (listo) cambios.procesado_at = new Date().toISOString();
  if (Object.keys(cambios).length === 0) return;
  const { error } = await admin.from('envios_pendientes').update(cambios).eq('id', envioId);
  if (error) console.error(`[envios] No se pudo marcar el envío ${envioId}:`, error);
}
