import { useState } from 'react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import Icon from '../Icon';

// Persistido en localStorage (no sessionStorage): "ahora no" tiene que
// aguantar entre sesiones, si no el dueño lo ve cada vez que abre el panel.
// Es por dispositivo a propósito, igual que las suscripciones push — cada
// aparato decide su propia instalación.
const CERRADO_KEY = 'slotly:instalarBannerCerrado';

/**
 * Sugerencia para instalar el panel como app (PWA). Solo tiene sentido acá
 * (AdminLayout, dueño/staff) — el cliente reserva desde el navegador, nunca
 * instala nada. `useInstallPrompt` ya se encarga de no mostrar nada si el
 * dispositivo no soporta instalación o si ya está instalada.
 */
export default function InstalarAppBanner() {
  const { instalable, conPromptNativo, esIOS, instalar } = useInstallPrompt();
  const [cerrado, setCerrado] = useState(() => {
    try { return localStorage.getItem(CERRADO_KEY) === '1'; } catch { return false; }
  });
  const [mostrarPasosIOS, setMostrarPasosIOS] = useState(false);

  if (!instalable || cerrado) return null;

  const cerrar = () => {
    setCerrado(true);
    try { localStorage.setItem(CERRADO_KEY, '1'); } catch { /* nada */ }
  };

  const handleInstalar = async () => {
    if (conPromptNativo) {
      await instalar();
      return;
    }
    if (esIOS) setMostrarPasosIOS(true);
  };

  return (
    <>
      <div
        className="notice notice-info"
        style={{
          borderRadius: 0, borderLeft: 'none', borderTop: 'none', borderRight: 'none',
          borderBottomWidth: '2px', borderBottomStyle: 'solid', padding: '8px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <span>
          <Icon name="download" /> Instalá Slotly en este dispositivo para acceder más rápido y recibir las notificaciones aunque el navegador esté cerrado.
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={handleInstalar}>Instalar</button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={cerrar}
            aria-label="Cerrar sugerencia"
            title="Ahora no"
          >
            <Icon name="x" />
          </button>
        </div>
      </div>

      {mostrarPasosIOS && (
        <div className="modal-overlay" onClick={() => setMostrarPasosIOS(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>Instalar Slotly en iPhone/iPad</h3>
              <button className="modal-close" onClick={() => setMostrarPasosIOS(false)}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <ol style={{ paddingLeft: '1.2em', display: 'grid', gap: 10 }}>
                <li>Tocá el botón <strong>Compartir</strong> de Safari (el cuadrado con la flecha hacia arriba).</li>
                <li>Elegí <strong>"Agregar a inicio"</strong> en la lista de opciones.</li>
                <li>Confirmá tocando <strong>"Agregar"</strong> arriba a la derecha.</li>
              </ol>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setMostrarPasosIOS(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
