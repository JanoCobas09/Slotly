import Icon from '../Icon';

// Mismo número que el resto del panel y la landing. Si cambia, cambia en todos.
const WHATSAPP_NUMBER = '5492257660073';
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
  'Hola, quiero consultar sobre la plataforma para mi negocio.'
)}`;

/** Botón flotante de contacto por WhatsApp, fijo en la esquina de la landing. */
export default function FloatingActionWidget() {
  return (
    <a
      href={WHATSAPP_LINK}
      target="_blank"
      rel="noreferrer"
      className="fab-container fab-main-btn"
      aria-label="Hablar por WhatsApp"
      title="Hablamos por WhatsApp"
    >
      <span className="fab-pulse-ring" />
      <Icon name="chat" />
    </a>
  );
}
