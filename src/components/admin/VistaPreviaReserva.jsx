import { useMemo } from 'react';
import BusinessHero from '../reserva/BusinessHero';
import Icon from '../Icon';
import { defaultTheme } from '../../config/theme';
import { necesitaTextoOscuro } from '../../utils/colorUtils';
import { formatPrice } from '../../utils/dateUtils';

/**
 * Vista previa REAL de la página de reserva, para Configuración → Tu negocio:
 * la misma cabecera (BusinessHero) y las mismas tarjetas de servicio que ve
 * el cliente en su link, con lo que el dueño está escribiendo — foto, nombre,
 * mensaje, contacto y colores — antes de guardar.
 *
 * Los colores se pintan solo adentro del marco (variables CSS en línea), sin
 * tocar el tema del panel: así se ven al instante y, si no guarda, nada
 * cambió. Adentro no se puede tocar nada (es una imagen de cómo queda); para
 * la página de verdad está "Abrir mi página de reservas".
 */
export default function VistaPreviaReserva({ negocio, services, professionals, professionalServices }) {
  const primario = negocio.primaryColor || defaultTheme.primaryColor;
  const colores = {
    '--primary': primario,
    '--secondary': negocio.secondaryColor || defaultTheme.secondaryColor,
    '--on-primary': necesitaTextoOscuro(primario) ? defaultTheme.textColor : '#ffffff',
    '--primary-light': `color-mix(in srgb, ${primario} 14%, white)`,
  };

  // Lo mismo que ofrece el paso 1 de la reserva: servicios activos que hace
  // al menos un profesional activo. Los primeros tres alcanzan para verlo.
  const ofrecidos = useMemo(() => {
    const activos = new Set(professionals.filter((p) => p.isActive !== false).map((p) => p.id));
    return services
      .filter((s) => s.isActive !== false
        && professionalServices.some((ps) => ps.serviceId === s.id && activos.has(ps.professionalId)))
      .slice(0, 3);
  }, [services, professionals, professionalServices]);

  return (
    <div className="vista-previa">
      <div className="vista-previa-marco" aria-label="Vista previa de tu página de reservas">
        <div className="vista-previa-barra" aria-hidden="true">
          <span className="vista-previa-puntos"><i /><i /><i /></span>
          <span className="vista-previa-url">slotly-turnos.vercel.app/{negocio.slug}</span>
        </div>
        <div className="vista-previa-pantalla" style={colores} inert>
          <div className="booking-container vista-previa-reserva">
            <BusinessHero business={negocio} />
            <h2 className="booking-step-title">Elegí un servicio</h2>
            <p className="booking-step-subtitle">¿Qué te querés hacer?</p>
            {ofrecidos.length > 0 ? (
              <div className="services-list">
                {ofrecidos.map((s) => (
                  <div key={s.id} className="card card-selectable service-card">
                    <div className="service-info">
                      <h3>{s.name}</h3>
                      {s.description && <p>{s.description}</p>}
                    </div>
                    <div className="service-meta">
                      <div className="service-price">{formatPrice(s.price, negocio.currency)}</div>
                      <div className="service-duration"><Icon name="clock" /> {s.durationMinutes} min</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted" style={{ textAlign: 'center' }}>
                Acá van a aparecer tus servicios cuando los cargues en Servicios y los asignes a un profesional.
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted vista-previa-nota">
        Lo que cambies se ve acá al instante. En tu link, recién después de tocar <strong>Guardar cambios</strong>.
      </p>
      {negocio.slug && (
        <a className="btn btn-outline btn-sm vista-previa-abrir" href={`/${negocio.slug}`} target="_blank" rel="noreferrer">
          <Icon name="link" /> Abrir mi página de reservas
        </a>
      )}
    </div>
  );
}
