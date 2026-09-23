// ============================================================================
// get-busy-slots
// ============================================================================
// Traducción de exports.getBusySlots en functions/index.js. Devuelve solo
// {startTime, endTime} de los turnos activos de un profesional en un día —
// ni un campo más. Existe porque RLS cierra `appointments` a quien no sea
// dueño/staff/el propio cliente del turno (correcto: tiene datos de otros),
// así que la grilla pública necesita esta puerta aparte para saber qué está
// libre sin exponer nombre/teléfono de nadie.
//
// Sin exigir sesión, a propósito: la grilla se mira antes de loguearse (el
// login se pide recién al confirmar), y la respuesta no tiene PII.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, invalidArgument } from '../_shared/auth.ts';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { businessId, professionalId, appointmentDate } = await req.json();
    if (!businessId || !professionalId || !appointmentDate) {
      throw invalidArgument('Faltan datos.');
    }
    if (!FORMATO_FECHA.test(appointmentDate)) {
      throw invalidArgument('Fecha con formato inválido.');
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from('appointments')
      .select('start_time, end_time, status')
      .eq('business_id', businessId)
      .eq('professional_id', professionalId)
      .eq('appointment_date', appointmentDate)
      .in('status', ['pendiente', 'confirmada']);

    if (error) throw error;

    const ocupados = (data || []).map((a) => ({
      startTime: a.start_time,
      endTime: a.end_time || a.start_time,
    }));

    return jsonResponse({ ocupados }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
