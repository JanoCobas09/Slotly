import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { listarClientes, CLIENTES_POR_PAGINA } from '../../lib/repository';
import { formatFechaCorta } from '../../utils/dateUtils';
import ClienteFormModal from '../../components/admin/clientes/ClienteFormModal';
import Icon from '../../components/Icon';
import { mensajeDeError } from '../../utils/errores';

const FILTROS = [
  ['todos', 'Todos'],
  ['con_proximo', 'Con turno próximo'],
  ['con_cuenta', 'Con cuenta de Google'],
  ['sin_cuenta', 'Sin cuenta'],
];
const ORDENES = [
  ['reciente', 'Último turno'],
  ['nombre', 'Nombre (A-Z)'],
  ['nuevos', 'Agregados recientemente'],
];

const fechaCorta = (iso) => (iso ? formatFechaCorta(iso) : null);

/**
 * Clientes del negocio. Todo (búsqueda, filtro, orden, página) se resuelve
 * en el servidor con listar_clientes(): con miles de fichas, el navegador
 * nunca recibe más de una página. El estado vive en la URL: volver desde una
 * ficha deja el listado como estaba.
 */
export default function ClientesPage() {
  const { user } = useAuth();
  const { business } = useTenant();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const filtro = params.get('filtro') || 'todos';
  const orden = params.get('orden') || 'reciente';
  const pagina = Math.max(0, Number(params.get('p')) || 0);

  const [texto, setTexto] = useState(q);
  const [datos, setDatos] = useState({ clientes: [], total: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [reintento, setReintento] = useState(0);
  const [nuevo, setNuevo] = useState(false);
  const pedido = useRef(0);

  const esDueno = user?.role === 'owner' && !user?.isPlatformTeam;

  const cambiar = (cambios) => {
    const siguiente = new URLSearchParams(params);
    Object.entries(cambios).forEach(([k, v]) => {
      if (v === '' || v === null || v === undefined || (k === 'p' && v === 0) || (k === 'filtro' && v === 'todos') || (k === 'orden' && v === 'reciente')) siguiente.delete(k);
      else siguiente.set(k, String(v));
    });
    setParams(siguiente, { replace: true });
  };

  // Búsqueda con espera de 300 ms: no una consulta por tecla.
  useEffect(() => {
    if (texto === q) return undefined;
    const t = setTimeout(() => cambiar({ q: texto.trim(), p: 0 }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  useEffect(() => {
    if (!business?.id) return;
    const id = ++pedido.current;
    setCargando(true);
    setError('');
    listarClientes(business.id, { busqueda: q, filtro, orden, pagina })
      .then((res) => { if (id === pedido.current) setDatos(res); })
      .catch((e) => { if (id === pedido.current) setError(mensajeDeError(e, 'No se pudieron cargar los clientes.')); })
      .finally(() => { if (id === pedido.current) setCargando(false); });
  }, [business?.id, q, filtro, orden, pagina, reintento]);

  const { clientes, total } = datos;
  const paginas = Math.max(1, Math.ceil(total / CLIENTES_POR_PAGINA));
  const desde = total === 0 ? 0 : pagina * CLIENTES_POR_PAGINA + 1;
  const hasta = Math.min(total, (pagina + 1) * CLIENTES_POR_PAGINA);
  const filtrando = Boolean(q) || filtro !== 'todos';

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Clientes</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            {user?.role === 'admin'
              ? 'Las personas que atendiste, con su historial y la documentación de cada turno.'
              : 'Cada persona que reservó, con su historial y la documentación de cada turno.'}
          </p>
        </div>
        {esDueno && <button className="btn btn-primary" onClick={() => setNuevo(true)}>+ Nuevo cliente</button>}
      </div>

      <div className="clientes-filtros card">
        <div className="clientes-buscador">
          <Icon name="search" />
          <label className="sr-only" htmlFor="buscar-clientes">Buscar clientes</label>
          <input
            id="buscar-clientes"
            type="search"
            className="form-input"
            placeholder="Buscar por nombre, email o teléfono"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <div className="clientes-selects">
          <label className="sr-only" htmlFor="filtro-clientes">Filtrar</label>
          <select id="filtro-clientes" className="form-input" value={filtro} onChange={(e) => cambiar({ filtro: e.target.value, p: 0 })}>
            {FILTROS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="sr-only" htmlFor="orden-clientes">Ordenar</label>
          <select id="orden-clientes" className="form-input" value={orden} onChange={(e) => cambiar({ orden: e.target.value, p: 0 })}>
            {ORDENES.map(([v, l]) => <option key={v} value={v}>Orden: {l}</option>)}
          </select>
        </div>
      </div>

      {error ? (
        <div className="card empty-state" role="alert">
          <div className="empty-state-icon"><Icon name="warning" /></div>
          <h3>No se pudieron cargar los clientes</h3>
          <p className="text-sm text-muted">{error}</p>
          <button className="btn btn-primary btn-sm" onClick={() => setReintento((n) => n + 1)}>Reintentar</button>
        </div>
      ) : !cargando && clientes.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state-icon"><Icon name={filtrando ? 'search' : 'users'} /></div>
          {filtrando ? (
            <>
              <h3>No hay clientes que coincidan</h3>
              <p className="text-sm text-muted">Probá con otra búsqueda o sacá el filtro.</p>
              <button className="btn btn-outline btn-sm" onClick={() => { setTexto(''); cambiar({ q: '', filtro: 'todos', p: 0 }); }}>Limpiar búsqueda</button>
            </>
          ) : (
            <>
              <h3>Todavía no hay clientes</h3>
              <p className="text-sm text-muted">
                Cada persona que reserve desde tu link aparece acá sola, con su historial.
                {esDueno && ' También podés cargar una ficha a mano.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className={`card clientes-lista ${cargando ? 'actualizando' : ''}`} style={{ padding: 0 }} aria-busy={cargando}>
          {cargando && clientes.length === 0 ? (
            <div className="mov-cargando" role="status"><div className="spinner" aria-hidden="true" /><span className="sr-only">Cargando clientes…</span></div>
          ) : (
            <table className="data-table clientes-tabla">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="oculta-mobile">Email</th>
                  <th>Último turno</th>
                  <th className="oculta-mobile">Próximo</th>
                  <th className="text-center">Turnos</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/admin/clientes/${c.id}`)} className="fila-clickeable">
                    <td>
                      <Link to={`/admin/clientes/${c.id}`} className="clientes-nombre" onClick={(e) => e.stopPropagation()}>
                        <span className="avatar avatar-sm" aria-hidden="true">{c.nombre.charAt(0).toUpperCase()}</span>
                        <span>
                          <strong>{c.nombre}</strong>
                          <span className="clientes-sub text-xs text-muted">{c.email || c.telefono || (c.conCuenta ? '' : 'Sin cuenta')}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="oculta-mobile text-sm">{c.email || <span className="text-muted">—</span>}</td>
                    <td className="text-sm">{fechaCorta(c.ultimoTurno) || <span className="text-muted">—</span>}</td>
                    <td className="oculta-mobile text-sm">
                      {c.proximoTurno ? <span className="badge badge-success">{fechaCorta(c.proximoTurno)}</span> : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-center"><span className="badge badge-neutral">{c.cantidadTurnos}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!error && total > 0 && (
        <nav className="clientes-paginacion" aria-label="Páginas de clientes">
          <span className="text-sm text-muted">{desde}–{hasta} de {total}</span>
          <div className="flex gap-sm">
            <button className="btn btn-outline btn-sm" disabled={pagina === 0 || cargando} onClick={() => cambiar({ p: pagina - 1 })}>← Anterior</button>
            <button className="btn btn-outline btn-sm" disabled={pagina + 1 >= paginas || cargando} onClick={() => cambiar({ p: pagina + 1 })}>Siguiente →</button>
          </div>
        </nav>
      )}

      {nuevo && business && (
        <ClienteFormModal
          businessId={business.id}
          onClose={() => setNuevo(false)}
          onGuardado={(id) => { setNuevo(false); navigate(`/admin/clientes/${id}`); }}
        />
      )}
    </div>
  );
}
