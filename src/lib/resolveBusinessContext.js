import { DEFAULT_PROFESSION_CATEGORY, getProfessionPreset, isKnownProfessionCategory } from '../config/professionPresets';

// ============================================================================
// resolveBusinessContext
// ============================================================================
// Única función que sabe traducir "qué rubro es este negocio" a lo que la UI
// necesita mostrar (terminología, tema, servicios sugeridos, campos extra del
// formulario de reserva). Es pura: recibe el documento `business` tal como
// llega de Firestore y no sabe nada de React ni de dónde salió el dato.
//
// Regla de fusión: el preset de la categoría pone los defaults; lo que el
// negocio haya guardado (en `business.context` o en los campos de color ya
// existentes `primaryColor/secondaryColor/accentColor`) siempre gana.
//
// Un negocio sin `context` (cualquier barbería creada antes de esta fase) cae
// en el preset `beauty` — la misma experiencia que ya tenía, sin escribir
// nada en la base.
// ============================================================================

const LEGACY_DEFAULT_CATEGORY = 'beauty';

export function resolveBusinessContext(business) {
  const context = business?.context || null;
  const hasOwnCategory = isKnownProfessionCategory(context?.professionCategory);
  const professionCategory = hasOwnCategory
    ? context.professionCategory
    : context
      ? DEFAULT_PROFESSION_CATEGORY
      : LEGACY_DEFAULT_CATEGORY;

  const preset = getProfessionPreset(professionCategory);

  const terminology = {
    ...preset.terminology,
    ...(context?.terminology || {}),
  };

  const theme = {
    ...preset.theme,
    ...(business?.primaryColor ? { primaryColor: business.primaryColor } : {}),
    ...(business?.secondaryColor ? { secondaryColor: business.secondaryColor } : {}),
    ...(business?.accentColor ? { accentColor: business.accentColor } : {}),
  };

  const suggestedServices = context?.suggestedServices ?? preset.suggestedServices;
  const customerFields = context?.customerFields ?? preset.customerFields;

  return {
    professionCategory,
    customProfession: context?.customProfession || null,
    icon: preset.icon,
    terminology,
    theme,
    suggestedServices,
    customerFields,
  };
}
