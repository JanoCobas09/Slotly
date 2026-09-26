// ============================================================================
// Primeros pasos del dueño: qué le falta configurar para poder tomar turnos
// ============================================================================
// Cada paso se da por hecho mirando los datos reales del negocio (no un
// "tildé que lo hice"): si el dueño borra su único servicio, el paso vuelve a
// quedar pendiente. El orden es el que pide el sistema: sin un servicio no se
// puede dar de alta un profesional (el alta pide qué servicios hace), y sin
// profesional con servicio y horario el link de reserva no ofrece nada.

const CLAVE_OCULTA = (id) => `slotly:guia-oculta:${id}`;
const CLAVE_LINK = (id) => `slotly:link-compartido:${id}`;

function leer(clave) {
  try { return localStorage.getItem(clave) === '1'; } catch { return false; }
}
function guardar(clave) {
  try { localStorage.setItem(clave, '1'); } catch { /* sin storage: vuelve a aparecer, no rompe nada */ }
}

export const guiaOculta = (businessId) => leer(CLAVE_OCULTA(businessId));
export const ocultarGuia = (businessId) => guardar(CLAVE_OCULTA(businessId));
export const linkCompartido = (businessId) => leer(CLAVE_LINK(businessId));
export const marcarLinkCompartido = (businessId) => guardar(CLAVE_LINK(businessId));

/**
 * Los pasos, en orden. `ir` es a dónde lleva el botón (con ?nuevo=1 la
 * pantalla abre directo el formulario de alta); el último paso no navega:
 * copia el link público.
 */
export function pasosDeConfiguracion({ businessId, business, services, professionals, professionalServices, schedules, appointments, terminology }) {
  const servicios = (services || []).filter((s) => s.isActive !== false);
  const profs = (professionals || []).filter((p) => p.isActive !== false);
  const profListo = (p) =>
    (professionalServices || []).some((ps) => ps.professionalId === p.id)
    && (schedules || []).some((s) => s.professionalId === p.id && s.isActive !== false && s.startTime && s.endTime);
  const prof = terminology?.professionalNoun || 'profesional';

  return [
    {
      id: 'servicio',
      titulo: 'Cargá tus servicios',
      detalle: 'Lo que ofrecés, con cuánto dura y cuánto sale. Es lo que va a elegir tu cliente.',
      hecho: servicios.length > 0,
      ir: '/admin/servicios?nuevo=1',
      boton: 'Cargar un servicio',
    },
    {
      id: 'profesional',
      titulo: `Sumá a tu primer ${prof}`,
      detalle: `Puede ser vos mismo. En el mismo formulario elegís qué servicios hace y en qué horario atiende.`,
      hecho: profs.length > 0,
      ir: '/admin/profesionales?nuevo=1',
      boton: `Agregar ${prof}`,
    },
    {
      id: 'asignar',
      titulo: 'Revisá servicios y horarios de cada uno',
      detalle: `Un ${prof} sin servicios o sin horario no aparece en tu link de reserva.`,
      hecho: profs.length > 0 && profs.every(profListo),
      ir: '/admin/profesionales',
      boton: `Ver ${prof}s`,
    },
    {
      id: 'negocio',
      titulo: 'Completá los datos de tu negocio',
      detalle: 'Foto, teléfono y horario de atención: es lo primero que ve quien entra a reservar.',
      hecho: Boolean(business?.logoUrl || business?.phone),
      ir: '/admin/configuracion',
      boton: 'Ir a Configuración',
    },
    {
      id: 'link',
      titulo: 'Compartí tu link y probá reservar',
      detalle: 'Mandalo por WhatsApp o ponelo en tu Instagram. Hacé una reserva de prueba para ver lo que ve tu cliente.',
      hecho: linkCompartido(businessId) || (appointments || []).length > 0,
      accion: 'copiar',
      boton: 'Copiar mi link',
    },
  ];
}
