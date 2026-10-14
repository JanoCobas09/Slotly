// ============================================================================
// sincronizar-google
// ============================================================================
// Deja el Google Calendar del profesional igual que Slotly. Lo encola el
// trigger appointments_sincronizar_google (cada turno nuevo, movido,
// cancelado o borrado de un profesional conectado) y, al conectar un
// calendario, google_sincronizar_profesional (todos sus turnos que vienen).
//
//   { appointmentId, profesionales: [ids] }  → ese turno, en el calendario de
//       cada profesional involucrado (si cambió de profesional, se saca del
//       calendario del anterior).
//   { professionalId, completo: true }       → todos sus turnos de hoy en adelante.
//
// No confía en el payload: relee el turno y deja el evento como corresponde
// AHORA (vivo → creado/actualizado; cancelado, esperando seña o borrado →
// borrado). Por eso un reintento o dos tareas del mismo turno en desorden
// terminan igual. Se marca listo cuando todo salió, o cuando la conexión ya
// no sirve (permiso revocado: queda el aviso en el panel); si no, el cron de
// la cola reintenta.
// Exige la service role key como Bearer, igual que send-push.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, unauthenticated, invalidArgument } from '../_shared/auth.ts';
import { marcarEnvio } from '../_shared/envios.ts';
import { conexionDe, guardarEvento, borrarEvento, ErrorGoogle, type Conexion, type TurnoParaEvento } from '../_shared/google.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const COLUMNAS = 'id, business_id, branch_id, professional_id, appointment_date, start_time, end_time, status, deposit_status, client_name, client_phone, service_name, notes';

type Turno = TurnoParaEvento & {
  business_id: string;
  branch_id: string | null;
  professional_id: string;
  status: string;
  deposit_status: string | null;
};

/** ¿Este turno tiene que estar en el calendario? Los que esperan la seña todavía no son un turno. */
const vivo = (t: Turno | null) =>
  Boolean(t && ['pendiente', 'confirmada'].includes(t.status) && t.deposit_status !== 'pendiente');

function hoyArgentina(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Nombre y dirección para el evento (la de la sucursal si tiene una propia). Con caché por negocio. */
async function lugarDe(admin: SupabaseClient, t: Turno, cache: Map<string, { name?: string; address?: string | null }>) {
  const clave = `${t.business_id}|${t.branch_id || ''}`;
  if (cache.has(clave)) return cache.get(clave)!;
  const { data: negocio } = await admin.from('businesses').select('name, address').eq('id', t.business_id).maybeSingle();
  let address = negocio?.address || null;
  if (t.branch_id) {
    const { data: sucursal } = await admin.from('branches').select('address').eq('id', t.branch_id).maybeSingle();
    if (sucursal?.address) address = sucursal.address;
  }
  const lugar = { name: negocio?.name, address };
  cache.set(clave, lugar);
  return lugar;
}

/** Deja un turno bien en el calendario de una conexión. */
async function reconciliar(admin: SupabaseClient, c: Conexion, appointmentId: string, turno: Turno | null, cache: Map<string, { name?: string; address?: string | null }>) {
  if (turno && turno.professional_id === c.professional_id && vivo(turno)) {
    await guardarEvento(admin, c, turno, await lugarDe(admin, turno, cache));
    // Si mientras se guardaba lo cancelaron (y esa otra tarea ya borró el
    // evento), el que se acaba de guardar quedaría colgado: se relee.
    const { data: ahora } = await admin.from('appointments').select(COLUMNAS).eq('id', appointmentId).maybeSingle();
    if (!(ahora && ahora.professional_id === c.professional_id && vivo(ahora as Turno))) {
      await borrarEvento(admin, c, appointmentId);
    }
  } else {
    await borrarEvento(admin, c, appointmentId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token || token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
      throw unauthenticated('Esto solo lo puede llamar el propio proyecto.');
    }

    const { appointmentId, profesionales = [], professionalId, completo = false, envioId = null } = await req.json();
    const admin = supabaseAdmin();
    const cache = new Map();
    let fallas = 0;

    // Error de Google en un turno: si la conexión quedó revocada no tiene
    // sentido reintentar (ya está marcada para el panel); si fue otra cosa
    // (Google caído, límite de uso), que la cola reintente.
    const anotar = (err: unknown) => {
      console.error('[sincronizar-google]', err);
      if (!(err instanceof ErrorGoogle && err.revocado)) fallas++;
      return err instanceof ErrorGoogle && err.revocado;
    };

    if (completo) {
      if (!professionalId) throw invalidArgument('Falta professionalId.');
      const c = await conexionDe(admin, professionalId);
      if (c) {
        const { data: turnos } = await admin.from('appointments').select(COLUMNAS)
          .eq('professional_id', professionalId)
          .gte('appointment_date', hoyArgentina())
          .in('status', ['pendiente', 'confirmada'])
          .order('appointment_date')
          .limit(500);
        for (const t of (turnos || []) as Turno[]) {
          try {
            await reconciliar(admin, c, t.id, t, cache);
          } catch (err) {
            if (anotar(err)) break;
          }
        }
      }
    } else {
      if (!appointmentId) throw invalidArgument('Falta appointmentId.');
      const { data } = await admin.from('appointments').select(COLUMNAS).eq('id', appointmentId).maybeSingle();
      const turno = (data as Turno) || null;
      const ids = new Set<string>([...profesionales, turno?.professional_id].filter(Boolean) as string[]);
      for (const id of ids) {
        const c = await conexionDe(admin, id);
        if (!c) continue;
        try {
          await reconciliar(admin, c, appointmentId, turno, cache);
        } catch (err) {
          anotar(err);
        }
      }
    }

    await marcarEnvio(admin, envioId, { listo: fallas === 0 });
    return jsonResponse({ status: fallas === 0 ? 'ok' : 'reintentar', fallas }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
