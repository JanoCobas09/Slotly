// ============================================
// Planes comerciales
// ============================================
// Fuente única de verdad. Antes las cuotas y los precios estaban hardcodeados
// dentro del panel de super-admin; ahora el alta de negocio y el cambio de
// plan leen de acá, así no se desincronizan.
//
// En `features` va solo lo que anda hoy: nada de funciones "próximamente".
// Vender algo que no existe es la clase de cosa que te hace perder un cliente
// en la primera semana.
//
// Cada plan lista SOLO lo que lo diferencia. Lo que tienen todos va en
// FEATURES_COMUNES y se muestra aparte. Antes las estadísticas y el walk-in
// figuraban como exclusivos del Pro, pero nada en el código los restringe: el
// Básico los tiene igual. Lo único que el sistema hace cumplir de verdad es
// `maxProfessionals` (ProfessionalsPage). Prometer una diferencia que no
// existe es peor que no prometerla: el primer Pro que pregunte qué compró se
// entera solo.
//
// `whatsappQuota` ya no se muestra en ningún lado público, pero sigue acá
// porque el panel global identifica el plan de un negocio por esa cuota
// (`findPlanByQuota`).
//
// `maxBarbers` se renombró a `maxProfessionals` en la generalización a
// multi-rubro. No hizo falta migrar nada: esta tabla es código estático
// indexado por `planId`, no un campo guardado en el documento de un negocio
// en Firestore — no hay datos viejos que pudieran quedar con el nombre
// anterior. `firestore.rules` sigue protegiendo el nombre viejo además del
// nuevo en la lista de campos que el dueño no puede tocar, a modo defensivo.

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
    description: 'Ideal para un profesional independiente',
    maxProfessionals: 1,
    features: [
      'Hasta 1 profesional',
      'Soporte por WhatsApp',
    ],
  },
  {
    id: 'pro',
    label: 'Plan Pro',
    whatsappQuota: 500,
    monthlyFee: 22000,
    description: 'El más elegido para negocios en crecimiento',
    maxProfessionals: 3,
    features: [
      'Hasta 3 profesionales',
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
