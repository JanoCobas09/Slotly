import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { getFichaCliente, getHistorialCliente, TURNOS_POR_PAGINA } from '../../lib/repository';
import { formatDate, formatFechaCorta, formatPrice } from '../../utils/dateUtils';
import { capitalize } from '../../utils/text';
import { ESTADOS_TURNO } from '../../utils/turnos';
import ClienteFormModal from '../../components/admin/clientes/ClienteFormModal';
import DocumentacionTurno from '../../components/admin/clientes/DocumentacionTurno';
import Icon from '../../components/Icon';
import { mensajeDeError } from '../../utils/errores';

const FILTROS_VACIOS = { desde: '', hasta: '', estado: '', servicioId: '' };

const fechaLarga = (iso) => capitalize(formatDate(iso));

/** Un turno del historial abierto: sus datos y su documentación. */
function TurnoHistorialModal({ turno, onClose, onCambio }) {
  const { business } = useTenant();
  const { terminology } = useBusinessContext();
  const est = ESTADOS_TURNO[turno.status] || { label: turno.status, clase: 'badge-neutral' };
  const filas = [
    ['calendar', 'Día', fechaLarga(turno.appointmentDate)],
    ['clock', 'Hora', `${turno.startTime}${turno.endTime ? ` a ${turno.endTime}` : ''} hs`],
    turno.serviceName && ['services', 'Servicio', turno.serviceName],
    turno.professionalName && ['user', capitalize(terminology.professionalNoun), turno.professionalName],
    Number(turno.price) > 0 && ['money', 'Precio', formatPrice(Number(turno.price), business?.currency)],
    turno.notes && ['note', 'Notas de la reserva', turno.notes],
  ].filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content detalle-turno" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }} role="dialog" aria-labelledby="titulo-turno-historial">
        <div className="modal-header">
          <h3 id="titulo-turno-historial" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {turno.serviceName || capitalize(terminology.appointmentNoun)}
            <span className={`badge ${est.clase}`}>{est.label}</span>
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>
        <div className="modal-body">
          <dl className="detalle-turno-datos">
            {filas.map(([icono, etiqueta, valor]) => (
              <div key={etiqueta} className="detalle-turno-fila">
                <dt><Icon name={icono} /> {etiqueta}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
          {turno.status === 'cancelada' && (
            <div className="notice notice-danger" style={{ marginTop: 'var(--space-md)' }}>
              <strong>Cancelado por {turno.cancelledBy === 'client' ? 'el cliente' : 'el negocio'}</strong>
              {turno.cancellationReason && <div style={{ marginTop: 4 }}>Motivo: {turno.cancellationReason}</div>}
            </div>
          )}
          <DocumentacionTurno apt={turno} onCambio={onCambio} />
        </div>
      </div>
    </div>
  );
}

/**
 * Ficha de un cliente: datos, métricas y el historial de turnos paginado en
 * el servidor (de a 20, "Ver más"). Al abrir un turno se cargan recién ahí
 * sus comentarios y archivos: abrir la ficha nunca baja documentación.
 */
export default function ClienteFichaPage() {
  const { id } = useParams();
  const { business, services } = useTenant();
  const { terminology } = useBusinessContext();

  const [ficha, setFicha] = useState(null);
  const [estadoFicha, setEstadoFicha] = useState('cargando'); // cargando | lista | no-existe | error
  const [errorFicha, setErrorFicha] = useState('');
  const [editar, setEditar] = useState(false);

  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [turnos, setTurnos] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [cargandoHist, setCargandoHist] = useState(true);
  const [errorHist, setErrorHist] = useState('');
  const [abierto, setAbierto] = useState(null);
  const cambioEnTurno = useRef(false);
  const pedido = useRef(0);

  const cargarFicha = useCallback(async () => {
    setEstadoFicha('cargando');
    try {
      const f = await getFichaCliente(id);
      setFicha(f);
      setEstadoFicha(f ? 'lista' : 'no-existe');
    } catch (e) {
      setErrorFicha(mensajeDeError(e, 'No se pudo cargar la ficha.'));
      setEstadoFicha('error');
    }
  }, [id]);

  useEffect(() => { cargarFicha(); }, [cargarFicha]);

  const cargarHistorial = useCallback(async (pag, filtrosActuales) => {
    const n = ++pedido.current;
    setCargandoHist(true);
    setErrorHist('');
    try {
      const res = await getHistorialCliente(id, { ...filtrosActuales, pagina: pag });
      if (n !== pedido.current) return;
      setTurnos((prev) => (pag === 0 ? res.turnos : [...prev, ...res.turnos]));
      setTotal(res.total);
      setPagina(pag);
    } catch (e) {
      if (n === pedido.current) setErrorHist(mensajeDeError(e, 'No se pudo cargar el historial.'));
    } finally {
      if (n === pedido.current) setCargandoHist(false);
    }
  }, [id]);

  useEffect(() => { cargarHistorial(0, filtros); }, [cargarHistorial, filtros]);

  const cerrarTurno = () => {
    setAbierto(null);
    // Si se comentó o adjuntó algo, se refrescan los contadores de la lista.
    if (cambioEnTurno.current) {
      cambioEnTurno.current = false;
      cargarHistorial(0, filtros);
    }
  };

  if (estadoFicha === 'cargando' && !ficha) {
    return <div className="mov-cargando" role="status"><div className="spinner" aria-hidden="true" /><span className="sr-only">Cargando ficha…</span></div>;
  }
  if (estadoFicha === 'no-existe' || estadoFicha === 'error') {
    return (
      <div className="card empty-state">
        <div className="empty-state-icon"><Icon name={estadoFicha === 'error' ? 'warning' : 'user-x'} /></div>
        <h3>{estadoFicha === 'error' ? 'No se pudo cargar la ficha' : 'No encontramos este cliente'}</h3>
        <p className="text-sm text-muted">
          {estadoFicha === 'error' ? errorFicha : 'Puede que no exista o que no tengas acceso a esta ficha.'}
        </p>
        <div className="flex gap-sm" style={{ justifyContent: 'center' }}>
          {estadoFicha === 'error' && <button className="btn btn-primary btn-sm" onClick={cargarFicha}>Reintentar</button>}
          <Link to="/admin/clientes" className="btn btn-outline btn-sm">Volver a Clientes</Link>
        </div>
      </div>
    );
  }

  const filtrando = Object.values(filtros).some(Boolean);
  const metricas = [
    ['Turnos', ficha.totalTurnos],
    ['Completados', ficha.completados],
    ['Cancelados', ficha.cancelados],
    ['Ausencias', ficha.ausencias],
  ];

  return (
    <div className="ficha-cliente">
      <Link to="/admin/clientes" className="ficha-volver text-sm"><Icon name="chevron-right" style={{ transform: 'rotate(180deg)' }} /> Clientes</Link>

      <div className="card ficha-cabecera">
        <span className="avatar avatar-lg" aria-hidden="true">{ficha.nombre.charAt(0).toUpperCase()}</span>
        <div className="ficha-cabecera-datos">
          <h1>{ficha.nombre}</h1>
          <div className="ficha-contacto text-sm">
            {ficha.email && <a href={`mailto:${ficha.email}`}><Icon name="mail" /> {ficha.email}</a>}
            {ficha.telefono && <a href={`tel:${ficha.telefono}`}><Icon name="phone" /> {ficha.telefono}</a>}
            {!ficha.email && !ficha.telefono && <span className="text-muted">Sin datos de contacto</span>}
          </div>
          <div className="ficha-etiquetas">
            <span className={`badge ${ficha.conCuenta ? 'badge-success' : 'badge-neutral'}`}>
              {ficha.conCuenta ? 'Con cuenta de Google' : 'Sin cuenta'}
            </span>
            <span className="text-xs text-muted">Ficha creada el {formatFechaCorta(ficha.createdAt.slice(0, 10))}</span>
          </div>
        </div>
        {ficha.puedeEditar && (
          <button className="btn btn-outline btn-sm" onClick={() => setEditar(true)}><Icon name="edit" /> Editar</button>
        )}
      </div>

      <div className="ficha-resumen">
        <div className="card ficha-proximos">
          <div>
            <span className="ficha-etiqueta">Último {terminology.appointmentNoun}</span>
            {ficha.ultimoTurno
              ? <strong>{formatFechaCorta(ficha.ultimoTurno.fecha)} · {ficha.ultimoTurno.hora} hs{ficha.ultimoTurno.servicio ? ` · ${ficha.ultimoTurno.servicio}` : ''}</strong>
              : <span className="text-muted">—</span>}
          </div>
          <div>
            <span className="ficha-etiqueta">Próximo {terminology.appointmentNoun}</span>
            {ficha.proximoTurno
              ? <strong>{formatFechaCorta(ficha.proximoTurno.fecha)} · {ficha.proximoTurno.hora} hs{ficha.proximoTurno.servicio ? ` · ${ficha.proximoTurno.servicio}` : ''}</strong>
              : <span className="text-muted">Sin turnos próximos</span>}
          </div>
        </div>
        <div className="ficha-metricas">
          {metricas.map(([etiqueta, valor]) => (
            <div key={etiqueta} className="card ficha-metrica">
              <strong>{valor}</strong>
              <span className="text-xs text-muted">{etiqueta}</span>
            </div>
          ))}
        </div>
      </div>

      {(ficha.observaciones || ficha.puedeEditar) && (
        <div className="card ficha-observaciones">
          <div className="ficha-seccion-titulo">
            <h3><Icon name="note" /> Observaciones</h3>
            {ficha.puedeEditar && <button className="btn btn-ghost btn-sm" onClick={() => setEditar(true)}>{ficha.observaciones ? 'Editar' : 'Agregar'}</button>}
          </div>
          {ficha.observaciones
            ? <p className="ficha-observaciones-texto">{ficha.observaciones}</p>
            : <p className="text-sm text-muted">Notas generales sobre este cliente, visibles solo para el equipo.</p>}
        </div>
      )}

      <section className="card ficha-historial" aria-labelledby="titulo-historial">
        <div className="ficha-seccion-titulo">
          <h3 id="titulo-historial"><Icon name="calendar" /> Historial</h3>
          <span className="text-xs text-muted">{total} {total === 1 ? terminology.appointmentNoun : `${terminology.appointmentNoun}s`}{filtrando ? ' con estos filtros' : ''}</span>
        </div>

        <div className="ficha-filtros">
          <label className="form-group">
            <span className="form-label text-xs">Desde</span>
            <input type="date" className="form-input" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} />
          </label>
          <label className="form-group">
            <span className="form-label text-xs">Hasta</span>
            <input type="date" className="form-input" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} />
          </label>
          <label className="form-group">
            <span className="form-label text-xs">Estado</span>
            <select className="form-input" value={filtros.estado} onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}>
              <option value="">Todos</option>
              {Object.entries(ESTADOS_TURNO).map(([v, { label }]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          <label className="form-group">
            <span className="form-label text-xs">Servicio</span>
            <select className="form-input" value={filtros.servicioId} onChange={(e) => setFiltros((f) => ({ ...f, servicioId: e.target.value }))}>
              <option value="">Todos</option>
              {(services || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {filtrando && <button className="btn btn-ghost btn-sm ficha-filtros-limpiar" onClick={() => setFiltros(FILTROS_VACIOS)}>Limpiar</button>}
        </div>

        {errorHist && (
          <div className="notice notice-danger doc-turno-error" role="alert">
            {errorHist}
            <button className="btn btn-ghost btn-sm" onClick={() => cargarHistorial(turnos.length ? pagina + 1 : 0, filtros)}>Reintentar</button>
          </div>
        )}

        {cargandoHist && turnos.length === 0 ? (
          <div className="mov-cargando" role="status" style={{ minHeight: 120 }}><div className="spinner" aria-hidden="true" /><span className="sr-only">Cargando historial…</span></div>
        ) : turnos.length === 0 && !errorHist ? (
          <p className="text-sm text-muted ficha-historial-vacio">
            {filtrando ? 'No hay turnos con estos filtros.' : 'Este cliente todavía no tiene turnos.'}
          </p>
        ) : (
          <ul className="historial-lista">
            {turnos.map((t) => {
              const est = ESTADOS_TURNO[t.status] || { label: t.status, clase: 'badge-neutral' };
              return (
                <li key={t.id}>
                  <button className="historial-turno" onClick={() => setAbierto(t)}>
                    <span className="historial-fecha">
                      <strong>{formatFechaCorta(t.appointmentDate)}</strong>
                      <span className="text-xs text-muted">{t.startTime} hs</span>
                    </span>
                    <span className="historial-info">
                      <span className="historial-servicio">{t.serviceName || (t.type === 'walkin' ? 'Servicio sin turno' : capitalize(terminology.appointmentNoun))}</span>
                      <span className="text-xs text-muted">{t.professionalName || ''}</span>
                    </span>
                    <span className="historial-indicadores">
                      {Number(t.comentarios) > 0 && <span className="historial-indicador" title={`${t.comentarios} comentarios`}><Icon name="chat" /> {t.comentarios}</span>}
                      {Number(t.adjuntos) > 0 && <span className="historial-indicador" title={`${t.adjuntos} archivos`}><Icon name="clip" /> {t.adjuntos}</span>}
                      <span className={`badge ${est.clase}`}>{est.label}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {turnos.length < total && !errorHist && (
          <button className="btn btn-outline btn-sm historial-mas" disabled={cargandoHist} onClick={() => cargarHistorial(pagina + 1, filtros)}>
            {cargandoHist ? 'Cargando…' : `Ver más (${total - turnos.length} restantes)`}
          </button>
        )}
        {turnos.length > 0 && turnos.length < total && (
          <p className="text-xs text-muted text-center">Mostrando {turnos.length} de {total} · de a {TURNOS_POR_PAGINA}</p>
        )}
      </section>

      {abierto && (
        <TurnoHistorialModal
          turno={abierto}
          onClose={cerrarTurno}
          onCambio={() => { cambioEnTurno.current = true; }}
        />
      )}

      {editar && business && (
        <ClienteFormModal
          businessId={business.id}
          ficha={ficha}
          onClose={() => setEditar(false)}
          onGuardado={() => { setEditar(false); cargarFicha(); }}
        />
      )}
    </div>
  );
}
