import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { pasosDeConfiguracion, guiaOculta, ocultarGuia, marcarLinkCompartido } from '../../utils/primerosPasos';
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
 */
export default function PrimerosPasos({ variante = 'inicio' }) {
  const { user } = useAuth();
  const tenant = useTenant();
  const { terminology } = useBusinessContext();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { businessId, business } = tenant;
  const [, forzar] = useState(0);
  const [copiado, setCopiado] = useState(false);

  // Los datos del negocio llegan un instante después de montar: sin esta
  // espera, un negocio ya configurado veía la guía "incompleta" un segundo.
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setListo(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (user?.role !== 'owner' || !businessId || !listo || guiaOculta(businessId)) return null;

  const pasos = pasosDeConfiguracion({ ...tenant, terminology });
  const hechos = pasos.filter((p) => p.hecho).length;
  if (hechos === pasos.length) return null;
  const actual = pasos.find((p) => !p.hecho);
  const linkPublico = `${window.location.origin}/${business?.slug || ''}`;

  const hacer = async (paso) => {
    if (paso.accion === 'copiar') {
      try { await navigator.clipboard.writeText(linkPublico); } catch { /* sin portapapeles: el link está a la vista */ }
      marcarLinkCompartido(businessId);
      setCopiado(true);
      forzar((n) => n + 1);
      return;
    }
    navigate(paso.ir);
  };

  const ocultar = () => {
    ocultarGuia(businessId);
    forzar((n) => n + 1);
  };

  if (variante === 'pagina') {
    const aca = actual.ir && pathname === actual.ir.split('?')[0];
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
