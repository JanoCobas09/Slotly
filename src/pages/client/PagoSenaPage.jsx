import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { estadoSena } from '../../lib/functions';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import { capitalize } from '../../utils/text';
import Icon from '../../components/Icon';

const CADA_CUANTO_MS = 4000;

/**
 * Seguimiento de la seña de un turno: /:slug/pago?turno=<id>.
 *
 * Se llega de dos maneras, y las dos tienen que mostrar lo mismo:
 *   - La pestaña (o la app instalada) donde el cliente reservó: al tocar
 *     "Pagar seña" Mercado Pago se abre en otra pestaña y ESTA queda acá,
 *     esperando. Cuando MP acredita el pago, pasa sola a "confirmado".
 *   - La vuelta desde Mercado Pago (back_url de la preferencia), que puede
 *     caer en otro navegador sin la sesión de Slotly.
 *
 * Por eso no depende de estar logueado: le pregunta el estado al servidor
 * (estado-sena) cada pocos segundos hasta que hay una respuesta final. Si el
 * turno además está en "mis turnos" (hay sesión), ese dato en vivo gana. Los
 * parámetros que agrega MP (`status`...) son solo una pista: lo que vale es
 * el turno en la base, que confirma mp-webhook al verificar el pago con MP.
 */
export default function PagoSenaPage() {
  const [params] = useSearchParams();
  const { appointments, professionals, services, business, slug } = useTenant();
  const { terminology } = useBusinessContext();
  const turnoId = params.get('turno');
  const aprobadoEnMp = (params.get('status') || params.get('collection_status')) === 'approved';
  const home = `/${slug}`;

  // undefined = todavía no respondió el servidor; null = el turno ya no existe.
  const [delServidor, setDelServidor] = useState(undefined);
  const enVivo = appointments.find((a) => a.id === turnoId);
  const esFinal = (t) => t === null || t?.depositStatus === 'pagada' || t?.depositStatus === 'devuelta';
  // Gana el que ya tenga una respuesta final: si la suscripción se perdió un
  // evento, el servidor igual destraba la pantalla (y al revés).
  const apt = esFinal(delServidor) ? delServidor : (enVivo || delServidor);
  const terminado = esFinal(apt);

  useEffect(() => {
    if (!turnoId || terminado) return;
    let vigente = true;
    const consultar = () => estadoSena({ appointmentId: turnoId })
      .then(({ turno }) => { if (vigente) setDelServidor(turno); })
      .catch((err) => console.error('[PagoSenaPage] No se pudo consultar la seña:', err));
    consultar();
    const t = setInterval(consultar, CADA_CUANTO_MS);
    return () => { vigente = false; clearInterval(t); };
  }, [turnoId, terminado]);

  // Para la cuenta regresiva del plazo de pago.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  if (!turnoId) {
    return (
      <Estado icono="question" titulo="No encontramos la reserva">
        <Link to={home} className="btn btn-primary mt-lg">Reservar un {terminology.appointmentNoun}</Link>
      </Estado>
    );
  }

  if (apt === undefined) return <Estado icono="clock" titulo="Buscando tu reserva…" />;

  if (apt === null) {
    return (
      <Estado
        icono="warning"
        titulo="Se venció el tiempo para pagar"
        texto={aprobadoEnMp
          ? 'El pago llegó después de que se liberara el horario. Mercado Pago te devuelve la plata automáticamente.'
          : `No se pagó la seña a tiempo y el horario se liberó. Podés elegir otro ${terminology.appointmentNoun}.`}
      >
        <Link to={home} className="btn btn-primary mt-lg">Reservar de nuevo</Link>
      </Estado>
    );
  }

  const professional = professionals.find((p) => p.id === apt.professionalId);
  const service = services.find((s) => s.id === apt.serviceId);
  const detalle = (
    <div className="summary-card" style={{ textAlign: 'left' }}>
      <div className="summary-body">
        {professional?.name && <Fila icono="user" label="Profesional" valor={professional.name} />}
        <Fila icono="clipboard" label="Servicio" valor={service?.name || apt.serviceName} />
        <Fila icono="calendar" label="Fecha" valor={formatDate(apt.appointmentDate)} />
        <Fila icono="clock" label="Horario" valor={`${apt.startTime} — ${apt.endTime}`} />
        <Fila icono="money" label="Precio" valor={formatPrice(apt.price, business?.currency)} />
        <Fila
          icono="lock"
          label={apt.depositStatus === 'pendiente' ? 'Seña a pagar' : apt.depositStatus === 'devuelta' ? 'Seña (devuelta)' : 'Seña pagada'}
          valor={formatPrice(apt.depositAmount, business?.currency)}
        />
      </div>
    </div>
  );

  if (apt.depositStatus === 'pagada' || apt.depositStatus === 'devuelta') {
    return (
      <div className="confirmation-container">
        <div className="confirmation-icon"><Icon name="check" /></div>
        <h1>¡{capitalize(terminology.appointmentNoun)} confirmado!</h1>
        <p className="text-secondary mt-sm mb-lg">Mercado Pago acreditó tu seña. {terminology.confirmationMsg}</p>
        {detalle}
        <div className="confirmation-actions">
          <Link to={`${home}/mis-citas`} className="btn btn-primary"><Icon name="calendar" /> Ver Mis Citas</Link>
          <Link to={home} className="btn btn-outline">Reservar Otra Cita</Link>
        </div>
        <p className="text-sm text-muted mt-lg" style={{ textAlign: 'center' }}>
          <Icon name="mail" /> Te enviamos la confirmación por mail. Si no la ves, revisá la carpeta de spam.
        </p>
      </div>
    );
  }

  // Esperando la seña.
  const vence = apt.depositExpiresAt ? new Date(apt.depositExpiresAt).getTime() : 0;
  const minutos = Math.max(0, Math.ceil((vence - ahora) / 60000));
  return (
    <div className="confirmation-container">
      <div className="empty-state" style={{ paddingBottom: 'var(--space-md)' }}>
        <div className="empty-state-icon"><Icon name="clock" /></div>
        <h2>{aprobadoEnMp ? 'Confirmando tu pago…' : 'Esperando el pago de la seña'}</h2>
        <p className="text-secondary mt-sm">
          {aprobadoEnMp
            ? 'Mercado Pago aprobó el pago y lo estamos acreditando. Tarda unos segundos.'
            : 'Pagá la seña en Mercado Pago. Cuando se acredite, esta pantalla se actualiza sola.'}
        </p>
        {!aprobadoEnMp && (
          <p className="text-sm text-muted mt-sm">
            {minutos > 0
              ? `Tu horario queda guardado ${minutos === 1 ? '1 minuto' : `${minutos} minutos`} más. Si no se paga, se libera.`
              : 'Se venció el tiempo para pagar: el horario se va a liberar en un momento.'}
          </p>
        )}
      </div>
      {detalle}
      <div className="confirmation-actions">
        {!aprobadoEnMp && minutos > 0 && apt.depositCheckoutUrl && (
          <a href={apt.depositCheckoutUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
            <Icon name="lock" /> Pagar seña ({formatPrice(apt.depositAmount, business?.currency)})
          </a>
        )}
        <Link to={home} className="btn btn-outline">Elegir otro horario</Link>
      </div>
    </div>
  );
}

function Estado({ icono, titulo, texto, children }) {
  return (
    <div className="confirmation-container">
      <div className="empty-state">
        <div className="empty-state-icon"><Icon name={icono} /></div>
        <h2>{titulo}</h2>
        {texto && <p className="text-secondary mt-sm">{texto}</p>}
        {children}
      </div>
    </div>
  );
}

function Fila({ icono, label, valor }) {
  return (
    <div className="summary-row">
      <span className="summary-label"><Icon name={icono} /> {label}</span>
      <span className="summary-value">{valor}</span>
    </div>
  );
}
