import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { abiertaComoApp } from '../lib/splash';

// ============================================================================
// Botón "atrás" del celular en la app instalada
// ============================================================================
// Después de entrar con Google, debajo del panel en el historial quedan la
// pantalla de /login y el selector de cuentas de Google: tocando "atrás"
// varias veces, la app terminaba mostrando el inicio de sesión. Esas
// entradas no se pueden borrar (son de otro sitio), así que se pone un tope:
// al abrir el panel se duplica la entrada actual, y el panel vive ARRIBA de
// ese duplicado. "Atrás" recorre las pantallas del panel normalmente; cuando
// llega al tope (la entrada de abajo), en vez de seguir hacia Google se
// vuelve un paso adelante y se pregunta si quiere salir.
//
// Solo en la app instalada: en una pestaña del navegador, "atrás" tiene que
// poder salir del sitio como siempre.

// Posición (idx de React Router) de la entrada que queda debajo del panel.
// A nivel de módulo: una vez por carga de página, aunque el layout se
// vuelva a montar (StrictMode, cambio de cuenta sin recargar).
let tope = null;
// Recién después de haber estado arriba del tope tiene sentido mirar si se
// volvió a él (al montar, la entrada actual ES la del tope por un instante).
let topePuesto = false;

const idxActual = () => {
  const idx = window.history.state?.idx;
  return typeof idx === 'number' ? idx : null;
};

export function useSalidaDeLaApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [preguntando, setPreguntando] = useState(false);
  const [noSeCerro, setNoSeCerro] = useState(false);
  const activa = abiertaComoApp();

  // Poner el tope: una entrada igual a la actual, encima de la actual.
  useEffect(() => {
    if (!activa || tope !== null) return;
    const idx = idxActual();
    if (idx === null) return;
    tope = idx;
    navigate(`${location.pathname}${location.search}${location.hash}`, { state: location.state });
    // Solo al montar: el tope se pone una vez y queda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);

  // ¿"Atrás" llegó al tope? Volver arriba y preguntar. Si el cartel ya
  // estaba abierto, "atrás" lo cierra (como cualquier ventana en Android).
  useEffect(() => {
    if (!activa || tope === null) return;
    const idx = idxActual();
    if (idx === null) return;
    if (idx > tope) { topePuesto = true; return; }
    if (!topePuesto) return;
    setNoSeCerro(false);
    setPreguntando((abierto) => !abierto);
    navigate(1);
  }, [activa, location.key, navigate]);

  const salir = () => {
    // En la app instalada esto cierra la ventana en la mayoría de los
    // teléfonos. Si el sistema no lo deja, se avisa cómo salir: NO se sigue
    // "atrás", que llevaría a la pantalla de Google.
    window.close();
    setTimeout(() => setNoSeCerro(true), 400);
  };

  const quedarse = () => {
    setPreguntando(false);
    setNoSeCerro(false);
  };

  return { preguntando, noSeCerro, salir, quedarse };
}
