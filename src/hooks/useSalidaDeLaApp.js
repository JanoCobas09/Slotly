import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { abiertaComoApp } from '../lib/splash';

// ============================================================================
// Botón "atrás" del celular en la app instalada
// ============================================================================
// Dos problemas que resolver:
//   1. Después de entrar con Google, debajo del panel en el historial quedan
//      /login y el selector de cuentas de Google: "atrás" terminaba ahí.
//   2. Al llegar al principio hay que preguntar "¿Querés salir?" y, si dice
//      que sí, cerrar la app. Android solo deja que una página se cierre sola
//      (window.close) si su historial tiene UNA entrada.
//
// Modo Android (CloseWatcher, Chrome 120+): CloseWatcher atrapa el botón
// atrás SIN necesitar entradas en el historial. Mientras se está en el
// panel, moverse entre pantallas reemplaza la entrada actual en vez de
// sumar una (así el historial no crece y window.close puede funcionar), y el
// panel lleva su propia pila de pantallas visitadas: "atrás" vuelve por esa
// pila y, al llegar al principio, pregunta. Excepción: justo después de
// iniciar sesión el historial ya trae las pantallas de Google y el sistema
// no deja cerrar; pasa solo esa vez (al volver a abrir la app, el historial
// arranca limpio).
//
// Resto (sin CloseWatcher, o fuera de Android): un "tope" en el historial
// (se duplica la entrada al abrir el panel) y el cartel aparece al volver a
// él. Ahí no se puede cerrar la app, pero tampoco se cae en la de Google.
//
// En una pestaña del navegador no se toca nada: "atrás" sale del sitio como
// siempre.

const esAndroid = () => /android/i.test(navigator.userAgent || '');
const conCloseWatcher = () => typeof window !== 'undefined' && 'CloseWatcher' in window;

// ── Modo tope (respaldo) ──────────────────────────────────────────────────
// Posición (idx de React Router) de la entrada que queda debajo del panel.
// A nivel de módulo: una vez por carga de página.
let tope = null;
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
  const modoWatcher = activa && esAndroid() && conCloseWatcher();
  const modoTope = activa && !modoWatcher;

  // Pila propia de pantallas del panel (modo Android).
  const pila = useRef([]);
  const volviendo = useRef(false);
  const preguntandoRef = useRef(false);
  useEffect(() => { preguntandoRef.current = preguntando; }, [preguntando]);

  // ── Modo Android: el historial no crece dentro del panel ────────────────
  useEffect(() => {
    if (!modoWatcher) return undefined;
    const original = window.history.pushState;
    window.history.pushState = function pushStateEnElPanel(state, titulo, url) {
      const destino = new URL(url ?? window.location.href, window.location.href);
      if (destino.origin === window.location.origin && destino.pathname.startsWith('/admin')) {
        return window.history.replaceState(state, titulo, url);
      }
      return original.call(window.history, state, titulo, url);
    };
    return () => { window.history.pushState = original; };
  }, [modoWatcher]);

  // Cada pantalla nueva entra a la pila (salvo cuando se está volviendo).
  useEffect(() => {
    if (!modoWatcher) return;
    const actual = `${location.pathname}${location.search}`;
    if (volviendo.current) { volviendo.current = false; return; }
    if (pila.current[pila.current.length - 1] !== actual) pila.current.push(actual);
  }, [modoWatcher, location.pathname, location.search]);

  const alApretarAtras = useCallback(() => {
    if (preguntandoRef.current) {
      setPreguntando(false);
      setNoSeCerro(false);
      return;
    }
    if (pila.current.length > 1) {
      pila.current.pop();
      volviendo.current = true;
      navigate(pila.current[pila.current.length - 1], { replace: true });
      return;
    }
    setNoSeCerro(false);
    setPreguntando(true);
  }, [navigate]);

  // Un CloseWatcher atrapa UN toque de "atrás": después de cada uno se crea
  // otro para el siguiente.
  useEffect(() => {
    if (!modoWatcher) return undefined;
    let vigente = null;
    let desmontado = false;
    const armar = () => {
      if (desmontado) return;
      try {
        vigente = new window.CloseWatcher();
        vigente.onclose = () => { alApretarAtras(); armar(); };
      } catch {
        vigente = null;
      }
    };
    armar();
    return () => { desmontado = true; vigente?.destroy(); };
  }, [modoWatcher, alApretarAtras]);

  // ── Modo tope (respaldo) ────────────────────────────────────────────────
  useEffect(() => {
    if (!modoTope || tope !== null) return;
    const idx = idxActual();
    if (idx === null) return;
    tope = idx;
    navigate(`${location.pathname}${location.search}${location.hash}`, { state: location.state });
    // Solo al montar: el tope se pone una vez y queda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoTope]);

  useEffect(() => {
    if (!modoTope || tope === null) return;
    const idx = idxActual();
    if (idx === null) return;
    if (idx > tope) { topePuesto = true; return; }
    if (!topePuesto) return;
    setNoSeCerro(false);
    setPreguntando((abierto) => !abierto);
    navigate(1);
  }, [modoTope, location.key, navigate]);

  const salir = () => {
    // Con el historial en una sola entrada, Android deja cerrar. Si no lo
    // deja (recién iniciada la sesión, o sin CloseWatcher), se explica cómo
    // salir: NO se sigue "atrás", que llevaría a la pantalla de Google.
    window.close();
    setTimeout(() => setNoSeCerro(true), 400);
  };

  const quedarse = () => {
    setPreguntando(false);
    setNoSeCerro(false);
  };

  return { preguntando, noSeCerro, salir, quedarse };
}
