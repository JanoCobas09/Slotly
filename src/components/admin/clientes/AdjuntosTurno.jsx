import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { listarAdjuntos, getLimitesAdjuntos, urlsDeMiniaturas } from '../../../lib/repository';
import { seVeEnVisor, urlParaVisor, abrirEnPestana, descargarAdjunto } from '../../../lib/verAdjunto';
import VisorImagen from './VisorImagen';
import BotonCompartir from './BotonCompartir';
import { eliminarAdjunto } from '../../../lib/functions';
import { subirAdjunto, SubidaCancelada } from '../../../lib/subirAdjunto';
import { esImagen, formatearTamano, etiquetaTipo } from '../../../utils/archivos';
import Icon from '../../Icon';
import { mensajeDeError } from '../../../utils/errores';

const ACEPTA = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

// Cuánto queda a la vista el aviso "Se guardó…".
const AVISO_GUARDADO_MS = 6000;

let contador = 0;

/** Vista previa local de una foto elegida (todavía no subida). */
const vistaLocal = (file) => (file.type.startsWith('image/') && !/hei[cf]/i.test(file.type) ? URL.createObjectURL(file) : null);

/**
 * Archivos de UN turno: fotos (con miniatura) y documentos. La lista trae
 * solo metadatos; de las fotos se piden URLs firmadas de las MINIATURAS (una
 * sola petición) y se cargan con loading="lazy". El original se pide recién
 * al abrirlo (URL de 60 s).
 *
 * Elegir no sube nada: los archivos elegidos se muestran con un botón
 * "Guardar" (pedido del usuario: antes se subían solos, sin decir nada, y no
 * quedaba claro si se habían guardado). Al guardar, se suben de a uno
 * (cola), con progreso, cancelar y reintentar, y al terminar aparece
 * "✓ Se guardó…". Cada archivo guardado se puede compartir (BotonCompartir).
 */
export default function AdjuntosTurno({ appointmentId, puedeEscribir, esDueno, onCambio }) {
  const { user } = useAuth();
  const [adjuntos, setAdjuntos] = useState([]);
  const [miniaturas, setMiniaturas] = useState({});
  const [limites, setLimites] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  // { key, file, vista, estado: elegido|esperando|subiendo|error, etapa, progreso, error, controller }
  const [cola, setCola] = useState([]);
  const [guardados, setGuardados] = useState([]); // nombres recién guardados, para el aviso
  const [visor, setVisor] = useState(null); // { adjunto, url }
  const [aBorrar, setABorrar] = useState(null);
  const inputRef = useRef(null);
  const procesando = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const [lista, lim] = await Promise.all([listarAdjuntos(appointmentId), getLimitesAdjuntos()]);
      setAdjuntos(lista);
      setLimites(lim);
      const rutas = lista.filter((a) => a.rutaMiniatura).map((a) => a.rutaMiniatura);
      setMiniaturas(rutas.length ? await urlsDeMiniaturas(rutas) : {});
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron cargar los archivos.'));
    } finally {
      setCargando(false);
    }
  }, [appointmentId]);

  useEffect(() => { cargar(); }, [cargar]);

  const actualizar = (key, cambios) => setCola((prev) => prev.map((i) => (i.key === key ? { ...i, ...cambios } : i)));
  const quitarDeCola = (key) => setCola((prev) => prev.filter((i) => {
    if (i.key !== key) return true;
    if (i.vista) URL.revokeObjectURL(i.vista);
    return false;
  }));

  // Cola: de a un archivo por vez, así un celular con mala señal no satura
  // la conexión subiendo diez fotos en paralelo. Solo los que ya se mandaron
  // a guardar ('esperando'); los 'elegido' esperan el botón Guardar.
  useEffect(() => {
    if (procesando.current || !limites) return;
    const siguiente = cola.find((i) => i.estado === 'esperando');
    if (!siguiente) return;
    procesando.current = true;
    const controller = new AbortController();
    actualizar(siguiente.key, { estado: 'subiendo', etapa: 'Preparando…', progreso: 0, error: '', controller });
    subirAdjunto(appointmentId, siguiente.file, {
      limites,
      signal: controller.signal,
      onEtapa: (etapa) => actualizar(siguiente.key, { etapa }),
      onProgreso: (progreso) => actualizar(siguiente.key, { progreso }),
    })
      .then(() => {
        quitarDeCola(siguiente.key);
        setGuardados((prev) => [...prev, siguiente.file.name]);
        cargar();
        onCambio?.();
      })
      .catch((err) => {
        if (err instanceof SubidaCancelada) {
          quitarDeCola(siguiente.key);
        } else {
          actualizar(siguiente.key, { estado: 'error', error: mensajeDeError(err, 'No se pudo guardar.'), controller: null });
        }
      })
      .finally(() => { procesando.current = false; setCola((prev) => [...prev]); });
  }, [cola, limites, appointmentId, cargar, onCambio]);

  // El aviso "Se guardó…" queda unos segundos después de que termina todo.
  const enCurso = cola.some((i) => i.estado === 'esperando' || i.estado === 'subiendo');
  useEffect(() => {
    if (enCurso || guardados.length === 0) return undefined;
    const t = setTimeout(() => setGuardados([]), AVISO_GUARDADO_MS);
    return () => clearTimeout(t);
  }, [enCurso, guardados.length]);

  // Al cerrar el turno, que no queden vistas previas locales en memoria.
  const colaRef = useRef(cola);
  colaRef.current = cola;
  useEffect(() => () => colaRef.current.forEach((i) => i.vista && URL.revokeObjectURL(i.vista)), []);

  const elegir = (e) => {
    const archivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!archivos.length) return;
    setGuardados([]);
    setCola((prev) => [
      ...prev,
      ...archivos.map((file) => ({ key: `s${++contador}`, file, vista: vistaLocal(file), estado: 'elegido', etapa: '', progreso: 0, error: '' })),
    ]);
  };

  const guardarElegidos = () => setCola((prev) => prev.map((i) => (
    i.estado === 'elegido' ? { ...i, estado: 'esperando', etapa: 'En espera' } : i
  )));
  const descartarElegidos = () => setCola((prev) => prev.filter((i) => {
    if (i.estado !== 'elegido') return true;
    if (i.vista) URL.revokeObjectURL(i.vista);
    return false;
  }));

  const abrir = async (a) => {
    setError('');
    try {
      if (seVeEnVisor(a)) setVisor({ adjunto: a, url: await urlParaVisor(a) });
      else await abrirEnPestana(a);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo abrir el archivo.'));
    }
  };

  const descargar = async (a) => {
    setError('');
    try {
      await descargarAdjunto(a);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo descargar el archivo.'));
    }
  };

  const confirmarBorrado = async () => {
    const a = aBorrar;
    setABorrar(null);
    setError('');
    try {
      await eliminarAdjunto({ adjuntoId: a.id });
      setAdjuntos((prev) => prev.filter((x) => x.id !== a.id));
      onCambio?.();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo borrar el archivo.'));
    }
  };

  const puedeBorrar = (a) => esDueno || (puedeEscribir && user?.id && a.subidoPor === user.id);
  const fotos = adjuntos.filter((a) => esImagen(a.mime));
  const documentos = adjuntos.filter((a) => !esImagen(a.mime));
  const lleno = limites && adjuntos.length + cola.length >= limites.maxPorTurno;
  const elegidos = cola.filter((i) => i.estado === 'elegido');
  const subiendo = cola.filter((i) => i.estado !== 'elegido');
  const compartir = { onError: setError, onAviso: setAviso };

  return (
    <section className="doc-turno-seccion" aria-labelledby={`adj-${appointmentId}`}>
      <div className="doc-turno-titulo-fila">
        <h4 id={`adj-${appointmentId}`} className="doc-turno-titulo"><Icon name="clipboard" /> Archivos</h4>
        {puedeEscribir && (
          <>
            <input ref={inputRef} type="file" multiple accept={ACEPTA} onChange={elegir} hidden />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={!limites || lleno}>
              <Icon name="clip" /> Agregar archivos
            </button>
          </>
        )}
      </div>

      {puedeEscribir && limites && (
        <p className="text-xs text-muted doc-limites">
          Fotos (JPG, PNG, WebP, HEIC) hasta {formatearTamano(limites.imagen.maxBytes)}, se optimizan solas ·
          PDF y Word hasta {formatearTamano(limites.documento.maxBytes)} · hasta {limites.maxPorTurno} archivos por turno.
        </p>
      )}

      {/* Elegidos y todavía sin guardar: lo que se va a guardar y el botón. */}
      {elegidos.length > 0 && (
        <div className="doc-elegidos" role="region" aria-label="Archivos para guardar">
          <p className="doc-elegidos-titulo">
            <Icon name="warning" />{' '}
            {elegidos.length === 1 ? 'Elegiste 1 archivo.' : `Elegiste ${elegidos.length} archivos.`}{' '}
            <strong>Todavía no se guardó:</strong> tocá <strong>Guardar</strong>.
          </p>
          <ul className="doc-elegidos-lista">
            {elegidos.map((i) => (
              <li key={i.key} className="doc-elegido">
                {i.vista
                  ? <img src={i.vista} alt="" width="48" height="48" />
                  : <span className="doc-documento-tipo">{(i.file.name.split('.').pop() || 'archivo').toUpperCase()}</span>}
                <div className="doc-cola-info">
                  <span className="doc-cola-nombre">{i.file.name}</span>
                  <span className="text-xs text-muted">{formatearTamano(i.file.size)}</span>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => quitarDeCola(i.key)} aria-label={`Quitar ${i.file.name}`}>
                  <Icon name="x" /> Quitar
                </button>
              </li>
            ))}
          </ul>
          <div className="doc-elegidos-acciones">
            <button type="button" className="btn btn-primary" onClick={guardarElegidos}>
              <Icon name="save" /> {elegidos.length === 1 ? 'Guardar' : `Guardar ${elegidos.length} archivos`}
            </button>
            <button type="button" className="btn btn-ghost" onClick={descartarElegidos}>Cancelar</button>
          </div>
        </div>
      )}

      {subiendo.length > 0 && (
        <ul className="doc-cola" aria-live="polite">
          {subiendo.map((i) => (
            <li key={i.key} className={`doc-cola-item ${i.estado === 'error' ? 'con-error' : ''}`}>
              <div className="doc-cola-info">
                <span className="doc-cola-nombre">{i.file.name}</span>
                <span className="text-xs text-muted">
                  {i.estado === 'error' ? i.error : `${i.etapa === 'Subiendo…' ? 'Guardando…' : i.etapa}${i.estado === 'subiendo' && i.progreso ? ` ${Math.round(i.progreso * 100)}%` : ''}`}
                </span>
                {i.estado === 'subiendo' && (
                  <div className="doc-progreso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(i.progreso * 100)} aria-label={`Guardando ${i.file.name}`}>
                    <div style={{ width: `${Math.round(i.progreso * 100)}%` }} />
                  </div>
                )}
              </div>
              {i.estado === 'error' ? (
                <div className="flex gap-sm">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => actualizar(i.key, { estado: 'esperando', etapa: 'En espera', error: '' })}>Reintentar</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => quitarDeCola(i.key)} aria-label="Quitar"><Icon name="x" /></button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => (i.controller ? i.controller.abort() : quitarDeCola(i.key))}
                >
                  Cancelar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Confirmación visible de que quedó guardado. */}
      {guardados.length > 0 && !enCurso && (
        <div className="notice doc-guardado" role="status">
          <Icon name="check-circle" />{' '}
          {guardados.length === 1
            ? <>Se guardó <strong>{guardados[0]}</strong>.</>
            : <>Se guardaron <strong>{guardados.length} archivos</strong>.</>}
        </div>
      )}

      {aviso && (
        <div className="notice notice-info doc-turno-error" role="status">
          {aviso}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAviso('')}>Entendido</button>
        </div>
      )}

      {error && (
        <div className="notice notice-danger doc-turno-error" role="alert">
          {error}
          <button type="button" className="btn btn-ghost btn-sm" onClick={cargar}>Reintentar</button>
        </div>
      )}

      {cargando && adjuntos.length === 0 ? (
        <div className="doc-turno-cargando" role="status"><span className="spinner spinner-sm" aria-hidden="true" /> Cargando archivos…</div>
      ) : adjuntos.length === 0 && cola.length === 0 && !error ? (
        <p className="text-sm text-muted">Este turno no tiene archivos.</p>
      ) : (
        <>
          {fotos.length > 0 && (
            <ul className="doc-galeria">
              {fotos.map((a) => (
                <li key={a.id} className="doc-foto">
                  <button type="button" className="doc-foto-boton" onClick={() => abrir(a)} aria-label={`Ver ${a.nombreOriginal}`}>
                    {miniaturas[a.rutaMiniatura]
                      ? <img src={miniaturas[a.rutaMiniatura]} alt="" loading="lazy" decoding="async" width="120" height="120" />
                      : <span className="doc-foto-sin"><Icon name="note" /> {etiquetaTipo(a.mime)}</span>}
                  </button>
                  <div className="doc-foto-pie">
                    <span className="text-xs text-muted" title={a.nombreOriginal}>{formatearTamano(a.tamanoBytes)}</span>
                    <div className="flex">
                      <BotonCompartir adjunto={a} {...compartir} />
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => descargar(a)} aria-label={`Descargar ${a.nombreOriginal}`}><Icon name="download" /></button>
                      {puedeBorrar(a) && (
                        <button type="button" className="btn btn-ghost btn-icon btn-sm doc-peligro" onClick={() => setABorrar(a)} aria-label={`Borrar ${a.nombreOriginal}`}><Icon name="trash" /></button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {documentos.length > 0 && (
            <ul className="doc-documentos">
              {documentos.map((a) => (
                <li key={a.id} className="doc-documento">
                  <span className="doc-documento-tipo">{etiquetaTipo(a.mime)}</span>
                  <div className="doc-documento-info">
                    <button type="button" className="doc-documento-nombre" onClick={() => abrir(a)}>{a.nombreOriginal}</button>
                    <span className="text-xs text-muted">
                      {formatearTamano(a.tamanoBytes)} · {fecha(a.createdAt)}{a.subidoPorNombre ? ` · ${a.subidoPorNombre}` : ''}
                    </span>
                  </div>
                  <BotonCompartir adjunto={a} conTexto {...compartir} />
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => descargar(a)} aria-label={`Descargar ${a.nombreOriginal}`}><Icon name="download" /></button>
                  {puedeBorrar(a) && (
                    <button type="button" className="btn btn-ghost btn-icon btn-sm doc-peligro" onClick={() => setABorrar(a)} aria-label={`Borrar ${a.nombreOriginal}`}><Icon name="trash" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {aBorrar && (
        <div className="doc-confirmar" role="alertdialog" aria-label="Confirmar borrado">
          <p>¿Borrar <strong>{aBorrar.nombreOriginal}</strong>? No se puede deshacer.</p>
          <div className="flex gap-sm">
            <button type="button" className="btn btn-danger btn-sm" onClick={confirmarBorrado}>Sí, borrar</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setABorrar(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {visor && (
        <VisorImagen
          nombre={visor.adjunto.nombreOriginal}
          url={visor.url}
          onClose={() => setVisor(null)}
          acciones={(
            <>
              <BotonCompartir adjunto={visor.adjunto} conTexto {...compartir} />
              <button type="button" className="btn btn-outline btn-sm" onClick={() => descargar(visor.adjunto)}>
                <Icon name="download" /> Descargar
              </button>
            </>
          )}
        />
      )}
    </section>
  );
}
