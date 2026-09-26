import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePrimerosPasos } from '../../hooks/usePrimerosPasos';
import { flujoCortado, cortarFlujo, rutaDelPaso } from '../../utils/primerosPasos';

// Un respiro antes de cambiar de pantalla: el alta de un profesional se guarda
// en varios pasos y el modal tiene que llegar a cerrarse.
const ESPERA_MS = 900;

/**
 * Lleva al dueño de un paso de la guía al siguiente, sin dibujar nada. Vive
 * en AdminLayout para seguir montado mientras cambia de pantalla.
 *
 * - Terminó un paso en su pantalla → va a la del próximo pendiente (con el
 *   formulario de alta abierto, ?nuevo=1).
 * - Vuelve a un paso anterior a corregir → se puede; al terminar, sigue desde
 *   el primero que quede pendiente.
 * - Se va a otra sección → el flujo se corta (ver cortarFlujo) y usa el
 *   sistema normal; los pasos quedan pendientes en la guía.
 *
 * Solo avanza si el paso se completó estando en SU pantalla: si los datos
 * llegan tarde mientras la persona está en otra, no la saca de ahí.
 */
export default function FlujoPrimerosPasos() {
  const { aplica, pasos, actual, indice, businessId } = usePrimerosPasos();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const anterior = useRef(null);

  // Avanzar al terminar un paso.
  useEffect(() => {
    if (!aplica) { anterior.current = null; return undefined; }
    const previo = anterior.current;
    anterior.current = indice;
    if (previo === null || indice <= previo || !actual || flujoCortado(businessId)) return undefined;
    if (pathname !== rutaDelPaso(pasos[previo])) return undefined;
    const destino = actual.ir || '/admin';
    if (rutaDelPaso(actual) === pathname) return undefined;
    const t = setTimeout(() => navigate(destino), ESPERA_MS);
    return () => clearTimeout(t);
    // Solo cuando cambia el paso en curso: la navegación no lo dispara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aplica, indice]);

  // Cortar si se va a otra sección. Inicio (donde está la guía) y las
  // pantallas de los pasos hasta el actual siguen dentro del flujo.
  useEffect(() => {
    if (!aplica || !actual || flujoCortado(businessId)) return;
    const permitidas = new Set(['/admin', ...pasos.slice(0, indice + 1).map(rutaDelPaso)]);
    if (!permitidas.has(pathname)) cortarFlujo(businessId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, aplica]);

  return null;
}
