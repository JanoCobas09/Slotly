// ============================================================================
// ocupado-google
// ============================================================================
// Para el PANEL: qué tiene ocupado en su Google Calendar cada profesional un
// día, solo inicio y fin (nunca de qué se trata). Lo usan la agenda del día
// (bloques "Ocupado en Google Calendar") y el modal de turno nuevo (si el
// profesional eligió que sus actividades bloqueen, esos horarios no se pueden
// elegir; si no, avisa y deja cargarlo).
//
//   { businessId, professionalIds: [ids], fecha: 'YYYY-MM-DD' }
//     → { ocupados: { [professionalId]: [{ startTime, endTime }] },
//         bloquea:  { [professionalId]: boolean } }   (su preferencia; ver
//         google_calendar_conexiones.bloquea — el panel no deja elegir esos
//         horarios si bloquea, y si no, avisa)
//
// Quién: el equipo del negocio (dueño, administrador de sucursal) y la
// plataforma; un profesional ('admin'), solo lo suyo. Los profesionales sin
// Google conectado vuelven con [] sin preguntarle nada a Google.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller, supabaseAdmin, errorResponse, jsonResponse, invalidArgument, permissionDenied, isPlatformOwner,
} from '../_shared/auth.ts';
import { ocupadoEnGoogleDeVarios } from '../_shared/google.ts';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { businessId, professionalIds, fecha } = await req.json();
    if (!businessId || !Array.isArray(professionalIds) || !fecha) throw invalidArgument('Faltan datos.');
    if (!FORMATO_FECHA.test(fecha)) throw invalidArgument('Fecha con formato inválido.');
    if (professionalIds.length > 50) throw invalidArgument('Demasiados profesionales.');

    const delNegocio = caller.businessId === businessId && ['owner', 'admin', 'manager'].includes(caller.role || '');
    if (!isPlatformOwner(caller) && !delNegocio) throw permissionDenied();
    let ids: string[] = professionalIds.filter((id: unknown) => typeof id === 'string');
    if (!isPlatformOwner(caller) && caller.role === 'admin') {
      ids = ids.filter((id) => id === caller.professionalId);
    }

    const admin = supabaseAdmin();
    // Solo los de ESTE negocio con Google conectado (y sin error).
    const { data: conectados } = ids.length
      ? await admin.from('google_calendar_conexiones').select('professional_id, bloquea')
        .eq('business_id', businessId).in('professional_id', ids).is('error', null)
      : { data: [] };
    const conGoogle = (conectados || []).map((c) => c.professional_id as string);
    const bloquea = Object.fromEntries((conectados || []).map((c) => [c.professional_id, c.bloquea !== false]));

    const ocupados = await ocupadoEnGoogleDeVarios(admin, conGoogle, fecha);
    for (const id of ids) if (!ocupados[id]) ocupados[id] = [];
    return jsonResponse({ ocupados, bloquea }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
