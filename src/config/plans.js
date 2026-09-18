// ============================================
// Planes comerciales
// ============================================
// Fuente única de verdad. Antes las cuotas y los precios estaban hardcodeados
// dentro del panel de super-admin; ahora el alta de negocio y el cambio de
// plan leen de acá, así no se desincronizan.
//
// En `features`, una entrada puede ser texto suelto o `{ texto, proximamente }`.
// Lo segundo se pinta con una etiqueta y sirve para no prometer en la landing
// lo que todavía no anda: los avisos por WhatsApp esperan la aprobación de Meta
// y la exportación de clientes no está construida. Vender eso como disponible
// es la clase de cosa que te hace perder un cliente en la primera semana.
//
// Cada plan lista SOLO lo que lo diferencia. Lo que tienen todos va en
// FEATURES_COMUNES y se muestra aparte. Antes las estadísticas y el walk-in
// figuraban como exclusivos del Pro, pero nada en el código los restringe: el
// Básico los tiene igual. Lo único que el sistema hace cumplir de verdad es
// `maxProfessionals` (ProfessionalsPage), y cuando lleguen los avisos por
// WhatsApp, la cuota. Prometer una diferencia que no existe es peor que no
// prometerla: el primer Pro que pregunte qué compró se entera solo.
//
// `maxBarbers` queda como alias de compatibilidad: negocios dados de alta
// antes de la generalización a multi-rubro guardaron ese nombre de campo en
// Firestore, y `getPlan`/`ProfessionalsPage` lo siguen leyendo como fallback
// de `maxProfessionals`. No hace falta migrar datos viejos para esto.

/** Lo que incluye cualquier plan. Se muestra una vez, debajo de los tres. */
export const FEATURES_COMUNES = [
  'Turnos e historial sin límite',
  'Tu link público con tu marca',
  'Estadísticas de facturación',
  'Servicios sin turno en vivo (walk-in)',
  'Cada profesional ve solo su agenda',
];

export const PLANS = [
  {
    id: 'basico',
    label: 'Plan Básico',
    whatsappQuota: 100,
    monthlyFee: 12000,
    description: 'Ideal para un profesional independiente o una dupla',
    maxProfessionals: 2,
    features: [
      'Hasta 2 profesionales',
      { texto: '100 avisos por WhatsApp/mes', proximamente: true },
      'Soporte por WhatsApp',
    ],
  },
  {
    id: 'pro',
    label: 'Plan Pro',
    whatsappQuota: 500,
    monthlyFee: 22000,
    description: 'El más elegido para negocios en crecimiento',
    maxProfessionals: 5,
    features: [
      'Hasta 5 profesionales',
      { texto: '500 avisos por WhatsApp/mes', proximamente: true },
      'Soporte prioritario por WhatsApp',
    ],
  },
  {
    id: 'business',
    label: 'Plan Business',
    whatsappQuota: 2000,
    monthlyFee: 35000,
    description: 'Para negocios grandes o con varios locales',
    maxProfessionals: null,
    features: [
      'Profesionales sin límite',
      { texto: '2000 avisos por WhatsApp/mes', proximamente: true },
      { texto: 'Exportación de base de clientes', proximamente: true },
      'Configuración inicial asistida',
      'Soporte prioritario por WhatsApp',
    ],
  },
];

export const DEFAULT_PLAN_ID = 'basico';

/** Costo que se le cobra al cliente por cada mensaje fuera de cuota (USD). */
export const OVERAGE_COST_USD = 0.06;

export function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) || null;
}

/** Dada una cuota, devuelve el plan que la usa (o null si es personalizado). */
export function findPlanByQuota(quota) {
  return PLANS.find((p) => p.whatsappQuota === quota) || null;
}

/** Horario comercial por defecto. dayOfWeek: 0 = Lunes … 6 = Domingo. */
export const DEFAULT_BUSINESS_HOURS = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '', endTime: '', isActive: false },
];
