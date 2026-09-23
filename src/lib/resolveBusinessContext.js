import { DEFAULT_PROFESSION_CATEGORY, getProfessionPreset, isKnownProfessionCategory } from '../config/professionPresets';

// ============================================================================
// resolveBusinessContext
// ============================================================================
// Única función que sabe traducir "qué rubro es este negocio" a lo que la UI
// necesita mostrar (terminología, tema, servicios sugeridos, campos extra del
// formulario de reserva). Es pura: recibe el objeto `business` tal como lo
// entrega repository.js y no sabe nada de React ni de dónde salió el dato.
//
// Regla de fusión: el preset de la categoría pone los defaults; lo que el
// negocio haya guardado en sus propias columnas (`professionCategory`,
// `customProfession`, o los campos de color `primaryColor/secondaryColor/
// accentColor`) siempre gana.
//
// `professionCategory`/`customProfession` son columnas propias en `businesses`
// (no un `context` anidado — eso era la forma del documento en Firestore;
// en Postgres es más simple, dos columnas planas). Un negocio sin categoría
// reconocida (cualquier valor vacío o que no matchea ninguna de las 7) cae en
// el preset `beauty` — la misma experiencia por defecto que tenía toda
// barbería antes de la generalización a multi-rubro. Sin ningún negocio
// activo (landing, login, o cualquier pantalla de plataforma sin slug) no
// hay legado que preservar: se resuelve a `general`, que ES la identidad
// propia de Slotly (mismos valores que defaultTheme en theme.js) — no el
// naranja de un negocio en particular.
// ============================================================================

const LEGACY_DEFAULT_CATEGORY = 'beauty';

export function resolveBusinessContext(business) {
  const hasOwnCategory = isKnownProfessionCategory(business?.professionCategory);
  const professionCategory = hasOwnCategory
    ? business.professionCategory
    : business
      ? LEGACY_DEFAULT_CATEGORY
      : DEFAULT_PROFESSION_CATEGORY;

  const preset = getProfessionPreset(professionCategory);

  const theme = {
    ...preset.theme,
    ...(business?.primaryColor ? { primaryColor: business.primaryColor } : {}),
    ...(business?.secondaryColor ? { secondaryColor: business.secondaryColor } : {}),
    ...(business?.accentColor ? { accentColor: business.accentColor } : {}),
  };

  return {
    professionCategory,
    customProfession: business?.customProfession || null,
    icon: preset.icon,
    terminology: preset.terminology,
    theme,
    suggestedServices: preset.suggestedServices,
    customerFields: preset.customerFields,
  };
}
