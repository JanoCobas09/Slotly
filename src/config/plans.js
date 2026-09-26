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
  'Seña con Mercado Pago',
  'Promociones por día y horario',
  'Estadísticas completas',
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
    // Sucursales (y con ellas, administradores de sucursal). null = sin límite.
    maxBranches: 1,
    features: [
      'Hasta 1 profesional',
      'Una sucursal',
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
    maxBranches: 3,
    features: [
      'Hasta 3 profesionales',
      'Hasta 3 sucursales, con administrador por sucursal',
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
    maxBranches: null,
    features: [
      'Profesionales y sucursales sin límite',
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

/**
 * Tope de sucursales del plan (null = sin límite). Un plan desconocido no
 * limita, igual que `maxProfessionals`. La base lo hace cumplir también
 * (limite_sucursales en 20261010000000_limite_sucursales.sql): si cambiás un
 * número acá, cambialo allá.
 */
export function limiteSucursales(planId) {
  const plan = getPlan(planId);
  return plan ? plan.maxBranches ?? null : null;
}

/** El primer plan que permite más de una sucursal (para el "disponible desde…"). */
export const planConSucursales = () => PLANS.find((p) => p.maxBranches === null || p.maxBranches > 1);

/** Link a WhatsApp para pedir el cambio de plan, con el motivo ya escrito. */
export function linkAmpliarPlan(motivo) {
  return 'https://wa.me/5492257660073?text=' + encodeURIComponent(`Hola! Quiero pasarme de plan en Slotly: ${motivo}.`);
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
