import { Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenantData';
import { PAGINAS } from './index';

/**
 * Pinta la página exclusiva del negocio del link (ver `index.js`). Quien la
 * usa pregunta antes con `paginaExclusiva()`; si no hay, no pinta nada.
 *
 * Va sin el encabezado ni el pie de Slotly: es la página del negocio, no una
 * pantalla del producto. Cada página pone su propia línea chica de "Hecho
 * con Slotly" abajo.
 *
 * Props que recibe cada página:
 *   business   el negocio (nombre, logo, colores, horarios, redes, Maps…)
 *   servicios  los servicios activos, ordenados como en el panel
 *   slug       para armar links (`/${slug}/mis-citas`)
 *   onReservar(servicioId?)  entra a la reserva; con un id, ese servicio ya
 *              viene elegido
 */
export default function PaginaExclusiva() {
  const navigate = useNavigate();
  const { business, businessId, services, slug } = useTenant();
  const Pagina = PAGINAS[businessId];

  useEffect(() => {
    if (!business?.name) return;
    const anterior = document.title;
    document.title = `${business.name} — Reservá tu turno`;
    return () => { document.title = anterior; };
  }, [business?.name]);

  if (!Pagina) return null;

  const servicios = (services || []).filter((s) => s.isActive !== false);
  const onReservar = (servicioId) => {
    const qs = typeof servicioId === 'string' && servicioId ? `?servicio=${encodeURIComponent(servicioId)}` : '';
    navigate(`/${slug}/reservar${qs}`);
  };

  return (
    <Suspense fallback={<div className="cargando-negocio" role="status"><div className="spinner" aria-hidden="true" /></div>}>
      <Pagina business={business} servicios={servicios} slug={slug} onReservar={onReservar} />
    </Suspense>
  );
}
