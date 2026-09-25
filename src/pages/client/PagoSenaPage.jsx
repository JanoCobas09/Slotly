import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import { capitalize } from '../../utils/text';
import Icon from '../../components/Icon';

/**
 * A dónde vuelve el cliente desde Mercado Pago después de pagar (o no) la
 * seña: /:slug/pago?turno=<id>. MP le agrega sus propios parámetros
 * (`status`, `payment_id`...), pero esos solo sirven de pista: lo que vale
 * es el turno en la base, que confirma mp-webhook después de verificar el
 * pago con MP. El turno llega en vivo (suscripción de "mis turnos"), así que
 * esta pantalla pasa sola de "confirmando" a "confirmado".
 */
export default function PagoSenaPage() {
  const [params] = useSearchParams();
  const { appointments, professionals, services, business, slug } = useTenant();
  const { terminology } = useBusinessContext();
  const turnoId = params.get('turno');
  const estadoMp = params.get('status') || params.get('collection_status');
  const home = `/${slug}`;

  // Los turnos llegan por suscripción: si al entrar todavía no están, se
  // espera un poco antes de decir "no existe" (que es lo que pasa cuando el
  // plazo venció y el horario se liberó).
  const [esperando, setEsperando] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setEsperando(false), 5000);
    return () => clearTimeout(t);
  }, []);

  // Para la cuenta regresiva del plazo de pago.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const apt = appointments.find((a) => a.id === turnoId);
  const aprobadoEnMp = estadoMp === 'approved';

  if (!apt) {
    if (esperando) return <Estado icono="clock" titulo="Buscando tu reserva…" />;
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

  if (apt.depositStatus === 'pagada' || apt.depositStatus === 'devuelta') {
    return (
      <div className="confirmation-container">
        <div className="confirmation-icon"><Icon name="check" /></div>
        <h1>¡{capitalize(terminology.appointmentNoun)} reservado!</h1>
        <p className="text-secondary mt-sm mb-lg">Recibimos tu seña. {terminology.confirmationMsg}</p>
        <div className="summary-card" style={{ textAlign: 'left' }}>
          <div className="summary-body">
            <Fila icono="user" label="Profesional" valor={professional?.name} />
            <Fila icono="clipboard" label="Servicio" valor={service?.name || apt.serviceName} />
            <Fila icono="calendar" label="Fecha" valor={formatDate(apt.appointmentDate)} />
            <Fila icono="clock" label="Horario" valor={`${apt.startTime} — ${apt.endTime}`} />
            <Fila icono="money" label="Precio" valor={formatPrice(apt.price, business?.currency)} />
            <Fila icono="lock" label="Seña pagada" valor={formatPrice(apt.depositAmount, business?.currency)} />
          </div>
        </div>
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

  // Todavía esperando la seña.
  if (aprobadoEnMp) {
    return (
      <Estado
        icono="clock"
        titulo="Confirmando tu pago…"
        texto="Mercado Pago aprobó el pago y estamos terminando de confirmarlo. Esto tarda unos segundos, no cierres esta pantalla."
      />
    );
  }

  const vence = apt.depositExpiresAt ? new Date(apt.depositExpiresAt).getTime() : 0;
  const minutos = Math.max(0, Math.ceil((vence - ahora) / 60000));
  return (
    <Estado
      icono="warning"
      titulo="La seña todavía no se pagó"
      texto={minutos > 0
        ? `Tu horario queda guardado ${minutos === 1 ? '1 minuto' : `${minutos} minutos`} más. Si no se paga, se libera.`
        : 'Se venció el tiempo para pagar: el horario se va a liberar en un momento.'}
    >
      <div className="confirmation-actions">
        {minutos > 0 && apt.depositCheckoutUrl && (
          <a href={apt.depositCheckoutUrl} className="btn btn-primary">
            <Icon name="lock" /> Pagar seña ({formatPrice(apt.depositAmount, business?.currency)})
          </a>
        )}
        <Link to={home} className="btn btn-outline">Elegir otro horario</Link>
      </div>
    </Estado>
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
