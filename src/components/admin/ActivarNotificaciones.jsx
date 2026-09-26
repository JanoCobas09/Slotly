import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { enablePushNotifications, pushSupported, EVENTO_PUSH_ACTIVADO } from '../../lib/push';
import { getEstadoInstalacion } from '../../lib/installPrompt';
import Icon from '../Icon';

// "Ahora no" la esconde una semana en este dispositivo, no para siempre:
// sin push, el dueño se entera de un turno recién cuando abre el panel.
const CLAVE = 'slotly:notif-pospuesta';
const UNA_SEMANA = 7 * 24 * 3600 * 1000;

function pospuesta() {
  try { return Date.now() - Number(localStorage.getItem(CLAVE) || 0) < UNA_SEMANA; } catch { return false; }
}

/**
 * Lo primero que ve el dueño o el profesional al abrir la app INSTALADA:
 * activar las notificaciones para enterarse de los turnos al instante. En el
 * navegador común no aparece (ahí la campanita ya ofrece activarlas): es
 * justamente al instalar cuando el push tiene sentido, y en iPhone solo
 * funciona desde la app instalada.
 *
 * Mismo camino que el botón de la campanita (enablePushNotifications): pide
 * el permiso — dentro del toque, como exigen Safari y Chrome — y registra el
 * dispositivo.
 */
export default function ActivarNotificaciones() {
  const { user } = useAuth();
  const { businessId } = useCurrentBusiness();
  const [estado, setEstado] = useState('oculto'); // oculto | visible | activando | listo | error
  const [error, setError] = useState('');

  const esStaff = user?.role === 'owner' || user?.role === 'admin';

  useEffect(() => {
    if (!esStaff || !businessId) return;
    if (!getEstadoInstalacion().instalada) return;
    if (!pushSupported() || Notification.permission !== 'default') return;
    if (pospuesta()) return;
    // Un respiro después de abrir: que primero se vea el panel.
    const t = setTimeout(() => setEstado('visible'), 1500);
    return () => clearTimeout(t);
  }, [esStaff, businessId]);

  if (estado === 'oculto') return null;

  const activar = async () => {
    setEstado('activando');
    setError('');
    const res = await enablePushNotifications({
      businessId,
      uid: user.id,
      role: user.role,
      professionalId: user.professionalId || null,
    });
    if (res.ok) {
      window.dispatchEvent(new Event(EVENTO_PUSH_ACTIVADO));
      setEstado('listo');
      setTimeout(() => setEstado('oculto'), 2500);
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setError('Bloqueaste las notificaciones. Para activarlas después, entrá a los ajustes del celular → Slotly → Notificaciones.');
    } else {
      setError(res.error);
    }
    setEstado('error');
  };

  const ahoraNo = () => {
    try { localStorage.setItem(CLAVE, String(Date.now())); } catch { /* sin storage: vuelve a aparecer, no rompe nada */ }
    setEstado('oculto');
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <div className="modal-body" style={{ textAlign: 'center', paddingTop: 'var(--space-xl)' }}>
          <div style={{ fontSize: 44, color: 'var(--primary)', marginBottom: 'var(--space-sm)' }}>
            <Icon name={estado === 'listo' ? 'check-circle' : 'bell'} />
          </div>
          {estado === 'listo' ? (
            <h3>¡Listo! Te vamos a avisar de cada turno.</h3>
          ) : (
            <>
              <h3>Activá las notificaciones</h3>
              <p className="text-secondary mt-sm" style={{ lineHeight: 1.5 }}>
                Enterate al instante cuando alguien reserva o cancela un turno, aunque tengas la app cerrada.
              </p>
              {error && <div className="notice notice-danger mt-md" style={{ textAlign: 'left' }}>{error}</div>}
            </>
          )}
        </div>
        {estado !== 'listo' && (
          <div className="modal-footer" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={ahoraNo} disabled={estado === 'activando'}>{estado === 'error' ? 'Cerrar' : 'Ahora no'}</button>
            {estado !== 'error' && (
              <button className="btn btn-primary" onClick={activar} disabled={estado === 'activando'}>
                <Icon name="bell" /> {estado === 'activando' ? 'Activando…' : 'Activar notificaciones'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
