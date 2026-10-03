// ============================================================================
// Avisos por WhatsApp al cliente (manuales, desde el panel)
// ============================================================================
// Confirmación ("Agendaste un turno...") y recordatorio ("Recordá que tenés
// un turno..."). El botón (components/admin/AvisoWhatsApp.jsx) abre WhatsApp
// con el mensaje ya escrito por un link wa.me y anota en el turno cuándo se
// tocó (20261017000000_avisos_whatsapp.sql). Todo cálculo, nada de red.

import { formatDate, formatPrice } from './dateUtils';
import { reservadoPara } from './text';

/** "un turno" / "una consulta": el género sale del preset, como en reservadoPara. */
export function conArticulo(terminology) {
  const articulo = reservadoPara(terminology) === 'reservada' ? 'una' : 'un';
  return `${articulo} ${terminology?.appointmentNoun || 'turno'}`;
}

/**
 * Teléfono cargado → número para wa.me (solo dígitos, con código de país).
 * La reserva pide el número argentino con código de área, con o sin +54,
 * 0 o 15 ("11 1234-5678", "0223 15 555-1234", "+54 9 11..."). WhatsApp lo
 * necesita como 549 + área + número, sin 0 ni 15. Lo que no parece argentino
 * (otro código de país) va tal cual. null si no hay con qué.
 */
export function telefonoWhatsApp(telefono) {
  let d = String(telefono || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length < 8) return null;

  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  } else if (d.length > 13 || (d.length > 10 && !d.startsWith('0') && !tiene15(d))) {
    return d; // otro país
  }
  if (d.startsWith('0')) d = d.slice(1);
  // Área (2 a 4 dígitos) + 15 + número = 12 dígitos: se saca el 15.
  if (d.length === 12) {
    const pos = [4, 3, 2].find((p) => d.slice(p, p + 2) === '15');
    if (pos !== undefined) d = d.slice(0, pos) + d.slice(pos + 2);
  }
  return d.length === 10 ? `549${d}` : d;
}

function tiene15(d) {
  return d.length === 12 && [4, 3, 2].some((p) => d.slice(p, p + 2) === '15');
}

const inicioDelTurno = (apt) => {
  const [y, mo, d] = apt.appointmentDate.split('-').map(Number);
  const [h, m] = apt.startTime.split(':').map(Number);
  return new Date(y, mo - 1, d, h, m, 0);
};

/**
 * Qué aviso corresponde ahora: 'recordatorio' desde las 00:00 del día
 * anterior hasta que el turno empieza; antes, 'confirmacion'. Si está
 * cancelado y todavía no pasó, 'cancelacion'. Después de la hora (o si
 * terminó de otra forma, o es un walk-in), ninguno.
 */
export function avisoQueCorresponde(apt, ahora = new Date()) {
  if (!apt || apt.type === 'walkin') return null;
  const inicio = inicioDelTurno(apt);
  if (ahora >= inicio) return null;
  if (apt.status === 'cancelada') return 'cancelacion';
  if (apt.status !== 'pendiente' && apt.status !== 'confirmada') return null;
  const desde = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() - 1);
  return ahora >= desde ? 'recordatorio' : 'confirmacion';
}

/** "hoy" / "mañana" / null, para el recordatorio. */
function cuando(apt, ahora) {
  const inicio = inicioDelTurno(apt);
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const diaTurno = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const dias = Math.round((diaTurno - hoy) / 86400000);
  return dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : null;
}

/**
 * El mensaje, con los datos del turno. `tipo`: 'confirmacion' |
 * 'recordatorio' | 'cancelacion'. Usa *negrita* de WhatsApp y nada de emojis
 * (algunos WhatsApp de escritorio los rompen al venir por el link).
 * `linkReserva`: el link público, para ofrecer otro horario al cancelar.
 */
export function mensajeAviso(tipo, { apt, business, terminology, profesional, servicio, direccion, sucursal, linkReserva, ahora = new Date() }) {
  const nombre = (apt.clientName || '').trim().split(/\s+/)[0];
  const saludo = nombre ? `¡Hola ${nombre}!` : '¡Hola!';
  const queTiene = conArticulo(terminology);
  const negocio = business?.name ? ` en *${business.name}*` : '';
  const femenino = queTiene.startsWith('una');

  if (tipo === 'cancelacion') {
    const tu = `tu ${terminology?.appointmentNoun || 'turno'}`;
    const cancelado = femenino ? 'cancelada' : 'cancelado';
    const loCancelo = apt.cancelledBy === 'client';
    const datosCancelado = [
      `*Día:* ${formatDate(apt.appointmentDate).split(',')[0].toLowerCase()}`,
      `*Hora:* ${apt.startTime} hs`,
      (apt.serviceName || servicio?.name) && `*Servicio:* ${apt.serviceName || servicio.name}`,
      profesional?.name && `*Con:* ${profesional.name}`,
      !loCancelo && apt.cancellationReason && `*Motivo:* ${apt.cancellationReason}`,
    ].filter(Boolean);
    return [
      loCancelo
        ? `${saludo} Te confirmamos que ${tu}${negocio} quedó ${cancelado}.`
        : `${saludo} Lamentamos avisarte que ${tu}${negocio} quedó ${cancelado}.`,
      '',
      ...datosCancelado,
      '',
      linkReserva
        ? `Si querés, podés reservar otro horario acá: ${linkReserva}`
        : 'Si querés, respondenos por acá y te buscamos otro horario.',
      loCancelo ? '¡Gracias por avisarnos!' : 'Disculpá las molestias.',
    ].join('\n');
  }

  const dia = cuando(apt, ahora);
  const primera = tipo === 'recordatorio'
    ? `${saludo} Recordá que tenés ${queTiene}${dia ? ` *${dia}*` : ''}${negocio}.`
    : `${saludo} Agendaste ${queTiene}${negocio}.`;

  const datos = [
    `*Día:* ${formatDate(apt.appointmentDate).split(',')[0].toLowerCase()}`,
    `*Hora:* ${apt.startTime} hs`,
    (apt.serviceName || servicio?.name) && `*Servicio:* ${apt.serviceName || servicio.name}`,
    profesional?.name && `*Con:* ${profesional.name}`,
    sucursal && `*Sucursal:* ${sucursal}`,
    direccion && `*Dirección:* ${direccion}`,
    Number(apt.price) > 0 && `*Precio:* ${formatPrice(Number(apt.price), business?.currency)}`,
  ].filter(Boolean);

  const lo = femenino ? 'la' : 'lo';
  const cierre = tipo === 'recordatorio'
    ? 'Si no vas a poder venir, avisanos por acá así liberamos el horario. ¡Te esperamos!'
    : `Si necesitás cambiar${lo} o cancelar${lo}, avisanos por acá. ¡Te esperamos!`;

  return [primera, '', ...datos, '', cierre].join('\n');
}

/** Link que abre WhatsApp con el mensaje escrito. null sin teléfono usable. */
export function linkAviso(telefono, mensaje) {
  const numero = telefonoWhatsApp(telefono);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}` : null;
}

/** Columna del turno donde queda la marca de cada aviso. */
export const CAMPO_AVISO = {
  confirmacion: 'whatsappConfirmacionAt',
  recordatorio: 'whatsappRecordatorioAt',
  cancelacion: 'whatsappCancelacionAt',
};

/** Textos del botón según el aviso y si ya se mandó. */
export function textoBoton(tipo, enviado) {
  if (tipo === 'cancelacion') return enviado ? 'Cancelación avisada' : 'Avisar cancelación';
  if (tipo === 'recordatorio') return enviado ? 'Recordatorio enviado' : 'Enviar recordatorio';
  return enviado ? 'Confirmación enviada' : 'Enviar confirmación';
}
