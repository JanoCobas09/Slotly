// ============================================================================
// Capa de acceso a las Edge Functions
// ============================================================================
// Mismo criterio que repository.js con las tablas: ningún componente invoca
// una Edge Function directamente, todo pasa por acá. Así los nombres de las
// funciones y la forma de sus argumentos viven en un solo lugar.
//
// Por qué existen estas funciones del lado del servidor: los permisos son
// custom claims del JWT, y solo la service role key los puede escribir. Si
// el permiso saliera de una fila que el propio usuario puede editar, un
// dueño podría escalar privilegios. Ver supabase/functions/.

import { supabase } from './supabase';

/**
 * `supabase.functions.invoke` no separa "no desplegada" de otros errores de
 * red como sí lo hacía el SDK de Firebase (`functions/not-found` vs
 * `functions/internal`) — acá cualquier fallo de conexión al gateway de
 * Functions cae en un solo `FunctionsFetchError`. Se conserva igual la
 * forma del error (`.code`) para que quien llama pueda seguir
 * distinguiendo casos por código de negocio (los que sí vienen del body:
 * `permission-denied`, `already-exists`, etc.), que es lo que de verdad se
 * usa en el resto de la app.
 */
async function llamar(nombre, datos) {
  const { data, error } = await supabase.functions.invoke(nombre, { body: datos });
  if (error) {
    // FunctionsHttpError trae la respuesta real del Edge Function (con
    // { error: { code, message } }, el mismo formato que arma
    // _shared/auth.ts en cada función) — se prioriza sobre el mensaje
    // genérico de supabase-js.
    const cuerpo = await error.context?.json?.().catch(() => null);
    const traducido = new Error(cuerpo?.error?.message || error.message);
    traducido.code = cuerpo?.error?.code || 'internal';
    traducido.original = error;
    throw traducido;
  }
  return data;
}

/** ¿El error viene de que las Edge Functions todavía no están desplegadas? */
export function esFunctionNoDesplegada(err) {
  return err?.code === 'internal' && /fetch|network|not.?found/i.test(err?.original?.message || '');
}

/**
 * Le da a un mail acceso al panel de un negocio.
 *
 * Devuelve `{ status: 'applied' }` si la persona ya había entrado alguna vez,
 * o `{ status: 'pending' }` si nunca entró — en ese caso el permiso queda
 * anotado y se aplica solo en su primer login.
 *
 * Quién puede llamarla: la plataforma para cualquier negocio y cualquier rol;
 * el dueño de un negocio solo dentro del suyo y solo con rol 'admin'.
 */
export function setBusinessAdmin({ email, businessId, role, professionalId = null, name = '' }) {
  return llamar('set-business-admin', { email, businessId, role, professionalId, name });
}

/** Le quita todo acceso administrativo a un mail. */
export function revokeBusinessAdmin({ email, businessId }) {
  return llamar('revoke-business-admin', { email, businessId });
}

/**
 * Reserva un turno con validación del lado del servidor.
 *
 * El precio y la hora de fin NO se mandan: los calcula la función a partir
 * de la fila del servicio. Tampoco se manda el estado. Todo lo que el
 * cliente podía falsificar escribiendo directo a la base se decide del lado
 * del servidor: negocio suspendido, fecha pasada, profesional que no hace
 * ese servicio, horario fuera de agenda y solapamiento con otro turno.
 *
 * Devuelve { status: 'created', id, price, endTime }.
 */
export function createAppointment({ businessId, professionalId, serviceId, appointmentDate, startTime, clientName = '', clientPhone = '', clientEmail = '', notes = '' }) {
  return llamar('create-appointment', {
    businessId, professionalId, serviceId, appointmentDate, startTime,
    clientName, clientPhone, clientEmail, notes,
  });
}

/**
 * Horarios tomados de un profesional en un día, para pintar la grilla.
 * Devuelve solo { startTime, endTime } de cada turno activo: el cliente no
 * puede leer la agenda del negocio (tiene datos de otros clientes), pero sí
 * necesita saber qué está ocupado. Respuesta: { ocupados: [...] }.
 * No pide sesión: la grilla se mira antes de entrar.
 */
export function getBusySlots({ businessId, professionalId, appointmentDate }) {
  return llamar('get-busy-slots', { businessId, professionalId, appointmentDate });
}

/**
 * Ubicación real del link de Google Maps del negocio (sigue los links cortos
 * maps.app.goo.gl del lado del servidor). Devuelve `{ ubicacion: { lat, lng } }`
 * o `{ ubicacion: null }` si no hay link o no se pudo resolver. Sin sesión.
 */
export function resolveMapsLink({ businessId }) {
  return llamar('resolve-maps-link', { businessId });
}

/**
 * Crea la cuenta de un dueño con email y contraseña, y le asigna los permisos.
 * Para el barbero que no usa Gmail o no quiere mezclarlo con lo personal.
 *
 * Si se pasa `password`, se usa esa (mínimo 8 caracteres). Si no, la genera el
 * servidor.
 *
 * Devuelve `{ status: 'created', email, password }`. **La contraseña viene una
 * sola vez**: Supabase guarda solo su hash, así que si se pierde hay que
 * generar otra con `resetOwnerPassword`.
 */
export function createOwnerWithPassword({ email, businessId, name = '', role = 'owner', professionalId = null, password = null }) {
  return llamar('create-owner-with-password', { email, businessId, name, role, professionalId, password });
}

/** Genera una contraseña nueva para quien perdió la suya. Corta sus sesiones abiertas. */
export function resetOwnerPassword({ email, password = null }) {
  return llamar('reset-owner-password', { email, password });
}

/**
 * Nombra a alguien moderador de la plataforma (o le saca el rol con
 * `enabled: false`). Solo el dueño de la plataforma puede llamarla.
 *
 * Devuelve 'applied' si la cuenta ya existía, 'pending' si nunca entró (se
 * aplica en su primer login), 'revoked' o 'not-found' al quitar.
 */
export function setPlatformModerator({ email, enabled = true, name = '' }) {
  return llamar('set-platform-moderator', { email, enabled, name });
}

/**
 * Reclama el permiso que quedó pendiente para el mail de la sesión actual.
 * Se llama una vez después del login. Devuelve `{ status: 'none' }` si no había
 * nada pendiente, que es el caso normal y no es un error.
 */
export function applyPendingClaims() {
  return llamar('apply-pending-claims', {});
}

/**
 * Manda un push de prueba SOLO a los dispositivos que la cuenta que llama
 * registró para sí misma. Pendiente de Fase 5 (Web Push): hasta entonces
 * no hay Edge Function `enviar-push-de-prueba` desplegada, así que esto
 * devuelve el mismo error "no desplegada" que ya sabe mostrar el resto de
 * la app en vez de romper.
 */
export function enviarPushDePrueba() {
  return llamar('enviar-push-de-prueba', {});
}

/**
 * Alta self-service: la persona que llama se convierte en dueña de un
 * negocio nuevo, con ~48 hs de prueba gratis. A diferencia del alta manual
 * (super-admin/NewBusinessModal, que escribe directo a la tabla porque RLS
 * ya deja que solo la plataforma lo haga), esto SÍ tiene que pasar por una
 * Edge Function: quien crea el negocio se da el rol de dueño a sí mismo, y
 * los custom claims solo los puede escribir la service role key.
 *
 * No aplica los claims nuevos sola: quien llama tiene que refrescar la
 * sesión después (`refreshClaims()` de AuthContext) para que el panel vea
 * el negocio recién creado.
 */
export function createBusinessSelfService({ name, professionCategory = '', customProfession = '', primaryColor = null, planId }) {
  return llamar('create-business-self-service', { name, professionCategory, customProfession, primaryColor, planId });
}

/**
 * Borra un negocio entero: fila, todo lo que cuelga (cascada de SQL), y les
 * saca el acceso a sus usuarios. Solo el dueño de la plataforma. `confirmName`
 * tiene que ser el nombre exacto del negocio. Devuelve { status: 'deleted', usuarios }.
 */
export function deleteBusiness({ businessId, confirmName }) {
  return llamar('delete-business', { businessId, confirmName });
}

/**
 * Seña con Mercado Pago — conexión de la cuenta del negocio (solo el dueño).
 *
 * `conectarMercadoPago` devuelve `{ url }`: la página de Mercado Pago donde
 * el dueño autoriza a Slotly. Al terminar, MP lo devuelve a
 * /admin/configuracion?mp=conectado (o ?mp=error / ?mp=cancelado).
 * `desconectarMercadoPago` borra la conexión y apaga la seña.
 */
export function conectarMercadoPago({ businessId }) {
  return llamar('mp-conexion', { action: 'conectar', businessId });
}

export function desconectarMercadoPago({ businessId }) {
  return llamar('mp-conexion', { action: 'desconectar', businessId });
}

/**
 * Devuelve entera la seña pagada de un turno, desde la cuenta de MP del
 * negocio. Solo el dueño. Devuelve `{ status: 'devuelta' | 'ya-devuelta' }`.
 */
export function devolverSena({ appointmentId }) {
  return llamar('mp-refund', { appointmentId });
}

/**
 * Estado de la seña de un turno, sin sesión (la pantalla /:slug/pago puede
 * abrirse en otro navegador que el de la reserva al volver de Mercado Pago).
 * Devuelve `{ turno }` con los mismos nombres que un turno del contexto, o
 * `{ turno: null }` si ya no existe (se venció el plazo y se liberó).
 */
export function estadoSena({ appointmentId }) {
  return llamar('estado-sena', { appointmentId });
}
