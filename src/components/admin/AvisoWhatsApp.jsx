import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { updateAppointment } from '../../lib/repository';
import { avisoQueCorresponde, mensajeAviso, linkAviso, textoBoton } from '../../utils/avisosWhatsApp';
import { datosDe, hayVariasSucursales, nombreSucursal } from '../../utils/sucursales';
import Icon from '../Icon';

/**
 * Botón de aviso por WhatsApp al cliente de un turno. Antes del día anterior
 * ofrece la confirmación ("Agendaste..."); desde las 00:00 del día anterior
 * hasta que empieza, el recordatorio. Abre WhatsApp con el mensaje armado y
 * anota en el turno que se mandó (el envío es a mano: si se cierra WhatsApp
 * sin mandar, queda marcado igual — tocándolo de nuevo se vuelve a abrir).
 * Lo usan la agenda (Inicio / Hoy) y Citas.
 */
export default function AvisoWhatsApp({ apt }) {
  const { businessId, business, professionals, services, branches } = useTenant();
  const { terminology } = useBusinessContext();

  const tipo = avisoQueCorresponde(apt);
  if (!tipo) return null;

  const campo = tipo === 'recordatorio' ? 'whatsappRecordatorioAt' : 'whatsappConfirmacionAt';
  const enviado = Boolean(apt[campo]);
  const branch = (branches || []).find((b) => b.id === apt.branchId);
  const mensaje = mensajeAviso(tipo, {
    apt,
    business,
    terminology,
    profesional: (professionals || []).find((p) => p.id === apt.professionalId),
    servicio: (services || []).find((s) => s.id === apt.serviceId),
    direccion: datosDe(branch, business).address,
    sucursal: hayVariasSucursales(branches) ? nombreSucursal(branches, apt.branchId) : '',
  });
  const link = linkAviso(apt.clientPhone, mensaje);

  const enviar = () => {
    if (!link) return;
    if (enviado && !window.confirm('Ya lo marcaste como enviado. ¿Abrir WhatsApp de nuevo?')) return;
    // Primero la ventana (dentro del click, si no el navegador la bloquea) y
    // después la marca.
    window.open(link, '_blank', 'noopener');
    if (enviado) return;
    updateAppointment(businessId, apt.id, { [campo]: new Date().toISOString() }).catch((err) => {
      console.error('[AvisoWhatsApp] No se pudo marcar el aviso:', err);
      alert('Se abrió WhatsApp, pero no se pudo marcar como enviado: ' + err.message);
    });
  };

  return (
    <button
      type="button"
      className={`btn btn-sm aviso-wa ${enviado ? 'aviso-wa-enviado' : ''}`}
      onClick={(e) => { e.stopPropagation(); enviar(); }}
      disabled={!link}
      title={!link
        ? 'Este turno no tiene un teléfono cargado'
        : enviado ? 'Ya enviado — tocá para volver a abrir WhatsApp' : 'Abre WhatsApp con el mensaje listo para mandar'}
    >
      <Icon name={enviado ? 'check' : 'whatsapp'} /> {textoBoton(tipo, enviado)}
    </button>
  );
}
