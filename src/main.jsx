import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { supabaseListo } from './lib/supabase';
import ConfigErrorPage from './pages/ConfigErrorPage';
import { BusinessProvider } from './contexts/BusinessContext';
import { AuthProvider } from './contexts/AuthContext';
import { BookingProvider } from './contexts/BookingContext';
import { registerServiceWorker } from './lib/push';
// Efecto secundario a propósito: registra el listener de beforeinstallprompt
// (ver el comentario en el archivo) apenas carga el bundle, no recién cuando
// se monte algún componente del panel de admin.
import './lib/installPrompt';

// El login pasa por Supabase Auth (signInWithOAuth/signInWithPassword), que
// crea la sesión que necesita RLS para saber quién sos. La config se
// inicializa en src/lib/supabase.js.

// Si el build salió sin las variables de entorno, no se monta la app: sus
// providers se conectarían a un Supabase inexistente. En vez de la pantalla en
// blanco, se muestra qué falta y cómo arreglarlo.
const raiz = createRoot(document.getElementById('root'));

// Todas las páginas se cargan con lazy() (ver App.jsx). Si alguien tiene la
// app abierta en una pestaña y mientras tanto sale un deploy nuevo, los
// archivos con hash viejo dejan de existir — Vercel responde el index.html
// en su lugar (la reescritura de SPA), y el navegador lo rechaza porque
// esperaba un módulo JS ("Failed to fetch dynamically imported module").
// Sin esto, la pantalla queda en blanco justo en medio de un flujo (pasó
// reservando un turno: el turno se creó bien, pero la pantalla de
// confirmación nunca llegó a cargar). Vite dispara este evento en ese
// caso puntual; la solución real es la misma que un F5: recargar trae el
// index.html nuevo, con los hashes correctos. El sessionStorage evita un
// loop de recargas si el problema fuera otra cosa y persistiera.
const RECARGO_POR_DEPLOY = 'slotly:recargoPorDeployNuevo';
window.addEventListener('vite:preloadError', () => {
  let yaRecargo = false;
  try { yaRecargo = sessionStorage.getItem(RECARGO_POR_DEPLOY) === '1'; } catch { /* nada */ }
  if (yaRecargo) return; // ya lo intentó una vez en esta pestaña: no insistir en loop
  try { sessionStorage.setItem(RECARGO_POR_DEPLOY, '1'); } catch { /* nada */ }
  window.location.reload();
});
// Si esta carga arrancó por esa recarga, el flag se limpia solo a los pocos
// segundos: confirma que la página nueva cargó bien y deja el guard listo
// para el PRÓXIMO deploy que pase mientras la pestaña sigue abierta — sin
// esto, una sola recarga automática en toda la vida de la pestaña alcanzaría
// para dejar de protegerla de ahí en adelante.
setTimeout(() => { try { sessionStorage.removeItem(RECARGO_POR_DEPLOY); } catch { /* nada */ } }, 8000);

// Registra el Service Worker temprano (no recién al activar notificaciones):
// sin uno controlando la página, el navegador no ofrece "Instalar app".
// import.meta.env.PROD porque en dev con HMR un SW propio suele generar más
// dolores de cabeza (assets cacheados viejos) que beneficio.
if (import.meta.env.PROD) registerServiceWorker();

if (!supabaseListo) {
  raiz.render(<ConfigErrorPage />);
} else {
  raiz.render(
    <StrictMode>
      <BusinessProvider>
        <AuthProvider>
          <BookingProvider>
            <App />
          </BookingProvider>
        </AuthProvider>
      </BusinessProvider>
    </StrictMode>
  );
}
