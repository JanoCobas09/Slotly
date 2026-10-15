import { useBusinessContext } from '../../hooks/useBusinessContext';
import { linkComoLlegar } from '../../utils/linkComoLlegar';
import Icon from '../Icon';

// ---- CABECERA DEL NEGOCIO (foto, nombre, colores, contacto) ----
// Es la cara del negocio en su propio link: para el cliente tiene que sentirse
// la agenda de ESE negocio, no la de Slotly. Se ve en todos los pasos — en el
// primero completa (con el mensaje de bienvenida), en los demás compacta para
// no empujar hacia abajo lo que el cliente está eligiendo.
//
// La usan la página de reserva (BookingPage) y la vista previa de
// Configuración → Tu negocio: lo que ve el dueño ahí es esta misma pieza, con
// lo que está escribiendo antes de guardar.
export default function BusinessHero({ business, compacta }) {
  const { icon: rubroIcon, terminology } = useBusinessContext();

  const contacto = [];
  if (business.phone) {
    contacto.push({ key: 'phone', icon: 'phone', label: business.phone, href: `tel:${business.phone.replace(/[^+\d]/g, '')}` });
  }
  const handle = business.socialLinks?.instagram?.trim().replace(/^@/, '');
  if (handle) {
    contacto.push({ key: 'ig', icon: 'instagram', label: `@${handle}`, href: `https://instagram.com/${handle}` });
  }
  const comoLlegar = linkComoLlegar(business);
  if (comoLlegar) {
    contacto.push({ key: 'maps', icon: 'pin', label: 'Cómo llegar', href: comoLlegar });
  }

  return (
    <section className={`business-hero ${compacta ? 'compacta' : ''}`}>
      <div className="business-hero-band" aria-hidden="true" />
      <div className="business-hero-body">
        <div className="business-hero-photo">
          {business.logoUrl
            ? <img src={business.logoUrl} alt={business.name} />
            : <Icon name={rubroIcon} size={compacta ? 26 : 40} />}
        </div>
        <div className="business-hero-text">
          <h1>{business.name}</h1>
          {!compacta && (
            <p className="business-hero-cta">
              {business.welcomeMessage?.trim() || terminology.ctaLabel}
            </p>
          )}
        </div>
        {contacto.length > 0 && (
          <div className="business-hero-contact">
            {contacto.map((it) => (
              <a key={it.key} href={it.href} target="_blank" rel="noreferrer" className="booking-contact-item">
                <Icon name={it.icon} /> {it.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
