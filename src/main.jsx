import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { firebaseListo } from './lib/firebase';
import ConfigErrorPage from './pages/ConfigErrorPage';
import { BusinessProvider } from './contexts/BusinessContext';
import { AuthProvider } from './contexts/AuthContext';
import { BookingProvider } from './contexts/BookingContext';
import { registerServiceWorker } from './lib/push';

// El login pasa por Firebase Auth (signInWithPopup), que crea la sesión de
// servidor que necesitan las Security Rules. La config se inicializa en
// src/lib/firebase.js.

// Si el build salió sin las variables de entorno, no se monta la app: sus
// providers se conectarían a un Firebase inexistente. En vez de la pantalla en
// blanco, se muestra qué falta y cómo arreglarlo.
const raiz = createRoot(document.getElementById('root'));

// Registra el Service Worker temprano (no recién al activar notificaciones):
// sin uno controlando la página, el navegador no ofrece "Instalar app".
// import.meta.env.PROD porque en dev con HMR un SW propio suele generar más
// dolores de cabeza (assets cacheados viejos) que beneficio.
if (import.meta.env.PROD) registerServiceWorker();

if (!firebaseListo) {
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
