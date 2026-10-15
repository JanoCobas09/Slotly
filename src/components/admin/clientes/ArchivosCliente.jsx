import { useCallback, useEffect, useRef, useState } from 'react';
import { listarArchivosCliente, urlsDeMiniaturas } from '../../../lib/repository';
import { seVeEnVisor, urlParaVisor, abrirEnPestana, descargarAdjunto } from '../../../lib/verAdjunto';
import { esImagen, formatearTamano, etiquetaTipo } from '../../../utils/archivos';
import { formatFechaCorta } from '../../../utils/dateUtils';
import { ESTADOS_TURNO } from '../../../utils/turnos';
import { mensajeDeError } from '../../../utils/errores';
import VisorImagen from './VisorImagen';
import BotonCompartir from './BotonCompartir';
import Icon from '../../Icon';

const FILTROS = [
  ['', 'Todos'],
  ['imagen', 'Fotos'],
  ['documento', 'Documentos'],
];

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const fechaTurno = (iso) => `${DIAS[new Date(`${iso}T12:00:00`).getDay()]} ${formatFechaCorta(iso)}`;

/** Agrupa archivos consecutivos del mismo turno (ya vienen ordenados por turno). */
function agruparPorTurno(archivos) {
  const grupos = [];
  for (const a of archivos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.turno.id === a.turno.id) ultimo.archivos.push(a);
    else grupos.push({ turno: a.turno, archivos: [a] });
  }
  return grupos;
}

/**
 * Todos los archivos del cliente, de todos sus turnos, en un solo lugar.
 * Cada bloque dice de qué turno es (fecha, hora, servicio, profesional) y
 * deja abrir ese turno. Paginado en el servidor (de a 24); de las fotos se
 * piden solo las miniaturas, con carga diferida.
 */
export default function ArchivosCliente({ clienteId, onAbrirTurno, recargar = 0 }) {
  const [filtro, setFiltro] = useState('');
  const [archivos, setArchivos] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [miniaturas, setMiniaturas] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [visor, setVisor] = useState(null);
  const [aviso, setAviso] = useState('');
  const pedido = useRef(0);

  const cargar = useCallback(async (pag) => {
    const n = ++pedido.current;
    setCargando(true);
    setError('');
    try {
      const res = await listarArchivosCliente(clienteId, { categoria: filtro || null, pagina: pag });
      const rutas = res.archivos.filter((a) => a.rutaMiniatura).map((a) => a.rutaMiniatura);
      const urls = rutas.length ? await urlsDeMiniaturas(rutas) : {};
      if (n !== pedido.current) return;
      setArchivos((prev) => (pag === 0 ? res.archivos : [...prev, ...res.archivos]));
      setMiniaturas((prev) => (pag === 0 ? urls : { ...prev, ...urls }));
      setTotal(res.total);
      setPagina(pag);
    } catch (e) {
      if (n === pedido.current) setError(mensajeDeError(e, 'No se pudieron cargar los archivos.'));
    } finally {
      if (n === pedido.current) setCargando(false);
    }
  }, [clienteId, filtro]);

  useEffect(() => { cargar(0); }, [cargar, recargar]);

  const abrir = async (a) => {
    setError('');
    try {
      if (seVeEnVisor(a)) {
        const t = a.turno;
        setVisor({
          adjunto: a,
          nombre: a.nombreOriginal,
          url: await urlParaVisor(a),
          detalle: `Turno del ${fechaTurno(t.appointmentDate)}${t.serviceName ? ` · ${t.serviceName}` : ''}`,
        });
      } else {
        await abrirEnPestana(a);
      }
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

  const grupos = agruparPorTurno(archivos);
  // Compartir (WhatsApp, mail…): ver BotonCompartir.
  const compartir = { onError: setError, onAviso: setAviso };

  return (
    <div className="archivos-cliente">
      <div className="archivos-cliente-filtros" role="group" aria-label="Filtrar archivos">
        {FILTROS.map(([valor, etiqueta]) => (
          <button
            key={valor || 'todos'}
            type="button"
            className={`chip-filtro ${filtro === valor ? 'activo' : ''}`}
            aria-pressed={filtro === valor}
            onClick={() => setFiltro(valor)}
          >
            {etiqueta}
          </button>
        ))}
        {total > 0 && <span className="text-xs text-muted">{total} {total === 1 ? 'archivo' : 'archivos'}</span>}
      </div>

      {aviso && (
        <div className="notice notice-info doc-turno-error" role="status">
          {aviso}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAviso('')}>Entendido</button>
        </div>
      )}

      {error && (
        <div className="notice notice-danger doc-turno-error" role="alert">
          {error}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => cargar(archivos.length ? pagina + 1 : 0)}>Reintentar</button>
        </div>
      )}

      {cargando && archivos.length === 0 ? (
        <div className="mov-cargando" role="status" style={{ minHeight: 120 }}><div className="spinner" aria-hidden="true" /><span className="sr-only">Cargando archivos…</span></div>
      ) : archivos.length === 0 && !error ? (
        <p className="text-sm text-muted ficha-historial-vacio">
          {filtro
            ? `No hay ${filtro === 'imagen' ? 'fotos' : 'documentos'} de este cliente.`
            : 'Este cliente todavía no tiene archivos. Se adjuntan desde cada turno del historial.'}
        </p>
      ) : (
        <div className="archivos-grupos">
          {grupos.map(({ turno: t, archivos: lista }) => {
            const est = ESTADOS_TURNO[t.status] || { label: t.status, clase: 'badge-neutral' };
            const fotos = lista.filter((a) => esImagen(a.mime));
            const docs = lista.filter((a) => !esImagen(a.mime));
            return (
              <section key={`${t.id}-${lista[0].id}`} className="archivos-grupo" aria-label={`Turno del ${fechaTurno(t.appointmentDate)}`}>
                <header className="archivos-grupo-cabecera">
                  <div className="archivos-grupo-turno">
                    <strong><Icon name="calendar" /> {fechaTurno(t.appointmentDate)} · {t.startTime} hs</strong>
                    <span className="text-xs text-muted">
                      {[t.serviceName, t.professionalName].filter(Boolean).join(' · ') || 'Turno'}
                    </span>
                  </div>
                  <span className={`badge ${est.clase}`}>{est.label}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAbrirTurno?.(t)}>
                    Ver turno
                  </button>
                </header>

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
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {docs.length > 0 && (
                  <ul className="doc-documentos">
                    {docs.map((a) => (
                      <li key={a.id} className="doc-documento">
                        <span className="doc-documento-tipo">{etiquetaTipo(a.mime)}</span>
                        <div className="doc-documento-info">
                          <button type="button" className="doc-documento-nombre" onClick={() => abrir(a)}>{a.nombreOriginal}</button>
                          <span className="text-xs text-muted">
                            {formatearTamano(a.tamanoBytes)}{a.subidoPorNombre ? ` · ${a.subidoPorNombre}` : ''}
                          </span>
                        </div>
                        <BotonCompartir adjunto={a} conTexto {...compartir} />
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => descargar(a)} aria-label={`Descargar ${a.nombreOriginal}`}><Icon name="download" /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {archivos.length < total && !error && (
        <button type="button" className="btn btn-outline btn-sm historial-mas" disabled={cargando} onClick={() => cargar(pagina + 1)}>
          {cargando ? 'Cargando…' : `Ver más (${total - archivos.length} restantes)`}
        </button>
      )}

      {visor && (
        <VisorImagen
          nombre={visor.nombre}
          url={visor.url}
          detalle={visor.detalle}
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
    </div>
  );
}
