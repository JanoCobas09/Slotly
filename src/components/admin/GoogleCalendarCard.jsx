import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getEstadoGoogleCalendar } from '../../lib/repository';
import { conectarGoogleCalendar, desconectarGoogleCalendar } from '../../lib/functions';
import Icon from '../Icon';

// Mientras Google no termine de verificar la app (permiso de calendario =
// "sensible"), su pantalla muestra "Google no verificó esta app" y hay que
// tocar "Configuración avanzada" → "Ir a Slotly". Cuando la verifiquen, pasar
// a true y el aviso desaparece.
const GOOGLE_VERIFICO_LA_APP = false;

// Lo que se ve al volver de Google (gcal-oauth-callback redirige con ?gcal=).
const AVISO_VUELTA = {
  conectado: { clase: 'notice-info', texto: 'Listo: el calendario quedó conectado. En unos minutos aparecen los turnos que ya estaban agendados.' },
  cancelado: { clase: 'notice-warn', texto: 'No se conectó Google Calendar: cancelaste el permiso.' },
  'sin-permiso': { clase: 'notice-warn', texto: 'No se conectó: en la pantalla de Google hay que dejar tildado el permiso para ver y editar los eventos del calendario.' },
  error: { clase: 'notice-danger', texto: 'No se pudo conectar Google Calendar. Probá de nuevo.' },
};

/**
 * Google Calendar de cada profesional: sus turnos van solos a su calendario
 * (y al celular) y lo que tenga ocupado ahí no se ofrece para reservar.
 *
 * El dueño ve a todo el equipo (Configuración); un profesional, solo el suyo
 * (Mi configuración, `volverA="ajustes"`). Conectar es un ida y vuelta con
 * Google, no espera "Guardar Cambios".
 */
export default function GoogleCalendarCard({ businessId, profesionales, volverA = 'configuracion', terminology }) {
  const [params, setParams] = useSearchParams();
  const [estado, setEstado] = useState(undefined); // undefined = cargando; si no, { [professionalId]: fila }
  const [trabajando, setTrabajando] = useState(null); // professionalId en curso
  const [error, setError] = useState('');
  const [aviso] = useState(() => AVISO_VUELTA[params.get('gcal')] || null);

  useEffect(() => {
    if (!params.get('gcal')) return;
    const limpio = new URLSearchParams(params);
    limpio.delete('gcal');
    setParams(limpio, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    getEstadoGoogleCalendar(businessId)
      .then((filas) => { if (vigente) setEstado(Object.fromEntries(filas.map((f) => [f.professionalId, f]))); })
      .catch((err) => {
        console.error('[GoogleCalendarCard] No se pudo leer el estado:', err);
        if (vigente) setEstado({});
      });
    return () => { vigente = false; };
  }, [businessId]);

  const conectar = async (professionalId) => {
    setTrabajando(professionalId);
    setError('');
    try {
      const { url } = await conectarGoogleCalendar({ businessId, professionalId, volverA });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setTrabajando(null);
    }
  };

  const desconectar = async (professionalId) => {
    if (!window.confirm('¿Desconectar Google Calendar? Los turnos que vienen se borran de ese calendario y Slotly deja de mirar lo que tiene ocupado ahí.')) return;
    setTrabajando(professionalId);
    setError('');
    try {
      await desconectarGoogleCalendar({ businessId, professionalId });
      setEstado((e) => {
        const { [professionalId]: _quitado, ...resto } = e || {};
        return resto;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando(null);
    }
  };

  const propio = volverA === 'ajustes';
  const { appointmentNoun: turno, customerNoun: cliente } = terminology;

  return (
    <div className="card mt-md">
      <h3 className="mb-sm"><Icon name="calendar" /> Google Calendar</h3>
      <p className="text-secondary text-sm mb-md">
        {propio
          ? `Tus ${turno}s aparecen solos en tu Google Calendar (y en el calendario de tu celular): si se mueven o se cancelan, se actualizan. Y lo que tengas ocupado en tu calendario no se le ofrece al ${cliente} para reservar.`
          : `Cada ${turno} aparece solo en el Google Calendar de quien lo atiende (y en su celular): si se mueve o se cancela, se actualiza. Y lo que tenga ocupado en su calendario no se le ofrece al ${cliente} para reservar.`}
      </p>

      {aviso && <div className={`notice ${aviso.clase} mb-md`}>{aviso.texto}</div>}

      {!GOOGLE_VERIFICO_LA_APP && (
        <div className="notice notice-info mb-md text-sm">
          Google todavía está revisando Slotly. Si al conectar te dice
          {' '}<strong>"Google no verificó esta app"</strong>, tocá <strong>Configuración avanzada</strong> y
          después <strong>Ir a slotly-turnos.vercel.app</strong>. Lo de "no seguro" lo dice solo porque la revisión no terminó.
        </div>
      )}

      {/* Google manda SIEMPRE un mail de seguridad cuando alguien conecta una
          app a su cuenta (no se puede apagar). Sin avisarlo antes, asusta:
          mientras la marca no esté verificada ni siquiera dice "Slotly". */}
      <p className="text-sm text-secondary mb-md">
        <Icon name="bell" /> Después de conectar, Google te va a mandar un mail avisando que una app tiene
        acceso a tu cuenta. Es normal: pasa con cualquier app que conectes. Slotly solo usa tu calendario
        (nada de tu correo, contactos ni archivos), y lo podés desconectar cuando quieras desde acá.
      </p>

      {estado === undefined ? (
        <p className="text-sm text-muted">Revisando…</p>
      ) : (
        <div className="flex flex-col gap-sm">
          {profesionales.map((p) => {
            const c = estado[p.id];
            const ocupado = trabajando === p.id;
            return (
              <div key={p.id} className="gcal-fila">
                <div className="gcal-persona">
                  {!propio && <strong>{p.name}</strong>}
                  {c && !c.error && (
                    <span className="badge badge-success"><Icon name="check-circle" /> Conectado{c.googleEmail ? ` · ${c.googleEmail}` : ''}</span>
                  )}
                  {c?.error && (
                    <span className="badge badge-danger"><Icon name="warning" /> {c.error}</span>
                  )}
                  {!c && <span className="text-sm text-muted">Sin conectar</span>}
                </div>
                <div className="gcal-acciones">
                  {(!c || c.error) && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => conectar(p.id)} disabled={Boolean(trabajando)}>
                      <Icon name="link" /> {ocupado ? 'Abriendo Google…' : c?.error ? 'Volver a conectar' : 'Conectar'}
                    </button>
                  )}
                  {c && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => desconectar(p.id)} disabled={Boolean(trabajando)}>
                      {ocupado && !c.error ? 'Desconectando…' : 'Desconectar'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {profesionales.length === 0 && <p className="text-sm text-muted">Todavía no cargaste profesionales.</p>}
        </div>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</p>}
      {!propio && (
        <p className="text-xs text-muted" style={{ marginTop: 'var(--space-md)' }}>
          Al tocar Conectar se abre Google con la cuenta que esté abierta en este dispositivo. Si es el calendario de otra persona, que lo conecte ella desde su panel, o entrá con su cuenta de Google.
        </p>
      )}
    </div>
  );
}
