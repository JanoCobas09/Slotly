// ============================================================================
// Bienvenida de la app instalada (ver el <script> de index.html)
// ============================================================================
// La animación y el sonido viven en index.html para arrancar antes que el
// bundle. Desde acá solo se le avisa que la app ya puede verse, y se maneja
// la preferencia del sonido (por dispositivo: es el celular el que suena).

const CLAVE_SONIDO = 'slotly:sonidoAlAbrir';

/** La app ya pintó algo útil: la bienvenida se puede ir (respeta su mínimo). */
export function avisarAppLista() {
  window.__slotlySplashListo?.();
}

/** Abierta desde el ícono de la pantalla de inicio, no en el navegador. */
export function abiertaComoApp() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

export function sonidoAlAbrirActivado() {
  try {
    return localStorage.getItem(CLAVE_SONIDO) !== 'off';
  } catch {
    return true;
  }
}

export function guardarSonidoAlAbrir(activado) {
  try {
    if (activado) localStorage.removeItem(CLAVE_SONIDO);
    else localStorage.setItem(CLAVE_SONIDO, 'off');
  } catch { /* sin almacenamiento: queda como estaba */ }
}
