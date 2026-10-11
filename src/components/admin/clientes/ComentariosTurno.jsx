import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { listarComentarios, crearComentario, editarComentario, borrarComentario } from '../../../lib/repository';
import { LIMITES } from '../../../utils/validaciones';
import Icon from '../../Icon';
import { mensajeDeError } from '../../../utils/errores';

const fechaHora = (iso) => new Date(iso).toLocaleString('es-AR', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Comentarios internos de UN turno. Se piden recién cuando se abre el turno,
 * de a 30 (más nuevos primero) con "Ver anteriores". Agregar uno nunca pisa
 * los anteriores. Editar: solo quien lo escribió. Borrar: quien lo escribió
 * o el dueño, con confirmación. La base hace cumplir lo mismo (RLS): acá
 * solo se esconden los botones que no corresponden.
 */
export default function ComentariosTurno({ appointmentId, puedeEscribir, esDueno, onCambio }) {
  const { user } = useAuth();
  const [comentarios, setComentarios] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState(null); // { id, texto }
  const [aBorrar, setABorrar] = useState(null);

  const cargar = useCallback(async (antesDe = null) => {
    setCargando(true);
    setError('');
    try {
      const res = await listarComentarios(appointmentId, { antesDe });
      setComentarios((prev) => (antesDe ? [...prev, ...res.comentarios] : res.comentarios));
      setHayMas(res.hayMas);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron cargar los comentarios.'));
    } finally {
      setCargando(false);
    }
  }, [appointmentId]);

  useEffect(() => { cargar(); }, [cargar]);

  const agregar = async (e) => {
    e.preventDefault();
    if (!texto.trim() || guardando) return;
    setGuardando(true);
    setError('');
    try {
      const nuevo = await crearComentario(appointmentId, texto);
      setComentarios((prev) => [nuevo, ...prev]);
      setTexto('');
      onCambio?.();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el comentario.'));
    } finally {
      setGuardando(false);
    }
  };

  const guardarEdicion = async () => {
    if (!editando?.texto.trim()) return;
    setGuardando(true);
    setError('');
    try {
      const actualizado = await editarComentario(editando.id, editando.texto);
      setComentarios((prev) => prev.map((c) => (c.id === actualizado.id ? actualizado : c)));
      setEditando(null);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo editar el comentario.'));
    } finally {
      setGuardando(false);
    }
  };

  const confirmarBorrado = async () => {
    const id = aBorrar;
    setABorrar(null);
    setError('');
    try {
      await borrarComentario(id);
      setComentarios((prev) => prev.filter((c) => c.id !== id));
      onCambio?.();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo borrar el comentario.'));
    }
  };

  return (
    <section className="doc-turno-seccion" aria-labelledby={`coment-${appointmentId}`}>
      <h4 id={`coment-${appointmentId}`} className="doc-turno-titulo">
        <Icon name="chat" /> Comentarios
      </h4>

      {puedeEscribir && (
        <form onSubmit={agregar} className="doc-comentario-form">
          <label className="sr-only" htmlFor={`nuevo-coment-${appointmentId}`}>Nuevo comentario</label>
          <textarea
            id={`nuevo-coment-${appointmentId}`}
            className="form-input"
            rows={2}
            maxLength={LIMITES.mensaje}
            placeholder="Anotá algo de esta atención…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <div className="doc-comentario-form-pie">
            <span className="text-xs text-muted">{texto.length > LIMITES.mensaje - 200 && `${texto.length}/${LIMITES.mensaje}`}</span>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!texto.trim() || guardando}>
              {guardando && !editando ? 'Guardando…' : 'Agregar comentario'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="notice notice-danger doc-turno-error" role="alert">
          {error}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => cargar()}>Reintentar</button>
        </div>
      )}

      {cargando && comentarios.length === 0 ? (
        <div className="doc-turno-cargando" role="status"><span className="spinner spinner-sm" aria-hidden="true" /> Cargando comentarios…</div>
      ) : comentarios.length === 0 && !error ? (
        <p className="text-sm text-muted">Todavía no hay comentarios en este turno.</p>
      ) : (
        <ul className="doc-comentarios">
          {comentarios.map((c) => {
            const propio = user?.id && c.autorId === user.id;
            const enEdicion = editando?.id === c.id;
            return (
              <li key={c.id} className="doc-comentario">
                <div className="doc-comentario-cabecera">
                  <strong>{c.autorNombre || 'Alguien del equipo'}</strong>
                  <span className="text-xs text-muted">
                    {fechaHora(c.createdAt)}{c.updatedAt && ' · editado'}
                  </span>
                </div>
                {enEdicion ? (
                  <div className="doc-comentario-edicion">
                    <textarea
                      className="form-input"
                      rows={3}
                      maxLength={LIMITES.mensaje}
                      value={editando.texto}
                      onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                      aria-label="Editar comentario"
                      autoFocus
                    />
                    <div className="flex gap-sm">
                      <button type="button" className="btn btn-primary btn-sm" onClick={guardarEdicion} disabled={guardando || !editando.texto.trim()}>Guardar</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando(null)}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <p className="doc-comentario-texto">{c.texto}</p>
                )}
                {!enEdicion && (propio || esDueno) && (
                  <div className="doc-comentario-acciones">
                    {propio && puedeEscribir && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditando({ id: c.id, texto: c.texto })}>
                        <Icon name="edit" /> Editar
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm doc-peligro" onClick={() => setABorrar(c.id)}>
                      <Icon name="trash" /> Borrar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hayMas && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={cargando}
          onClick={() => cargar(comentarios[comentarios.length - 1]?.createdAt)}
        >
          {cargando ? 'Cargando…' : 'Ver comentarios anteriores'}
        </button>
      )}

      {aBorrar && (
        <div className="doc-confirmar" role="alertdialog" aria-label="Confirmar borrado">
          <p>¿Borrar este comentario? No se puede deshacer.</p>
          <div className="flex gap-sm">
            <button type="button" className="btn btn-danger btn-sm" onClick={confirmarBorrado}>Sí, borrar</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setABorrar(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
