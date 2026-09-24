// ============================================================================
// Estado global de instalación del PWA (beforeinstallprompt)
// ============================================================================
// El navegador dispara `beforeinstallprompt` UNA sola vez por carga de
// página, en el momento que decida (a veces apenas carga, a veces recién
// tras algo de uso) — no espera a que el dueño llegue a /admin. Si el
// listener se registrara recién dentro de useInstallPrompt (un hook que solo
// vive mientras AdminLayout está montado), cualquier disparo que llegara
// mientras el dueño todavía está en /login o en la landing se perdería para
// siempre en esa carga de página. Por eso el listener vive acá, a nivel de
// módulo, importado desde main.jsx para que se registre en el primer tick
// posible — bastante antes de que exista ningún componente de React.
let evento = null;
let instalada =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || Boolean(window.navigator?.standalone));

const listeners = new Set();
const avisar = () => listeners.forEach((cb) => cb());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    evento = e;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    instalada = true;
    evento = null;
    avisar();
  });
}

export function getEstadoInstalacion() {
  return { evento, instalada };
}

/** Se suscribe a cambios (llega el prompt, o se instaló). Devuelve el unsubscribe. */
export function suscribirInstalacion(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Consume el evento guardado (una sola vez, como pide `prompt()`) y avisa a todos. */
export async function dispararPrompt() {
  if (!evento) return null;
  const usado = evento;
  usado.prompt();
  const { outcome } = await usado.userChoice;
  if (outcome === 'accepted') instalada = true;
  evento = null;
  avisar();
  return outcome;
}
