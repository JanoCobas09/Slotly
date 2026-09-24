import { useLocation, Link } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { capitalize } from '../../utils/text';
import Icon from '../../components/Icon';

export default function ConfirmationPage() {
  const location = useLocation();
  const { professionals, services, business, slug } = useTenant();
  const { terminology } = useBusinessContext();
  const appointment = location.state?.appointment;
  const home = `/${slug}`;

  if (!appointment) {
    return (
      <div className="confirmation-container">
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="question" /></div>
          <p>No se encontró información de la reserva</p>
          <Link to={home} className="btn btn-primary mt-lg">Reservar una cita</Link>
        </div>
      </div>
    );
  }

  const professional = professionals.find(p => p.id === appointment.professionalId);
  const service = services.find(s => s.id === appointment.serviceId);

  return (
    <div className="confirmation-container">
      <div className="confirmation-icon"><Icon name="check" /></div>
      {/* Nace 'pendiente': el negocio lo confirma. Decir "confirmada" acá y
          que el staff lo vea como pendiente confundía a los dos. */}
      <h1>¡{capitalize(terminology.appointmentNoun)} reservado!</h1>
      <p className="text-secondary mt-sm mb-lg">{terminology.confirmationMsg}</p>

      <div className="summary-card" style={{ textAlign: 'left' }}>
        <div className="summary-body">
          <div className="summary-row">
            <span className="summary-label"><Icon name="user" /> Profesional</span>
            <span className="summary-value">{professional?.name}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label"><Icon name="clipboard" /> Servicio</span>
            <span className="summary-value">{service?.name}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label"><Icon name="calendar" /> Fecha</span>
            <span className="summary-value">{formatDate(appointment.appointmentDate)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label"><Icon name="clock" /> Horario</span>
            <span className="summary-value">{appointment.startTime} — {appointment.endTime}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label"><Icon name="money" /> Precio</span>
            <span className="summary-value">{formatPrice(appointment.price, business?.currency)}</span>
          </div>
          {appointment.notes && (
            <div className="summary-row">
              <span className="summary-label"><Icon name="note" /> Datos</span>
              <span className="summary-value">{appointment.notes}</span>
            </div>
          )}
        </div>
      </div>

      <div className="confirmation-actions">
        <Link to={`${home}/mis-citas`} className="btn btn-primary"><Icon name="calendar" /> Ver Mis Citas</Link>
        <Link to={home} className="btn btn-outline">Reservar Otra Cita</Link>
      </div>

      <p className="text-sm text-muted mt-lg" style={{ textAlign: 'center' }}>
        <Icon name="mail" /> Te enviamos la confirmación por mail. Si no la ves,
        revisá la carpeta de spam.
      </p>

      <div className="future-feature mt-md" style={{ justifyContent: 'center' }}>
        <Icon name="phone" /> Próximamente: confirmación por WhatsApp
      </div>
    </div>
  );
}
