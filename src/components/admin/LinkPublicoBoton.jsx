import { useEffect, useRef, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { marcarLinkCompartido } from '../../utils/primerosPasos';
import Icon from '../Icon';

/**
 * "Link para tus clientes", al lado de "Agendar" (Inicio y Citas): el link
 * público de reserva a mano, sin tener que buscarlo en Primeros pasos o en
 * Sucursales. Abre un panelcito con el link, copiar, mandarlo por WhatsApp y
 * abrirlo para ver lo que ve el cliente.
 *
 * Es el link general del negocio: con varias sucursales, el cliente elige la
 * suya al entrar. El de cada sucursal está en Sucursales.
 */
export default function LinkPublicoBoton() {
  const { business, businessId, slug } = useTenant();
  const { terminology } = useBusinessContext();
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const ref = useRef(null);

  // Se cierra tocando afuera o con Escape.
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!ref.current?.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [abierto]);

  const slugNegocio = slug || business?.slug;
  if (!slugNegocio) return null;
  const link = `${window.location.origin}/${slugNegocio}`;

  // Cualquiera de las tres cuenta como "compartí el link" para Primeros pasos.
  const compartido = () => { if (businessId) marcarLinkCompartido(businessId); };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copiá el link:', link);
    }
    compartido();
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const mensaje = `Reservá tu ${terminology.appointmentNoun} en ${business?.name || 'nuestro negocio'} desde acá: ${link}`;

  return (
    <div className="link-publico" ref={ref}>
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
      >
        <Icon name="link" /> Link para tus clientes
      </button>
      {abierto && (
        <div className="link-publico-panel" role="dialog" aria-label="Link público de reserva">
          <p className="text-sm text-secondary">
            Mandalo a tus {terminology.customerNoun}s para que reserven solos.
          </p>
          <div className="link-publico-url">{link}</div>
          <div className="link-publico-acciones">
            <button type="button" className="btn btn-primary btn-sm" onClick={copiar}>
              {copiado ? <><Icon name="check" /> Copiado</> : <><Icon name="copy" /> Copiar</>}
            </button>
            <a
              className="btn btn-outline btn-sm"
              href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={compartido}
            >
              <Icon name="send" /> WhatsApp
            </a>
            <a className="btn btn-ghost btn-sm" href={link} target="_blank" rel="noopener noreferrer">
              Ver cómo se ve
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
