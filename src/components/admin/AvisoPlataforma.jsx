import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeAvisosPlataforma, subscribeAvisosAceptados, aceptarAviso } from '../../lib/repository';

// Los links que la plataforma pegue en el mensaje se pueden tocar. Se arman
// como elementos de React (nunca innerHTML) y solo si empiezan con http(s).
const URL_RE = /(https?:\/\/[^\s]+)/g;

function TextoConLinks({ texto }) {
  return texto.split(URL_RE).map((parte, i) =>
    i % 2 === 1
      ? <a key={i} href={parte} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', wordBreak: 'break-all' }}>{parte}</a>
      : parte
  );
}

/**
 * El cartel en sí, sin datos: lo usa el panel del dueño y la vista previa del
 * panel global, así lo que ve la plataforma al escribirlo es exactamente lo
 * que le llega al dueño.
 */
export function CartelAviso({ titulo, mensaje, posicion = null, onAceptar = null, aceptando = false, error = '' }) {
  return (
    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }} role="alertdialog" aria-modal="true" aria-labelledby="aviso-plataforma-titulo">
      <div className="modal-header">
        <h3 id="aviso-plataforma-titulo" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/img/slotly-icon.svg" alt="" width="22" height="22" />
          {titulo || 'Título del aviso'}
        </h3>
        {posicion && <span className="text-sm text-secondary">{posicion}</span>}
      </div>
      <div className="modal-body">
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, margin: 0 }}>
          {mensaje ? <TextoConLinks texto={mensaje} /> : <span className="text-secondary">El mensaje del aviso.</span>}
        </p>
        <p className="text-sm text-secondary" style={{ marginTop: 'var(--space-md)', marginBottom: 0 }}>
          — El equipo de Slotly
        </p>
        {error && <div className="notice notice-danger" style={{ marginTop: 'var(--space-md)' }}>{error}</div>}
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={onAceptar || undefined} disabled={!onAceptar || aceptando}>
          {aceptando ? 'Guardando…' : 'Aceptar'}
        </button>
      </div>
    </div>
  );
}

/**
 * Avisos que la plataforma les manda a todos los dueños. Se muestran de a uno,
 * del más viejo al más nuevo, y no hay forma de cerrarlos más que tocando
 * "Aceptar" (ni la X ni tocar afuera). La aceptación queda guardada por
 * cuenta: no vuelve a aparecer en otro dispositivo.
 *
 * Solo lo monta AdminLayout para el dueño (RLS tampoco deja leerlos a otro rol).
 */
export default function AvisoPlataforma() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [avisos, setAvisos] = useState([]);
  const [aceptados, setAceptados] = useState([]);
  // Aceptados en esta pestaña, para que el cartel se vaya al instante sin
  // esperar el evento de Realtime.
  const [recienAceptados, setRecienAceptados] = useState(() => new Set());
  const [aceptando, setAceptando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) return undefined;
    const onError = (err) => console.error('[AvisoPlataforma] No se pudieron leer los avisos:', err);
    const offAvisos = subscribeAvisosPlataforma(setAvisos, onError);
    const offAceptados = subscribeAvisosAceptados(setAceptados, onError, { userId: uid });
    return () => { offAvisos(); offAceptados(); };
  }, [uid]);

  const pendientes = useMemo(() => {
    const yaAceptados = new Set([...aceptados.map((a) => a.avisoId), ...recienAceptados]);
    return avisos
      .filter((a) => a.activo && !yaAceptados.has(a.id))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }, [avisos, aceptados, recienAceptados]);

  if (pendientes.length === 0) return null;
  const actual = pendientes[0];

  const aceptar = async () => {
    setAceptando(true);
    setError('');
    try {
      await aceptarAviso(actual.id);
      setRecienAceptados((s) => new Set(s).add(actual.id));
    } catch (err) {
      console.error('[AvisoPlataforma] No se pudo aceptar:', err);
      setError('No se pudo guardar. Revisá tu conexión y probá de nuevo.');
    } finally {
      setAceptando(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <CartelAviso
        key={actual.id}
        titulo={actual.titulo}
        mensaje={actual.mensaje}
        posicion={pendientes.length > 1 ? `+${pendientes.length - 1} más` : null}
        onAceptar={aceptar}
        aceptando={aceptando}
        error={error}
      />
    </div>
  );
}
