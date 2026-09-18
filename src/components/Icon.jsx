// ============================================================================
// Set de íconos propio de Slotly
// ============================================================================
// Reemplaza los emojis (que eran genéricos y venían de font por-sistema-
// operativo, así que ni siquiera se veían igual en todos lados) por SVG
// lineal propio, consistente en trazo y tamaño. `currentColor` para que cada
// ícono tome el color del texto que lo rodea — incluido el tema de cada
// negocio (--primary, --danger, etc.), sin hardcodear un color acá.
//
// Agregar un ícono nuevo: una entrada más en PATHS, viewBox 24x24.

import { forwardRef } from 'react';

const PATHS = {
  // Navegación / secciones
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c.6-3.4 2.9-5.2 5.5-5.2s4.9 1.8 5.5 5.2" /><circle cx="17.5" cy="8.5" r="2.6" /><path d="M15.8 12.8c2.2.2 3.9 1.9 4.4 4.7" /></>,
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c.8-4 3.4-6.2 7.5-6.2s6.7 2.2 7.5 6.2" /></>,
  services: <><path d="M6 3h9l4 4v13.5a.5.5 0 0 1-.5.5H6.5a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 6 3z" /><path d="M14.5 3v4h4" /><path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /><circle cx="8" cy="14.2" r="1" /><circle cx="12" cy="14.2" r="1" /><circle cx="16" cy="14.2" r="1" /><circle cx="8" cy="17.6" r="1" /><circle cx="12" cy="17.6" r="1" /></>,
  shield: <path d="M12 3l7 3v5.2c0 4.6-3 8.3-7 9.8-4-1.5-7-5.2-7-9.8V6z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3" /></>,
  chat: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.5 3.7A.5.5 0 0 1 3 20V6a1 1 0 0 1 1-1z" />,
  home: <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9.5a.5.5 0 0 0 .5.5H10v-5a2 2 0 0 1 4 0v5h3.5a.5.5 0 0 0 .5-.5V10" /></>,
  logout: <><path d="M9 21H5.5a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 5.5 3H9" /><path d="M15.5 16l4.5-4-4.5-4M20 12H9" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  bell: <><path d="M12 3.5a5 5 0 0 0-5 5v3.2c0 .9-.3 1.8-.9 2.6l-1 1.3A1 1 0 0 0 6 17.2h12a1 1 0 0 0 .8-1.6l-1-1.3c-.6-.8-.9-1.7-.9-2.6V8.5a5 5 0 0 0-5-5z" /><path d="M9.5 20a2.6 2.6 0 0 0 5 0" /></>,
  'bell-off': <><path d="M12 3.5a5 5 0 0 0-5 5v3.2c0 .9-.3 1.8-.9 2.6l-1 1.3A1 1 0 0 0 6 17.2h12" /><path d="M9.5 20a2.6 2.6 0 0 0 5 0M4 4l16 16" /></>,
  pause: <><rect x="6" y="5" width="4.5" height="14" rx="1.3" /><rect x="13.5" y="5" width="4.5" height="14" rx="1.3" /></>,
  dot: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  circle: <circle cx="12" cy="12" r="8.5" />,

  // Estado / acciones
  check: <path d="M4.5 12.5l5 5L19.5 6.5" />,
  'check-circle': <><circle cx="12" cy="12" r="8.5" /><path d="M8 12.3l2.7 2.7L16.3 9" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  'x-circle': <><circle cx="12" cy="12" r="8.5" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 2" /></>,
  warning: <><path d="M12 3.5 21 19.5H3z" /><path d="M12 9.5v4.2" /><circle cx="12" cy="16.6" r="0.15" fill="currentColor" /></>,
  'user-x': <><circle cx="10" cy="8" r="3.2" /><path d="M4 20c.6-3.4 2.9-5.2 6-5.2 1 0 1.9.2 2.7.6" /><path d="M16.5 9.5l4 4M20.5 9.5l-4 4" /></>,
  save: <><path d="M5 3.5h11l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z" /><path d="M7.5 3.5V9h7V3.5M7.5 20.2v-6h9v6" /></>,

  // Objetos / datos
  clipboard: <><rect x="5.5" y="4.5" width="13" height="16" rx="1.8" /><rect x="9" y="3" width="6" height="3" rx="1" /><path d="M8.5 11h7M8.5 14.5h7M8.5 17.5h4" /></>,
  note: <><path d="M4.5 20.5 5 17l11-11 3 3-11 11z" /><path d="M13.5 9.5l3 3" /></>,
  phone: <path d="M6.5 3.5h3l1.3 4-2 1.5a12.5 12.5 0 0 0 6.2 6.2l1.5-2 4 1.3v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 5 5.1a1.5 1.5 0 0 1 1.5-1.6z" />,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="1.8" /><path d="M4 6.5l8 6.5 8-6.5" /></>,
  money: <><rect x="2.5" y="6.5" width="19" height="11" rx="1.8" /><circle cx="12" cy="12" r="2.6" /><path d="M6 6.5v11M18 6.5v11" /></>,
  'chart-bar': <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  link: <><path d="M9 15l6-6" /><path d="M8 17l-2.5 2.5a3 3 0 0 1-4.2-4.2L4 12.5" /><path d="M16 7l2.5-2.5a3 3 0 0 1 4.2 4.2L20 11.5" /></>,
  edit: <><path d="M4 20l.9-3.8L16 5.1l3.8 3.8L8.7 20z" /><path d="M13.5 7.5l3.8 3.8" /></>,
  trash: <><path d="M5 7h14M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" /><path d="M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h5a1.5 1.5 0 0 0 1.5-1.4L17 7" /><path d="M10.2 11v6M13.8 11v6" /></>,
  snowflake: <><path d="M12 2.5v19M4.8 6.75l14.4 10.5M19.2 6.75L4.8 17.25" /></>,
  tool: <path d="M14.5 6.5a4 4 0 0 1-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 1 5.2-5.2L20 7l-3-3z" />,
  crown: <><path d="M3.5 8.5 7 12l5-6.5L17 12l3.5-3.5L19 18H5z" /></>,
  tag: <><path d="M11.5 3.5H5.8a1 1 0 0 0-1 1v5.7a1 1 0 0 0 .3.7l9 9a1 1 0 0 0 1.4 0l5.7-5.7a1 1 0 0 0 0-1.4l-9-9a1 1 0 0 0-.7-.3z" /><circle cx="8.7" cy="8.7" r="1.2" /></>,
  building: <><rect x="4.5" y="3.5" width="10" height="17" rx="1" /><rect x="14.5" y="9.5" width="5" height="11" rx="1" /><path d="M7.5 7.5h1M11 7.5h1M7.5 11h1M11 11h1M7.5 14.5h1M11 14.5h1" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.7-4.7" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="1.8" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
  question: <><circle cx="12" cy="12" r="8.5" /><path d="M9.3 9.3a2.7 2.7 0 1 1 3.8 2.5c-.9.4-1.4 1-1.4 2" /><circle cx="12" cy="16.7" r="0.15" fill="currentColor" /></>,
  sparkle: <path d="M12 2.5l1.6 5.3 5.4 1.6-5.4 1.6L12 16.3l-1.6-5.3-5.4-1.6 5.4-1.6z" />,
  confetti: <><path d="M4 20l3-9M9 20l2-11M14 20l1-7M18 6l-2 3M8 3.5l1.5 2.5M14.5 3l1 3" /><circle cx="19" cy="14" r="1" /><circle cx="15" cy="16" r="1" /></>,
  wave: <path d="M8 13c1.3-3.5 3-5 5-5s3.4 1.7 3 3.6c-.3 1.4-1.5 2-2.4 1.4 1 .6 1 2-.2 2.5" />,
  robot: <><rect x="5" y="8.5" width="14" height="10" rx="2" /><path d="M12 5.5v3M9 3h6" /><circle cx="9.3" cy="13" r="1" /><circle cx="14.7" cy="13" r="1" /><path d="M9.5 16.5h5" /></>,
  send: <path d="M4 12l16-8-6 16-3-6-6-2z" />,
  stethoscope: <><path d="M6 4v6.5a4.5 4.5 0 0 0 9 0V4" /><path d="M6 4H4.3M15 4h1.7" /><circle cx="19" cy="13.5" r="2" /><path d="M15 11v1a4 4 0 0 1-8 0v-1.5" /></>,
  briefcase: <><rect x="3.5" y="7.5" width="17" height="11.5" rx="1.8" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3.5 12.5h17" /></>,
  paw: <><circle cx="7" cy="9" r="1.6" /><circle cx="11.5" cy="6.5" r="1.6" /><circle cx="16.5" cy="7.5" r="1.6" /><circle cx="19.5" cy="12" r="1.6" /><path d="M12 12.5c3 0 5 2.2 5 4.4 0 1.7-1.3 2.6-3 2.1a5.6 5.6 0 0 0-4 0c-1.7.5-3-.4-3-2.1 0-2.2 2-4.4 5-4.4z" /></>,
  car: <><path d="M4 15.5 5.6 10a2 2 0 0 1 1.9-1.4h9a2 2 0 0 1 1.9 1.4l1.6 5.5" /><rect x="3" y="15.5" width="18" height="4.5" rx="1.6" /><circle cx="7.5" cy="19.8" r="1.4" /><circle cx="16.5" cy="19.8" r="1.4" /></>,
  graduation: <><path d="M2 9.5 12 5l10 4.5-10 4.5z" /><path d="M6 11.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4.5" /><path d="M20.5 10v5.5" /></>,

  // Íconos por rubro (professionPresets.js) — uno por categoría, para que el
  // dueño reconozca su profesión de un vistazo en vez de leer solo texto.
  scissors: <><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M20 4L8.1 15.9" /><path d="M14.5 14.5L20 20" /><path d="M8.1 8.1L12 12" /></>,
  dumbbell: <><path d="M7.5 12h9" /><rect x="3" y="8.5" width="3.2" height="7" rx="1.4" /><rect x="17.8" y="8.5" width="3.2" height="7" rx="1.4" /></>,
  leaf: <><path d="M5 19c9 1 14-4 14.5-14.5C10.5 3 5 8.5 5 16.5z" /><path d="M6.2 17.8c2.5-4.5 5.5-8 11-11" /></>,
};

/** Ícono lineal, 24x24, hereda color y tamaño del texto (`1em` por defecto). */
const Icon = forwardRef(function Icon({ name, size = '1em', strokeWidth = 2, className, style, title, ...rest }, ref) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.15em', flexShrink: 0, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {paths}
    </svg>
  );
});

export default Icon;
