import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from './useTenantData';
import { useBusinessContext } from './useBusinessContext';
import { pasosDeConfiguracion, guiaOculta, escucharGuia } from '../utils/primerosPasos';

/**
 * Estado de la guía de Primeros pasos, compartido por la guía que se ve
 * (PrimerosPasos) y la que lleva de un paso al siguiente (FlujoPrimerosPasos).
 *
 * `aplica` es false para quien no es dueño, si la ocultó, o durante el primer
 * instante: los datos del negocio llegan un momento después de montar, y sin
 * esa espera un negocio ya configurado se veía "incompleto" un segundo.
 */
export function usePrimerosPasos() {
  const { user } = useAuth();
  const tenant = useTenant();
  const { terminology } = useBusinessContext();

  // Se vuelve a calcular cuando cambia algo que vive fuera del estado de
  // React (ocultar, link copiado, flujo cortado).
  const [, setVersion] = useState(0);
  useEffect(() => escucharGuia(() => setVersion((v) => v + 1)), []);

  const [listo, setListo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setListo(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const { businessId } = tenant;
  const aplica = user?.role === 'owner' && Boolean(businessId) && listo && !guiaOculta(businessId);
  const pasos = aplica ? pasosDeConfiguracion({ ...tenant, terminology }) : [];
  const actual = pasos.find((p) => !p.hecho) || null;

  return {
    aplica,
    pasos,
    actual,
    indice: actual ? pasos.indexOf(actual) : pasos.length,
    hechos: pasos.filter((p) => p.hecho).length,
    businessId,
    business: tenant.business,
    terminology,
  };
}
