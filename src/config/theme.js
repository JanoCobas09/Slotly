// Configuración del tema White-Label
// Estos valores se cargan desde business_settings y se aplican como CSS custom properties.
//
// Los defaults son la identidad de Slotly ("Warm Utility"): petróleo/teal con
// acento terracota sobre casi-blanco cálido. Cada negocio puede pisar
// primary/secondary/accent con sus propios colores desde
// /admin/configuracion (o hereda el preset de su rubro, ver
// professionPresets.js); el resto es la base del producto.
// Los mismos valores están en :root de index.css — si cambiás uno, cambiá el otro.

export const defaultTheme = {
  primaryColor: '#28706f',
  primaryHover: '#1f5957',
  primaryLight: '#dcefea',
  secondaryColor: '#c87957',
  accentColor: '#c87957',
  bgColor: '#fafaf7',
  surfaceColor: '#ffffff',
  textColor: '#202524',
  textSecondary: '#565c59',
  textMuted: '#9aa19b',
  borderColor: 'rgba(32, 37, 36, 0.09)',
  successColor: '#0f9960',
  warningColor: '#b45309',
  dangerColor: '#d92d20',
};

export function applyTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty('--primary', theme.primaryColor || defaultTheme.primaryColor);
  root.style.setProperty('--primary-hover', theme.primaryHover || defaultTheme.primaryHover);
  root.style.setProperty('--primary-light', theme.primaryLight || defaultTheme.primaryLight);
  root.style.setProperty('--secondary', theme.secondaryColor || defaultTheme.secondaryColor);
  root.style.setProperty('--accent', theme.accentColor || defaultTheme.accentColor);
  // El resaltado del ítem activo del sidebar (--sidebar-active, en index.css)
  // usa esta variable. Antes quedaba fija en el teal de Slotly sin importar
  // el rubro: el accent de cada preset ya está elegido a propósito para
  // contrastar bien sobre el sidebar oscuro (ej. ámbar en automotor), a
  // diferencia de primaryColor, que en varios rubros es un color oscuro que
  // se vería apagado ahí.
  root.style.setProperty('--primary-soft', theme.accentColor || theme.secondaryColor || defaultTheme.accentColor);
}
