// ============================================================================
// create-appointment
// ============================================================================
// Traducción de exports.createAppointment en functions/index.js. Toda la
// validación de negocio (precio, duración, horario, solapamiento, topes por
// cliente) vive en la función de Postgres `create_appointment` — ver
// supabase/migrations/20260924000000_create_appointment.sql —, corrida
// atómicamente con un advisory lock, equivalente a la transacción de
// Firestore original. Esta Edge Function solo valida la sesión y traduce
// el resultado.
import { corsHeaders } from '../_shared/cors.ts';
import {
  getCaller,
  supabaseAdmin,
  errorResponse,
  jsonResponse,
  errorDeFuncionSql,
} from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const caller = await getCaller(req);
    const {
      businessId, professionalId, serviceId, appointmentDate, startTime,
      clientName = '', clientPhone = '', clientEmail = '', notes = '',
    } = await req.json();

    const admin = supabaseAdmin();
    // clientEmail sale del token, nunca del cuerpo de la llamada — mismo
    // motivo que en Firebase: que no se registre un turno con el mail de otro.
    const { data, error } = await admin.rpc('create_appointment', {
      p_business_id: businessId,
      p_professional_id: professionalId,
      p_service_id: serviceId,
      p_appointment_date: appointmentDate,
      p_start_time: startTime,
      p_client_name: clientName,
      p_client_phone: clientPhone,
      p_client_email: caller.email || clientEmail || '',
      p_notes: notes,
      p_user_id: caller.id,
    });

    if (error) throw errorDeFuncionSql(error);

    return jsonResponse(
      { status: 'created', id: data.id, price: data.price, endTime: data.end_time },
      corsHeaders,
    );
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
