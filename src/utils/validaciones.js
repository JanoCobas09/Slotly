// ============================================================================
// Validación de lo que cargan los usuarios, antes de mandarlo a la base
// ============================================================================
// Mismas reglas que los CHECK de supabase/migrations/20261007000000_
// validacion_de_datos.sql — la base es la barrera real (esto se saltea con
// la consola abierta); acá está para avisar ANTES de guardar, con un mensaje
// claro, y para no dejar a medio guardar los formularios que escriben en
// varios pasos (profesional: ficha + contacto + horarios + servicios).
// Si cambiás una regla allá, cambiala acá.
//
// Cada validar*() devuelve el primer problema como texto, o '' si está todo bien.

export const LIMITES = {
  nombre: 80,
  nombreCliente: 120,
  textoCorto: 60,
  especialidad: 80,
  direccion: 200,
  textoLargo: 500,
  motivo: 300,
  asunto: 120,
  mensaje: 4000,
  telefono: 25,
  email: 254,
  url: 2000,
  instagram: 31,
};

const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const vacio = (t) => !String(t ?? '').trim();
const largo = (t) => String(t ?? '').trim().length;

/** Vacío vale (los teléfonos son opcionales salvo donde se pide aparte). */
export function esTelefono(t) {
  if (vacio(t)) return true;
  const s = String(t).trim();
  const digitos = s.replace(/\D/g, '').length;
  return /^[0-9+()\s.-]{6,25}$/.test(s) && digitos >= 6 && digitos <= 15;
}

export function esEmail(t) {
  if (vacio(t)) return true;
  const s = String(t).trim();
  return s.length <= LIMITES.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/** Solo http(s): nada de javascript:, data:, etc. */
export function esUrl(t) {
  if (vacio(t)) return true;
  const s = String(t).trim();
  return s.length <= LIMITES.url && /^https?:\/\/[^\s<>"]+$/i.test(s);
}

export function esInstagram(t) {
  return /^@?[A-Za-z0-9._]{0,30}$/.test(String(t ?? '').trim());
}

export const esHora = (t) => HORA.test(String(t ?? ''));

// ── Negocio (Configuración / alta) ─────────────────────────────────────────
export function validarNegocio(f) {
  if (largo(f.name) < 2 || largo(f.name) > LIMITES.nombre) return `El nombre del negocio tiene que tener entre 2 y ${LIMITES.nombre} caracteres.`;
  if (largo(f.welcomeMessage) > LIMITES.textoLargo) return `El mensaje de bienvenida puede tener hasta ${LIMITES.textoLargo} caracteres.`;
  if (!esTelefono(f.phone)) return 'El teléfono no es válido: usá solo números, con código de área.';
  if (!esEmail(f.email)) return 'El email del negocio no es válido.';
  if (largo(f.address) > LIMITES.direccion) return `La dirección puede tener hasta ${LIMITES.direccion} caracteres.`;
  if (!esUrl(f.mapsUrl)) return 'El link de Google Maps tiene que empezar con https://';
  if (!esInstagram(f.socialLinks?.instagram)) return 'El usuario de Instagram solo puede tener letras, números, puntos y guiones bajos (hasta 30).';
  if (!esTelefono(f.socialLinks?.whatsapp)) return 'El WhatsApp no es válido: usá solo números, con código de área.';
  for (const c of ['primaryColor', 'secondaryColor', 'accentColor']) {
    if (f[c] && !COLOR.test(f[c])) return 'Los colores tienen que tener el formato #RRGGBB.';
  }
  if (largo(f.customProfession) > LIMITES.textoCorto) return `El rubro puede tener hasta ${LIMITES.textoCorto} caracteres.`;
  const errHorario = validarHorarioNegocio(f.businessHours);
  if (errHorario) return errHorario;
  return '';
}

export function validarHorarioNegocio(dias) {
  for (const d of dias || []) {
    if (!d.isActive) continue;
    if (!esHora(d.startTime) || !esHora(d.endTime)) return 'Cada día abierto necesita hora de apertura y de cierre.';
    if (d.startTime >= d.endTime) return 'En los horarios de atención, el cierre tiene que ser después de la apertura.';
  }
  return '';
}

// ── Servicio ───────────────────────────────────────────────────────────────
export function validarServicio(f) {
  if (largo(f.name) < 2 || largo(f.name) > LIMITES.nombre) return `El nombre del servicio tiene que tener entre 2 y ${LIMITES.nombre} caracteres.`;
  if (largo(f.description) > LIMITES.textoLargo) return `La descripción puede tener hasta ${LIMITES.textoLargo} caracteres.`;
  if (largo(f.category) > LIMITES.textoCorto) return `La categoría puede tener hasta ${LIMITES.textoCorto} caracteres.`;
  const dur = Number(f.durationMinutes);
  if (!Number.isInteger(dur) || dur < 5 || dur > 720) return 'La duración tiene que ser de entre 5 y 720 minutos.';
  const precio = Number(f.price);
  if (!Number.isFinite(precio) || precio < 0) return 'El precio no puede ser negativo.';
  if (precio > 100000000) return 'El precio es demasiado alto.';
  return '';
}

// ── Profesional (ficha + contacto personal) ────────────────────────────────
export function validarProfesional(f) {
  if (largo(f.name) < 2 || largo(f.name) > LIMITES.nombre) return `El nombre tiene que tener entre 2 y ${LIMITES.nombre} caracteres.`;
  if (largo(f.specialty) > LIMITES.especialidad) return `La especialidad puede tener hasta ${LIMITES.especialidad} caracteres.`;
  if (largo(f.bio) > LIMITES.textoLargo) return `La descripción puede tener hasta ${LIMITES.textoLargo} caracteres.`;
  if (!esTelefono(f.phone)) return 'El teléfono no es válido: usá solo números, con código de área.';
  if (!esEmail(f.email)) return 'El email no es válido.';
  return '';
}

/**
 * Franjas de un mismo día ([{ startTime, endTime }]): cada una con el fin
 * después del inicio, y sin pisarse entre ellas. `dia` es para el mensaje.
 */
export function validarFranjas(franjas, dia = '') {
  const llenas = (franjas || []).filter((f) => f.startTime || f.endTime);
  const en = dia ? ` del ${dia}` : '';
  for (const f of llenas) {
    if (!esHora(f.startTime) || !esHora(f.endTime)) return `Completá inicio y fin de cada franja${en}.`;
    if (f.startTime >= f.endTime) return `En el horario${en}, el fin tiene que ser después del inicio.`;
  }
  const orden = [...llenas].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (let i = 1; i < orden.length; i++) {
    if (orden[i].startTime < orden[i - 1].endTime) return `Las franjas${en} se pisan entre sí.`;
  }
  return '';
}

// ── Equipo ─────────────────────────────────────────────────────────────────
export function validarEmailObligatorio(email) {
  if (vacio(email)) return 'El email es obligatorio.';
  if (!esEmail(email)) return 'Ingresá un email válido (ej: nombre@gmail.com).';
  return '';
}

/**
 * Deja solo el usuario de Instagram aunque peguen el link entero
 * ("https://www.instagram.com/mi.negocio/?hl=es" → "mi.negocio"). El link
 * público se arma después como instagram.com/<usuario>.
 */
export function normalizarInstagram(t) {
  const s = String(t ?? '').trim();
  const deLink = /instagram\.com\/([^/?#\s]+)/i.exec(s)?.[1];
  return (deLink || s).replace(/^@/, '');
}
