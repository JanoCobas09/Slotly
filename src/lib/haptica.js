// ============================================================================
// Vibración corta al tocar los botones importantes (app instalada)
// ============================================================================
// Un "tic" de 10 ms en los botones principales (.btn-primary: guardar,
// confirmar, siguiente...) y en los de peligro (.btn-danger: cancelar,
// borrar), como hacen las apps nativas. Solo en la app instalada: en el
// navegador nadie lo espera. iPhone no tiene navigator.vibrate, así que ahí
// no hace nada. Un solo listener para todo el sistema, registrado desde
// main.jsx: no hay que acordarse de agregarlo en cada botón nuevo.
import { abiertaComoApp } from './splash';

const BOTONES_IMPORTANTES = '.btn-primary, .btn-danger';

if (typeof window !== 'undefined' && typeof navigator.vibrate === 'function' && abiertaComoApp()) {
  document.addEventListener('click', (e) => {
    const boton = e.target instanceof Element ? e.target.closest(BOTONES_IMPORTANTES) : null;
    if (!boton || boton.disabled || boton.getAttribute('aria-disabled') === 'true') return;
    try { navigator.vibrate(10); } catch { /* sin vibración: no pasa nada */ }
  }, { capture: true, passive: true });
}
