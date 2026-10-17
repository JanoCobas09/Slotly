import { lazy, Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../hooks/useTenantData';
import { marcaDe } from './index';

const PaginaMarca = lazy(() => import('./marca/PaginaMarca'));

/**
 * Pinta la página de marca del negocio del link (ver `index.js`). Quien la
 * usa pregunta antes con `paginaExclusiva()`; si no hay, no pinta nada.
 *
 * Va sin el encabezado ni el pie de Slotly: es la página del negocio, no una
 * pantalla del producto. La plantilla pone abajo su línea chica de "Hecho con
 * Slotly".
 */
export default function PaginaExclusiva() {
  const navigate = useNavigate();
  const { business, businessId, services, professionals, professionalServices, slug } = useTenant();
  const marca = marcaDe(businessId);

  useEffect(() => {
    if (!business?.name) return;
    const anterior = document.title;
    document.title = `${business.name} — Reservá tu turno`;
    return () => { document.title = anterior; };
  }, [business?.name]);

  if (!marca || !business) return null;

  // Los mismos que ofrece la reserva (ServiceSelect en BookingPage): solo los
  // que hace al menos un profesional activo, con "desde" cuando el precio o
  // la duración cambian según quién atiende.
  const activos = new Set((professionals || []).filter((p) => p.isActive).map((p) => p.id));
  const servicios = (services || []).filter((s) => s.isActive).map((s) => {
    const opciones = (professionalServices || [])
      .filter((ps) => ps.serviceId === s.id && activos.has(ps.professionalId))
      .map((ps) => ({ precio: ps.customPrice || s.price, duracion: ps.customDuration || s.durationMinutes }));
    if (opciones.length === 0) return null;
    const precios = opciones.map((o) => o.precio);
    const duraciones = opciones.map((o) => o.duracion);
    return {
      ...s,
      price: Math.min(...precios),
      variaPrecio: new Set(precios).size > 1,
      durationMinutes: Math.min(...duraciones),
      durMax: Math.max(...duraciones),
    };
  }).filter(Boolean);
  // Con un id, la reserva entra con ese servicio ya elegido (?servicio=).
  const onReservar = (servicioId) => {
    const qs = typeof servicioId === 'string' && servicioId ? `?servicio=${encodeURIComponent(servicioId)}` : '';
    navigate(`/${slug}/reservar${qs}`);
  };

  return (
    <Suspense fallback={<div className="cargando-negocio" role="status"><div className="spinner" aria-hidden="true" /></div>}>
      <PaginaMarca marca={marca} business={business} servicios={servicios} slug={slug} onReservar={onReservar} />
    </Suspense>
  );
}
