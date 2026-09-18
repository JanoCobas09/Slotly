import { useEffect, useMemo } from 'react';
import { useResolvedBusiness } from './useCurrentBusiness';
import { resolveBusinessContext } from '../lib/resolveBusinessContext';
import { applyTheme } from '../config/theme';

/**
 * Terminología, tema y servicios sugeridos del negocio activo, ya resueltos
 * (preset de su `professionCategory` + lo que el negocio haya personalizado).
 *
 * Es el único punto que los componentes deberían usar para dejar de asumir
 * "barbería": en vez de escribir "Peluquero" o "Reservá tu corte" a mano, se
 * lee `terminology.professionalNoun` / `terminology.ctaLabel`.
 *
 * Devuelve el preset `beauty` (la experiencia actual) mientras el negocio
 * todavía no cargó — no hay pantalla en blanco mientras resuelve.
 *
 * También aplica el tema resuelto como custom properties CSS. Antes de esto
 * `applyTheme()` estaba definida pero nadie la llamaba: el color de marca del
 * negocio activo no se pintaba en ningún punto de montaje. Llamarlo acá lo
 * deja conectado en cualquier pantalla que consuma el contexto de negocio.
 */
export function useBusinessContext() {
  const { business } = useResolvedBusiness();
  const resolved = useMemo(() => resolveBusinessContext(business), [business]);

  useEffect(() => {
    applyTheme(resolved.theme);
  }, [resolved.theme]);

  return resolved;
}
