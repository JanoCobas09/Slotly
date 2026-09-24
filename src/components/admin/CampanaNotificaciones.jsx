import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../hooks/useTenantData';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { markNotificationRead } from '../../lib/repository';
import { enablePushNotifications } from '../../lib/push';
import { enviarPushDePrueba } from '../../lib/functions';
import Icon from '../Icon';
import Toast from '../Toast';

/**
 * La campanita del panel. Muestra las notificaciones del negocio (o las del
 * profesional asignado) con un contador de no leídas, y avisa con una
 * notificación del navegador cuando entra una nueva mientras el panel está
 * abierto (`new Notification(...)`, foreground).
 *
 * El botón "Activar notificaciones push" es otra cosa: registra este
 * dispositivo en FCM (src/lib/push.js) para recibir el aviso aunque la
 * pestaña esté cerrada o el celular bloqueado — lo manda el mismo trigger de
 * Functions que ya escribe la notificación in-app (ver
 * functions/index.js:onNuevoTurno).
 *
 * Las notificaciones las crea un trigger de Functions al entrar o cancelarse
 * un turno; acá solo se leen y se marcan leídas. Cuando llegue WhatsApp, el
 * aviso por mensaje sale del mismo trigger.
 */

const ICONO = { nuevo_turno: 'calendar', turno_cancelado: 'x-circle' };

function hace(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export default function CampanaNotificaciones() {
  const { user } = useAuth();
  const { businessId } = useCurrentBusiness();
  const notificaciones = useNotifications();
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState(false);
  const [permiso, setPermiso] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const [pushEstado, setPushEstado] = useState('inactivo'); // inactivo | activando | activo | error
  const [pushError, setPushError] = useState('');
  const [pruebaEstado, setPruebaEstado] = useState('inactiva'); // inactiva | enviando | enviada | error
  const [pruebaError, setPruebaError] = useState('');
  const [toast, setToast] = useState(null); // { tipo: 'success'|'danger', mensaje } | null
  const panelRef = useRef(null);

  // Confirmación flotante de 3s — se ve aunque el panel se haya cerrado
  // (ej. en el celular, después del diálogo nativo de permiso).
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const uid = user?.id;
  const noLeidas = notificaciones.filter((n) => !n.leidaPor?.[uid]);

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!abierta) return;
    const onClick = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setAbierta(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [abierta]);

  // Aviso del navegador cuando entra una nueva. Se recuerdan los ids ya vistos
  // para no avisar por las que ya estaban al abrir el panel.
  const vistas = useRef(null);
  useEffect(() => {
    if (vistas.current === null) {
      vistas.current = new Set(notificaciones.map((n) => n.id));
      return;
    }
    const nuevas = notificaciones.filter((n) => !vistas.current.has(n.id));
    nuevas.forEach((n) => vistas.current.add(n.id));
    if (!nuevas.length) return;
    if (permiso !== 'granted') return;
    try {
      nuevas.slice(0, 3).forEach((n) => new Notification(n.title, { body: n.body, tag: n.id }));
    } catch { /* algunos navegadores móviles no dejan crear Notification desde la página */ }
  }, [notificaciones, permiso]);

  /**
   * Un solo click hace dos cosas: pide el permiso de notificaciones del
   * navegador (lo que ya hacía) y, si lo dan, registra este dispositivo para
   * recibir push de verdad (FCM) — a diferencia del aviso de acá arriba
   * (`new Notification(...)`), que solo suena con la pestaña abierta, el push
   * llega aunque el celular esté bloqueado o el navegador cerrado.
   */
  const pedirPermiso = async () => {
    if (typeof Notification === 'undefined') return;
    const r = await Notification.requestPermission();
    setPermiso(r);
    if (r === 'denied') {
      setToast({ tipo: 'danger', mensaje: 'No diste el permiso — no vas a recibir avisos de turnos nuevos en este dispositivo.' });
      return;
    }
    if (r !== 'granted' || !businessId || !uid) return;

    setPushEstado('activando');
    const res = await enablePushNotifications({
      businessId,
      uid,
      role: user.role,
      professionalId: user.professionalId || null,
    });
    if (res.ok) {
      setPushEstado('activo');
      setToast({ tipo: 'success', mensaje: 'Listo — activaste las notificaciones push en este dispositivo.' });
    } else {
      setPushEstado('error');
      setPushError(res.error);
      setToast({ tipo: 'danger', mensaje: `No se pudo activar: ${res.error}` });
    }
  };

  /** Manda un push de prueba a este mismo dispositivo, sin esperar un turno real. */
  const probarPush = async () => {
    setPruebaEstado('enviando');
    setPruebaError('');
    try {
      await enviarPushDePrueba();
      setPruebaEstado('enviada');
    } catch (err) {
      setPruebaEstado('error');
      setPruebaError(err.message || 'No se pudo enviar la prueba.');
    }
  };

  const abrir = async (n) => {
    setAbierta(false);
    if (!n.leidaPor?.[uid] && businessId && uid) {
      markNotificationRead(businessId, n.id, uid).catch((err) => console.error('[Campana] No se pudo marcar leída:', err));
    }
    navigate('/admin/citas');
  };

  const marcarTodas = () => {
    noLeidas.forEach((n) => markNotificationRead(businessId, n.id, uid).catch(() => {}));
  };

  return (
    <div className="campana" ref={panelRef}>
      <button
        className="campana-boton"
        onClick={() => setAbierta((v) => !v)}
        aria-label={noLeidas.length ? `${noLeidas.length} notificaciones sin leer` : 'Notificaciones'}
        title="Notificaciones"
      >
        <Icon name="bell" />
        {noLeidas.length > 0 && <span className="campana-contador">{noLeidas.length > 9 ? '9+' : noLeidas.length}</span>}
      </button>

      {abierta && (
        <div className="campana-panel">
          <div className="campana-panel-cabecera">
            <strong>Notificaciones</strong>
            {noLeidas.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={marcarTodas}>Marcar todas leídas</button>
            )}
          </div>

          {permiso === 'default' && (
            <button className="campana-permiso" onClick={pedirPermiso} disabled={pushEstado === 'activando'}>
              {pushEstado === 'activando' ? 'Activando…' : <><Icon name="bell-off" /> Activar notificaciones push en este dispositivo</>}
            </button>
          )}
          {permiso === 'granted' && pushEstado === 'activo' && (
            <div className="campana-vacia" style={{ color: 'var(--success)' }}>
              <Icon name="bell" /> Notificaciones push activas en este dispositivo
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={probarPush} disabled={pruebaEstado === 'enviando'}>
                  {pruebaEstado === 'enviando' ? 'Enviando…' : 'Mandarme una notificación de prueba'}
                </button>
                {pruebaEstado === 'enviada' && (
                  <div className="text-xs" style={{ color: 'var(--success)', marginTop: 4 }}>
                    Enviada — debería llegarte en unos segundos.
                  </div>
                )}
                {pruebaEstado === 'error' && (
                  <div className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                    {pruebaError}
                  </div>
                )}
              </div>
            </div>
          )}
          {pushEstado === 'error' && (
            <div className="campana-vacia" style={{ color: 'var(--danger)' }}>
              No se pudo activar el push: {pushError}
            </div>
          )}
          {permiso === 'denied' && pushEstado !== 'error' && (
            <div className="campana-vacia" style={{ color: 'var(--danger)' }}>
              Bloqueaste las notificaciones en este navegador. Para activarlas,
              cambiá el permiso desde la configuración del sitio.
            </div>
          )}

          {notificaciones.length === 0 ? (
            <div className="campana-vacia">
              Cuando un cliente reserve o cancele un turno, te avisamos acá.
            </div>
          ) : (
            <ul className="campana-lista">
              {notificaciones.slice(0, 30).map((n) => {
                const leida = Boolean(n.leidaPor?.[uid]);
                return (
                  <li key={n.id} className={`campana-item ${leida ? '' : 'no-leida'}`} onClick={() => abrir(n)}>
                    <span className="campana-icono"><Icon name={ICONO[n.type] || 'bell'} /></span>
                    <div className="campana-texto">
                      <div className="campana-titulo">{n.title}</div>
                      <div className="campana-cuerpo">{n.body}</div>
                      <div className="campana-hace">{hace(n.createdAt)}</div>
                    </div>
                    {!leida && <span className="campana-punto" />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {toast && <Toast tipo={toast.tipo}>{toast.mensaje}</Toast>}
    </div>
  );
}
