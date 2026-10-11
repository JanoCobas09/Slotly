import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { listarAdjuntos, getLimitesAdjuntos, urlsDeMiniaturas, urlDeAdjunto } from '../../../lib/repository';
import { eliminarAdjunto } from '../../../lib/functions';
import { subirAdjunto, SubidaCancelada } from '../../../lib/subirAdjunto';
import { esImagen, formatearTamano, etiquetaTipo } from '../../../utils/archivos';
import Icon from '../../Icon';
import { mensajeDeError } from '../../../utils/errores';

const ACEPTA = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

let contador = 0;

/**
 * Archivos de UN turno: fotos (con miniatura) y documentos. La lista trae
 * solo metadatos; de las fotos se piden URLs firmadas de las MINIATURAS (una
 * sola petición) y se cargan con loading="lazy". El original se pide recién
 * al abrirlo (URL de 60 s). Subidas de a una (cola), con progreso,
 * cancelar y reintentar.
 */
export default function AdjuntosTurno({ appointmentId, puedeEscribir, esDueno, onCambio }) {
  const { user } = useAuth();
  const [adjuntos, setAdjuntos] = useState([]);
  const [miniaturas, setMiniaturas] = useState({});
  const [limites, setLimites] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [cola, setCola] = useState([]); // { key, file, estado, etapa, progreso, error, controller }
  const [visor, setVisor] = useState(null); // { nombre, url }
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

  // Cola: de a un archivo por vez, así un celular con mala señal no satura
  // la conexión subiendo diez fotos en paralelo.
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
        setCola((prev) => prev.filter((i) => i.key !== siguiente.key));
        cargar();
        onCambio?.();
      })
      .catch((err) => {
        if (err instanceof SubidaCancelada) {
          setCola((prev) => prev.filter((i) => i.key !== siguiente.key));
        } else {
          actualizar(siguiente.key, { estado: 'error', error: mensajeDeError(err, 'No se pudo subir.'), controller: null });
        }
      })
      .finally(() => { procesando.current = false; setCola((prev) => [...prev]); });
  }, [cola, limites, appointmentId, cargar, onCambio]);

  const elegir = (e) => {
    const archivos = [...(e.target.files || [])];
    e.target.value = '';
    if (!archivos.length) return;
    setCola((prev) => [
      ...prev,
      ...archivos.map((file) => ({ key: `s${++contador}`, file, estado: 'esperando', etapa: 'En espera', progreso: 0, error: '' })),
    ]);
  };

  const abrir = async (a) => {
    setError('');
    if (esImagen(a.mime) && a.mime !== 'image/heic' && a.mime !== 'image/heif') {
      try {
        setVisor({ nombre: a.nombreOriginal, url: await urlDeAdjunto(a.rutaObjeto) });
      } catch (e) {
        setError(mensajeDeError(e, 'No se pudo abrir el archivo.'));
      }
      return;
    }
    // Pestaña abierta en el mismo toque (si no, el navegador la bloquea) y
    // después se le pone la URL firmada.
    const pestana = window.open('', '_blank');
    try {
      const url = await urlDeAdjunto(a.rutaObjeto);
      if (pestana) { pestana.opener = null; pestana.location.href = url; } else window.location.assign(url);
    } catch (e) {
      pestana?.close();
      setError(mensajeDeError(e, 'No se pudo abrir el archivo.'));
    }
  };

  const descargar = async (a) => {
    setError('');
    try {
      const url = await urlDeAdjunto(a.rutaObjeto, { nombre: a.nombreOriginal });
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
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

  return (
    <section className="doc-turno-seccion" aria-labelledby={`adj-${appointmentId}`}>
      <div className="doc-turno-titulo-fila">
        <h4 id={`adj-${appointmentId}`} className="doc-turno-titulo"><Icon name="clipboard" /> Archivos</h4>
        {puedeEscribir && (
          <>
            <input ref={inputRef} type="file" multiple accept={ACEPTA} onChange={elegir} hidden />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={!limites || lleno}>
              <Icon name="clip" /> Adjuntar
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

      {cola.length > 0 && (
        <ul className="doc-cola" aria-live="polite">
          {cola.map((i) => (
            <li key={i.key} className={`doc-cola-item ${i.estado === 'error' ? 'con-error' : ''}`}>
              <div className="doc-cola-info">
                <span className="doc-cola-nombre">{i.file.name}</span>
                <span className="text-xs text-muted">
                  {i.estado === 'error' ? i.error : `${i.etapa}${i.estado === 'subiendo' && i.progreso ? ` ${Math.round(i.progreso * 100)}%` : ''}`}
                </span>
                {i.estado === 'subiendo' && (
                  <div className="doc-progreso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(i.progreso * 100)} aria-label={`Subiendo ${i.file.name}`}>
                    <div style={{ width: `${Math.round(i.progreso * 100)}%` }} />
                  </div>
                )}
              </div>
              {i.estado === 'error' ? (
                <div className="flex gap-sm">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => actualizar(i.key, { estado: 'esperando', etapa: 'En espera', error: '' })}>Reintentar</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCola((prev) => prev.filter((x) => x.key !== i.key))} aria-label="Quitar"><Icon name="x" /></button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => (i.controller ? i.controller.abort() : setCola((prev) => prev.filter((x) => x.key !== i.key)))}
                >
                  Cancelar
                </button>
              )}
            </li>
          ))}
        </ul>
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
        <div className="doc-visor" role="dialog" aria-label={visor.nombre} onClick={() => setVisor(null)}>
          <button type="button" className="doc-visor-cerrar" onClick={() => setVisor(null)} aria-label="Cerrar"><Icon name="x" /></button>
          <img src={visor.url} alt={visor.nombre} onClick={(e) => e.stopPropagation()} />
          <span className="doc-visor-nombre">{visor.nombre}</span>
        </div>
      )}
    </section>
  );
}
