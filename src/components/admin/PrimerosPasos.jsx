import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePrimerosPasos } from '../../hooks/usePrimerosPasos';
import { ocultarGuia, marcarLinkCompartido, retomarFlujo, rutaDelPaso } from '../../utils/primerosPasos';
import Icon from '../Icon';

/**
 * Guía de primeros pasos para el dueño que recién arranca: servicio →
 * profesional → servicios y horarios → datos del negocio → compartir el link.
 *
 *   variante="inicio"  → la lista completa, arriba de la agenda en Inicio.
 *   variante="pagina"  → una línea con el paso en curso, arriba de Servicios,
 *                        Profesionales y Configuración, para que al terminar
 *                        algo ahí se vea cuál sigue sin volver a Inicio.
 *
 * Solo para el dueño, y se va sola cuando todo está hecho (o si la oculta).
 * Tocar un botón de acá retoma el flujo guiado si se había cortado (ver
 * FlujoPrimerosPasos, que es el que pasa de un paso al siguiente).
 */
export default function PrimerosPasos({ variante = 'inicio' }) {
  const { aplica, pasos, actual, hechos, businessId, business, terminology } = usePrimerosPasos();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [copiado, setCopiado] = useState(false);

  if (!aplica || !actual) return null;
  const linkPublico = `${window.location.origin}/${business?.slug || ''}`;

  const hacer = async (paso) => {
    retomarFlujo(businessId);
    if (paso.accion === 'copiar') {
      try { await navigator.clipboard.writeText(linkPublico); } catch { /* sin portapapeles: el link está a la vista */ }
      marcarLinkCompartido(businessId);
      setCopiado(true);
      return;
    }
    navigate(paso.ir);
  };

  // Los pasos que falten quedan como estaban: esto solo deja de mostrar la guía.
  const ocultar = () => {
    if (!window.confirm('¿Dejar de mostrar la guía de primeros pasos? Lo que falta lo podés completar igual desde el menú.')) return;
    ocultarGuia(businessId);
  };

  if (variante === 'pagina') {
    const aca = actual.ir && pathname === rutaDelPaso(actual);
    return (
      <div className="guia-linea">
        <span className="guia-linea-paso">Primeros pasos · {hechos + 1} de {pasos.length}</span>
        <span className="guia-linea-texto">
          {aca ? <>Estás acá: <strong>{actual.titulo.toLowerCase()}</strong></> : <>Sigue: <strong>{actual.titulo.toLowerCase()}</strong></>}
        </span>
        {!aca && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => hacer(actual)}>
            {actual.boton} →
          </button>
        )}
        <button type="button" className="guia-linea-cerrar" onClick={ocultar} title="No mostrar más la guía" aria-label="No mostrar más la guía">
          <Icon name="x" />
        </button>
      </div>
    );
  }

  return (
    <div className="card guia">
      <div className="guia-cabecera">
        <div>
          <h3>Primeros pasos</h3>
          <p className="text-secondary text-sm">Dejá tu negocio listo para tomar {terminology.appointmentNoun}s. Te lleva unos minutos.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={ocultar} title="No mostrar más">Ocultar</button>
      </div>

      <div className="guia-progreso" aria-label={`${hechos} de ${pasos.length} pasos hechos`}>
        <div style={{ width: `${(hechos / pasos.length) * 100}%` }} />
      </div>

      <ol className="guia-pasos">
        {pasos.map((paso, i) => {
          const esActual = paso === actual;
          return (
            <li key={paso.id} className={`guia-paso ${paso.hecho ? 'hecho' : ''} ${esActual ? 'actual' : ''}`}>
              <span className="guia-numero">{paso.hecho ? <Icon name="check" /> : i + 1}</span>
              <div className="guia-cuerpo">
                <strong>{paso.titulo}</strong>
                {esActual && <p className="text-sm text-secondary">{paso.detalle}</p>}
                {esActual && paso.accion === 'copiar' && (
                  <p className="text-sm guia-link">{linkPublico}</p>
                )}
              </div>
              {esActual && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => hacer(paso)}>
                  {paso.accion === 'copiar' && copiado ? <><Icon name="check" /> Copiado</> : paso.boton}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
