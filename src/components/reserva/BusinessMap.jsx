import { useState } from 'react';
import { useUbicacionDelMapa } from '../../hooks/useUbicacionDelMapa';
import { linkComoLlegar } from '../../utils/linkComoLlegar';
import Icon from '../Icon';

// Mapa del negocio en su link. Lo usan la reserva (BookingPage) y la página
// exclusiva (src/paginas-exclusivas), que arma su propio marco con
// `hooks/useUbicacionDelMapa`.

// ---- MAPA ----
// Vista previa del mapa (embed de Google Maps, sin API key) centrada en la
// ubicación real del negocio, que abre su link al tocarla, más la dirección
// como texto plano: se puede seleccionar o copiar con el botón, pero no lleva
// a ningún lado — para eso está "Cómo llegar". Sin link de Maps cargado, no
// se muestra nada (ver linkComoLlegar).
export default function BusinessMap({ business }) {
  const [copiado, setCopiado] = useState(false);
  const { consulta, ftid, cargando } = useUbicacionDelMapa(business);
  const comoLlegar = linkComoLlegar(business);
  if (!comoLlegar || (!consulta && !cargando)) return null;
  const dir = business.address?.trim();

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(dir);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin permiso de portapapeles: igual se puede seleccionar a mano */ }
  };

  return (
    <section className="business-map">
      <div className="business-map-frame">
        {consulta && (
          <iframe
            title={`Mapa de ${business.name}`}
            src={`https://maps.google.com/maps?q=${encodeURIComponent(consulta)}${ftid ? `&ftid=${encodeURIComponent(ftid)}` : ''}&z=16&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            tabIndex={-1}
          />
        )}
        {/* Capa encima del iframe: el toque abre el link del negocio, no el
            buscador de Google con la dirección tipeada. */}
        <a
          href={comoLlegar}
          target="_blank"
          rel="noreferrer"
          className="business-map-overlay"
          aria-label={`Abrir la ubicación de ${business.name} en Google Maps`}
        >
          <span className="business-map-chip"><Icon name="navigation" /> Ver en Google Maps</span>
        </a>
      </div>

      <div className="business-map-footer">
        <span className="business-map-pin"><Icon name="pin" /></span>
        <div className="business-map-text">
          <span className="business-map-label">Dónde estamos</span>
          {dir && <span className="business-map-address">{dir}</span>}
        </div>
        {dir && (
          <button type="button" className="business-map-copy" onClick={copiar} title="Copiar dirección">
            <Icon name={copiado ? 'check' : 'copy'} />
            <span>{copiado ? 'Copiada' : 'Copiar'}</span>
          </button>
        )}
        <a href={comoLlegar} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm business-map-go">
          <Icon name="navigation" /> Cómo llegar
        </a>
      </div>
    </section>
  );
}
