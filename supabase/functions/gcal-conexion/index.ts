// ============================================================================
// gcal-conexion
// ============================================================================
// El botón "Conectar / Desconectar Google Calendar" de un profesional. Lo
// puede tocar el propio profesional (desde "Mi configuración") o el dueño
// del negocio para cualquiera de su equipo (desde Configuración).
//
//   { action: 'conectar', businessId, professionalId, volverA }
//       → { url } del permiso de Google. Google lo devuelve a
//         gcal-oauth-callback, que guarda la conexión. `volverA`:
//         'ajustes' (Mi configuración) o 'configuracion' (por defecto).
//   { action: 'preferencias', businessId, professionalId, bloquea }
//       → si las actividades de su Google BLOQUEAN turnos (true, por
//         defecto) o solo se muestran en el panel (false).
//   { action: 'desconectar', businessId, professionalId }
//       → borra de su calendario los eventos de los turnos que vienen, le
//         avisa a Google que Slotly deja el permiso y borra la conexión.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller, supabaseAdmin, errorResponse, jsonResponse,
  invalidArgument, permissionDenied, failedPrecondition, notFound, isPlatformOwner, type Caller,
} from '../_shared/auth.ts';
import { origenPermitido } from '../_shared/mercadopago.ts';
import { googleConfigurado, urlDeAutorizacion, revocar, borrarEvento, type Conexion } from '../_shared/google.ts';

function puedeConectar(caller: Caller, businessId: string, professionalId: string): boolean {
  if (isPlatformOwner(caller)) return true;
  if (caller.businessId !== businessId) return false;
  if (caller.role === 'owner') return true;
  return caller.role === 'admin' && caller.professionalId === professionalId;
}

/** Hoy en Argentina, 'YYYY-MM-DD'. */
function hoyArgentina(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const { action, businessId, professionalId, volverA, bloquea } = await req.json();
    if (!businessId || !professionalId) throw invalidArgument('Faltan datos.');
    if (!puedeConectar(caller, businessId, professionalId)) {
      throw permissionDenied('Solo el profesional o el dueño del negocio pueden conectar este calendario.');
    }

    const admin = supabaseAdmin();
    const { data: prof } = await admin.from('professionals').select('id')
      .eq('id', professionalId).eq('business_id', businessId).maybeSingle();
    if (!prof) throw notFound('No existe ese profesional en este negocio.');

    if (action === 'preferencias') {
      if (typeof bloquea !== 'boolean') throw invalidArgument('Falta elegir si bloquea.');
      const { data, error } = await admin.from('google_calendar_conexiones').update({ bloquea })
        .eq('professional_id', professionalId).eq('business_id', businessId).select('professional_id');
      if (error) throw error;
      if (!data?.length) throw notFound('Ese profesional no tiene Google Calendar conectado.');
      return jsonResponse({ status: 'ok', bloquea }, corsHeaders);
    }

    if (action === 'desconectar') {
      const { data: c } = await admin.from('google_calendar_conexiones').select('*')
        .eq('professional_id', professionalId).maybeSingle();
      if (c) {
        // Que no le queden en el calendario turnos que Slotly ya no va a
        // mantener al día. Los pasados quedan, como historial. Si la
        // conexión ya estaba rota no hay con qué borrarlos.
        if (!c.error) {
          const { data: turnos } = await admin.from('appointments').select('id')
            .eq('professional_id', professionalId)
            .gte('appointment_date', hoyArgentina())
            .limit(300);
          for (const t of turnos || []) {
            try { await borrarEvento(admin, c as Conexion, t.id); } catch (err) {
              console.error('[gcal-conexion] No se pudo borrar un evento al desconectar:', err);
              break;
            }
          }
        }
        await revocar(c.refresh_token);
        await admin.from('google_calendar_conexiones').delete().eq('professional_id', professionalId);
      }
      return jsonResponse({ status: 'desconectado' }, corsHeaders);
    }

    if (action !== 'conectar') throw invalidArgument('Acción desconocida.');
    if (!googleConfigurado()) {
      throw failedPrecondition('Google Calendar todavía no está configurado en la plataforma. Escribinos por soporte.');
    }

    // Estados viejos que nadie usó (abrió Google y cerró la pestaña).
    await admin.from('google_oauth_states').delete().lt('created_at', new Date(Date.now() - 3600 * 1000).toISOString());

    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const pantalla = volverA === 'ajustes' ? '/admin/ajustes' : '/admin/configuracion';
    const { error } = await admin.from('google_oauth_states').insert({
      state,
      business_id: businessId,
      professional_id: professionalId,
      user_id: caller.id,
      volver_a: `${origenPermitido(req)}${pantalla}`,
    });
    if (error) throw error;

    return jsonResponse({ url: urlDeAutorizacion(state) }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
