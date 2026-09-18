// ============================================================================
// Presets de rubro/profesión
// ============================================================================
// Fase 1 de la generalización a plataforma horizontal (ver documento de
// arquitectura). Esto NO es una lista de profesiones: son 7 categorías que
// agrupan comportamiento (terminología + tema + servicios sugeridos + campos
// de cliente) más un fallback `general` para cualquier profesión que no
// encaje. Agregar una profesión nueva es, casi siempre, agregarla a
// `CATEGORY_KEYWORDS` de la categoría más cercana — nunca crear un archivo
// nuevo por profesión.
//
// Nada de acá es obligatorio para el negocio: todo lo que ve el dueño en el
// onboarding es editable o descartable (ver `resolveBusinessContext.js`, que
// mezcla esto con lo que el negocio haya guardado en Firestore).
// ============================================================================

export const DEFAULT_PROFESSION_CATEGORY = 'general';

export const PROFESSION_PRESETS = {
  beauty: {
    label: 'Peluquería, barbería o estética',
    examples: 'Barbería, peluquería, centro de estética, manicuría, spa',
    terminology: {
      appointmentNoun: 'turno',
      professionalNoun: 'profesional',
      customerNoun: 'cliente',
      ctaLabel: 'Reservá tu próximo turno',
      confirmationMsg: 'Tu turno quedó confirmado.',
    },
    theme: {
      primaryColor: '#e03d00',
      primaryHover: '#b83200',
      primaryLight: '#fdf0eb',
      secondaryColor: '#ff5c1a',
      accentColor: '#ff5c1a',
    },
    suggestedServices: [
      { name: 'Corte de pelo', durationMinutes: 30 },
      { name: 'Corte + Barba', durationMinutes: 45 },
      { name: 'Afeitado clásico', durationMinutes: 30 },
      { name: 'Coloración', durationMinutes: 90 },
      { name: 'Tratamiento capilar', durationMinutes: 45 },
    ],
    customerFields: [],
  },

  healthcare: {
    label: 'Salud (odontología, medicina, kinesiología...)',
    examples: 'Odontología, medicina general, kinesiología, nutrición',
    terminology: {
      appointmentNoun: 'consulta',
      professionalNoun: 'doctor/a',
      customerNoun: 'paciente',
      ctaLabel: 'Reservá tu consulta',
      confirmationMsg: 'Tu consulta quedó confirmada.',
    },
    theme: {
      primaryColor: '#0f766e',
      primaryHover: '#0b5c56',
      primaryLight: '#ecfdf9',
      secondaryColor: '#14b8a6',
      accentColor: '#0f766e',
    },
    suggestedServices: [
      { name: 'Consulta', durationMinutes: 30 },
      { name: 'Control', durationMinutes: 20 },
      { name: 'Limpieza', durationMinutes: 45 },
      { name: 'Urgencia', durationMinutes: 30 },
    ],
    customerFields: [
      { key: 'reason', label: 'Motivo de consulta', type: 'text', required: false },
    ],
  },

  wellness: {
    label: 'Bienestar y terapias (psicología, masajes...)',
    examples: 'Psicología, masajes, terapias, coaching',
    terminology: {
      appointmentNoun: 'sesión',
      professionalNoun: 'terapeuta',
      customerNoun: 'paciente',
      ctaLabel: 'Agendá tu próxima sesión',
      confirmationMsg: 'Tu sesión quedó confirmada.',
    },
    theme: {
      primaryColor: '#7c5cbf',
      primaryHover: '#63459a',
      primaryLight: '#f3effa',
      secondaryColor: '#9b7fd4',
      accentColor: '#7c5cbf',
    },
    suggestedServices: [
      { name: 'Primera consulta', durationMinutes: 60 },
      { name: 'Sesión de seguimiento', durationMinutes: 45 },
    ],
    customerFields: [
      { key: 'reason', label: 'Motivo de la sesión', type: 'text', required: false },
    ],
  },

  automotive: {
    label: 'Taller o servicio automotor',
    examples: 'Taller mecánico, lavadero/detailing, servicio técnico de vehículos',
    terminology: {
      appointmentNoun: 'turno',
      professionalNoun: 'técnico/a',
      customerNoun: 'cliente',
      ctaLabel: 'Solicitá un turno para tu vehículo',
      confirmationMsg: 'Tu turno quedó confirmado.',
    },
    theme: {
      primaryColor: '#374151',
      primaryHover: '#1f2937',
      primaryLight: '#f3f4f6',
      secondaryColor: '#f59e0b',
      accentColor: '#f59e0b',
    },
    suggestedServices: [
      { name: 'Cambio de aceite', durationMinutes: 30 },
      { name: 'Diagnóstico', durationMinutes: 45 },
      { name: 'Service completo', durationMinutes: 120 },
    ],
    customerFields: [
      { key: 'vehicleInfo', label: 'Marca, modelo y patente', type: 'text', required: true },
    ],
  },

  education: {
    label: 'Clases y entrenamiento',
    examples: 'Profesores particulares, academias, entrenadores personales',
    terminology: {
      appointmentNoun: 'clase',
      professionalNoun: 'profesor/a',
      customerNoun: 'alumno/a',
      ctaLabel: 'Reservá tu próxima clase',
      confirmationMsg: 'Tu clase quedó confirmada.',
    },
    theme: {
      primaryColor: '#2563eb',
      primaryHover: '#1d4ed8',
      primaryLight: '#eff6ff',
      secondaryColor: '#3b82f6',
      accentColor: '#2563eb',
    },
    suggestedServices: [
      { name: 'Clase individual', durationMinutes: 60 },
      { name: 'Evaluación inicial', durationMinutes: 45 },
    ],
    customerFields: [
      { key: 'studentLevel', label: 'Nivel o edad del alumno', type: 'text', required: false },
    ],
  },

  professional_services: {
    label: 'Servicios profesionales',
    examples: 'Consultoría, abogacía, contabilidad, inmobiliarias',
    terminology: {
      appointmentNoun: 'reunión',
      professionalNoun: 'profesional',
      customerNoun: 'cliente',
      ctaLabel: 'Reservá tu consulta',
      confirmationMsg: 'Tu reunión quedó confirmada.',
    },
    theme: {
      primaryColor: '#1e3a5f',
      primaryHover: '#142942',
      primaryLight: '#eef2f7',
      secondaryColor: '#3b5a7a',
      accentColor: '#1e3a5f',
    },
    suggestedServices: [
      { name: 'Consulta inicial', durationMinutes: 45 },
      { name: 'Reunión de seguimiento', durationMinutes: 30 },
    ],
    customerFields: [
      { key: 'topic', label: 'Tema a tratar', type: 'text', required: false },
    ],
  },

  pet_services: {
    label: 'Servicios para mascotas',
    examples: 'Veterinaria, entrenamiento canino, cuidado de mascotas',
    terminology: {
      appointmentNoun: 'turno',
      professionalNoun: 'profesional',
      customerNoun: 'cliente',
      ctaLabel: 'Reservá un turno para tu mascota',
      confirmationMsg: 'Tu turno quedó confirmado.',
    },
    theme: {
      primaryColor: '#16a34a',
      primaryHover: '#15803d',
      primaryLight: '#f0fdf4',
      secondaryColor: '#22c55e',
      accentColor: '#16a34a',
    },
    suggestedServices: [
      { name: 'Consulta veterinaria', durationMinutes: 30 },
      { name: 'Baño y peluquería', durationMinutes: 60 },
      { name: 'Sesión de entrenamiento', durationMinutes: 45 },
    ],
    customerFields: [
      { key: 'petInfo', label: 'Nombre y especie de la mascota', type: 'text', required: true },
    ],
  },

  // Fallback: se usa cuando el negocio no eligió categoría, o cuando escribió
  // una profesión propia que no matchea ninguna de las anteriores. Tiene que
  // ser un producto completo por sí mismo, nunca un estado roto.
  general: {
    label: 'Otro tipo de negocio',
    examples: 'Cualquier negocio que trabaje con turnos o reservas',
    terminology: {
      appointmentNoun: 'reserva',
      professionalNoun: 'profesional',
      customerNoun: 'cliente',
      ctaLabel: 'Reservá tu turno',
      confirmationMsg: 'Tu reserva quedó confirmada.',
    },
    theme: {
      primaryColor: '#404040',
      primaryHover: '#262626',
      primaryLight: '#f5f5f5',
      secondaryColor: '#737373',
      accentColor: '#404040',
    },
    suggestedServices: [],
    customerFields: [],
  },
};

/**
 * Palabras clave (en minúscula, sin acentos) para inferir la categoría de una
 * profesión escrita a mano. No es IA: es un match simple y auditable. Si no
 * hay ningún match, el negocio queda en `general` — nunca en un estado
 * incoherente.
 */
const CATEGORY_KEYWORDS = {
  beauty: ['peluquer', 'peinado', 'estetic', 'barber', 'unas', 'manicur', 'pedicur', 'spa', 'maquillaje', 'depilac', 'coloracion'],
  healthcare: ['odont', 'dent', 'medic', 'doctor', 'clinic', 'kinesiolog', 'fisioterap', 'nutrici', 'salud', 'terapia ocupacional'],
  wellness: ['psicolog', 'terapi', 'masaj', 'masoterap', 'bienestar', 'mindfulness', 'coach de vida', 'reiki'],
  automotive: ['taller', 'mecanic', 'automotor', 'vehicul', 'auto ', 'lavadero', 'detailing', 'neumat', 'electricista del automovil'],
  education: ['profesor', 'clases', 'academia', 'tutor', 'entrenador', 'entrenamiento', 'instructor', 'idioma', 'musica', 'guitarra', 'piano'],
  professional_services: ['abogad', 'contador', 'consultor', 'inmobiliari', 'asesor legal', 'contable', 'notari', 'arquitect'],
  pet_services: ['veterinari', 'mascota', 'perro', 'gato', 'adiestra', 'canino', 'petshop', 'peluqueria canina'],
};

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Infiere `professionCategory` a partir de un texto libre (la profesión que
 * escribió el dueño cuando no encontró la suya en la lista). Determinista:
 * cuenta coincidencias de keywords por categoría y devuelve la que más tiene.
 * Sin coincidencias → `general`.
 */
export function matchProfessionCategory(customProfession) {
  const text = normalize(customProfession);
  if (!text) return DEFAULT_PROFESSION_CATEGORY;

  let bestCategory = DEFAULT_PROFESSION_CATEGORY;
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((acc, kw) => (text.includes(kw) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

export function getProfessionPreset(category) {
  return PROFESSION_PRESETS[category] || PROFESSION_PRESETS[DEFAULT_PROFESSION_CATEGORY];
}

/**
 * ¿`category` es una clave real de `PROFESSION_PRESETS`? `getProfessionPreset`
 * nunca devuelve falsy (cae a `general`), así que no sirve para esto: hace
 * falta chequear la clave, no el resultado.
 */
export function isKnownProfessionCategory(category) {
  return Boolean(category) && Object.prototype.hasOwnProperty.call(PROFESSION_PRESETS, category);
}

export function listProfessionCategories() {
  return Object.entries(PROFESSION_PRESETS)
    .filter(([key]) => key !== DEFAULT_PROFESSION_CATEGORY)
    .map(([key, preset]) => ({ value: key, label: preset.label, examples: preset.examples }));
}
