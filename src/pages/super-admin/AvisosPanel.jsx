import { useEffect, useMemo, useState } from 'react';
import { useBusiness } from '../../contexts/BusinessContext';
import {
  subscribeAvisosPlataforma,
  subscribeAvisosAceptados,
  crearAvisoPlataforma,
  setAvisoActivo,
  borrarAvisoPlataforma,
} from '../../lib/repository';
import { CartelAviso } from '../../components/admin/AvisoPlataforma';

const MAX_TITULO = 120;
const MAX_MENSAJE = 2000;

const fecha = (iso) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Avisos a todos los dueños de negocio. Se escriben acá y a cada dueño le
 * aparece un cartel en su panel que no se va hasta que toca "Aceptar".
 *
 * Solo el dueño de la plataforma ve esta pestaña (RLS tampoco deja escribir
 * a un moderador). Archivar deja de mostrarlo a quien todavía no lo aceptó,
 * pero conserva quién sí; borrar lo saca del todo.
 */
export default function AvisosPanel() {
  const { state } = useBusiness();
  const negocios = state.businesses || [];

  const [avisos, setAvisos] = useState([]);
  const [aceptaciones, setAceptaciones] = useState([]);
  const [form, setForm] = useState({ titulo: '', mensaje: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    const onError = (err) => console.error('[AvisosPanel] No se pudieron leer los avisos:', err);
    const offAvisos = subscribeAvisosPlataforma(setAvisos, onError);
    const offAceptaciones = subscribeAvisosAceptados(setAceptaciones, onError);
    return () => { offAvisos(); offAceptaciones(); };
  }, []);

  // aviso → negocios que ya lo aceptaron
  const aceptadosPorAviso = useMemo(() => {
    const mapa = new Map();
    for (const a of aceptaciones) {
      if (!mapa.has(a.avisoId)) mapa.set(a.avisoId, new Set());
      if (a.businessId) mapa.get(a.avisoId).add(a.businessId);
    }
    return mapa;
  }, [aceptaciones]);

  const enviar = async (ev) => {
    ev.preventDefault();
    const titulo = form.titulo.trim();
    const mensaje = form.mensaje.trim();
    if (!titulo) return setError('Poné un título.');
    if (!mensaje) return setError('Escribí el mensaje.');
    if (!window.confirm(`¿Mandarle este aviso a los ${negocios.length} negocios? Les va a aparecer en el panel hasta que lo acepten.`)) return;

    setEnviando(true);
    setError('');
    setOk('');
    try {
      await crearAvisoPlataforma({ titulo, mensaje });
      setForm({ titulo: '', mensaje: '' });
      setOk('Aviso enviado. A cada dueño le aparece la próxima vez que abra (o ya tiene abierto) su panel.');
    } catch (err) {
      console.error('[AvisosPanel] No se pudo enviar:', err);
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const archivar = async (aviso) => {
    setError('');
    try {
      await setAvisoActivo(aviso.id, !aviso.activo);
    } catch (err) {
      setError(err.message);
    }
  };

  const borrar = async (aviso) => {
    if (!window.confirm(`¿Borrar "${aviso.titulo}"? Se pierde también el registro de quién lo aceptó. Para dejar de mostrarlo sin perder eso, usá "Archivar".`)) return;
    setError('');
    try {
      await borrarAvisoPlataforma(aviso.id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ marginBottom: 6 }}>Nuevo aviso a todos los dueños</h3>
        <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-md)' }}>
          Le aparece a cada dueño como un cartel en su panel y no se va hasta
          que toca <strong>Aceptar</strong>. Solo lo ven los dueños (no el
          equipo ni los clientes). Los links que pegues en el mensaje se pueden tocar.
        </p>

        {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}
        {ok && <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>{ok}</div>}

        <form onSubmit={enviar}>
          <div className="form-group">
            <label className="form-label">Título</label>
            <input
              className="form-input"
              value={form.titulo}
              maxLength={MAX_TITULO}
              onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
              placeholder="Ej: Mantenimiento programado"
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              Mensaje <span className="text-secondary text-sm">({form.mensaje.length}/{MAX_MENSAJE})</span>
            </label>
            <textarea
              className="form-input"
              rows={6}
              value={form.mensaje}
              maxLength={MAX_MENSAJE}
              onChange={(e) => setForm((f) => ({ ...f, mensaje: e.target.value }))}
              placeholder="Ej: El domingo de 2 a 4 AM la app puede no responder por una actualización."
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => setVistaPrevia(true)}>
              Vista previa
            </button>
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Enviar a todos los dueños'}
            </button>
          </div>
        </form>
      </div>

      {vistaPrevia && (
        <div className="modal-overlay" onClick={() => setVistaPrevia(false)}>
          <div style={{ width: '100%', maxWidth: 480 }}>
            <p style={{ color: '#fff', textAlign: 'center', marginBottom: 8, fontSize: 13 }}>
              Vista previa — así lo ve el dueño. Tocá afuera para cerrar.
            </p>
            <CartelAviso titulo={form.titulo.trim()} mensaje={form.mensaje.trim()} />
          </div>
        </div>
      )}

      <h3 style={{ marginBottom: 'var(--space-md)' }}>Avisos enviados</h3>
      {avisos.length === 0 && (
        <div className="card empty-state">
          <p>Todavía no mandaste ningún aviso.</p>
        </div>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
        {avisos.map((aviso) => {
          const aceptaron = aceptadosPorAviso.get(aviso.id) || new Set();
          const faltan = negocios.filter((n) => !aceptaron.has(n.id));
          const cuantos = negocios.length - faltan.length;
          return (
            <div key={aviso.id} className="card" style={{ opacity: aviso.activo ? 1 : 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <strong>{aviso.titulo}</strong>
                    <span className={`badge ${aviso.activo ? 'badge-success' : 'badge-warning'}`}>
                      {aviso.activo ? 'Activo' : 'Archivado'}
                    </span>
                  </div>
                  <div className="text-sm text-secondary">
                    {fecha(aviso.createdAt)} · Aceptado por <strong>{cuantos} de {negocios.length}</strong> negocios
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAbierto(abierto === aviso.id ? null : aviso.id)}>
                    {abierto === aviso.id ? 'Ocultar' : 'Ver detalle'}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => archivar(aviso)}>
                    {aviso.activo ? 'Archivar' : 'Reactivar'}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => borrar(aviso)}>
                    Borrar
                  </button>
                </div>
              </div>

              {abierto === aviso.id && (
                <div style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
                  <p style={{ whiteSpace: 'pre-wrap', marginBottom: 'var(--space-md)' }}>{aviso.mensaje}</p>
                  {faltan.length === 0 ? (
                    <p className="text-sm text-secondary">Todos los negocios lo aceptaron.</p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold" style={{ marginBottom: 4 }}>Todavía no lo aceptaron ({faltan.length}):</p>
                      <p className="text-sm text-secondary">{faltan.map((n) => n.name).join(' · ')}</p>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
