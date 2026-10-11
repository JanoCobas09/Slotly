import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { listarClientes, vincularTurnoCliente, crearClienteDesdeTurno } from '../../../lib/repository';
import { puedeDocumentar } from '../../../utils/turnos';
import Icon from '../../Icon';
import { mensajeDeError } from '../../../utils/errores';

/**
 * En el detalle de un turno: acceso a la ficha del cliente, o, en un turno
 * cargado a mano, vincularlo a una ficha (es el equipo el que sabe quién es
 * la persona: nunca se vincula solo por nombre o mail). Las reservas con
 * cuenta ya llegan vinculadas.
 */
export default function ClienteDelTurno({ apt, onNavegar }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [modo, setModo] = useState(null); // null | 'buscar'
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');

  const manual = apt.type === 'manual';
  const puede = puedeDocumentar(user, apt);

  useEffect(() => {
    if (modo !== 'buscar') return undefined;
    const q = busqueda.trim();
    if (q.length < 2) { setResultados([]); return undefined; }
    let vigente = true;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const { clientes } = await listarClientes(apt.businessId, { busqueda: q, orden: 'nombre', porPagina: 8 });
        if (vigente) setResultados(clientes);
      } catch (e) {
        if (vigente) setError(mensajeDeError(e, 'No se pudo buscar.'));
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [busqueda, modo, apt.businessId]);

  const irAFicha = (id) => {
    onNavegar?.();
    navigate(`/admin/clientes/${id}`);
  };

  const accion = async (fn) => {
    setTrabajando(true);
    setError('');
    try {
      await fn();
      setModo(null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo completar.'));
    } finally {
      setTrabajando(false);
    }
  };

  if (apt.type === 'walkin') return null;

  if (apt.clienteId) {
    return (
      <div className="cliente-del-turno">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => irAFicha(apt.clienteId)}>
          <Icon name="user" /> Ver ficha del cliente
        </button>
        {manual && puede && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={trabajando} onClick={() => accion(() => vincularTurnoCliente(apt.id, null))}>
            Desvincular
          </button>
        )}
        {error && <div className="notice notice-danger" role="alert">{error}</div>}
      </div>
    );
  }

  if (!manual || !puede) return null;

  return (
    <div className="cliente-del-turno cliente-del-turno-sin">
      <p className="text-xs text-muted">Este turno no está en ninguna ficha de cliente.</p>
      {modo !== 'buscar' ? (
        <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={trabajando} onClick={() => accion(() => crearClienteDesdeTurno(apt.id))}>
            <Icon name="user" /> {trabajando ? 'Creando…' : 'Crear ficha con estos datos'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModo('buscar')}>
            <Icon name="link" /> Vincular a una ficha
          </button>
        </div>
      ) : (
        <div className="cliente-del-turno-buscar">
          <label className="sr-only" htmlFor={`buscar-cli-${apt.id}`}>Buscar cliente</label>
          <input
            id={`buscar-cli-${apt.id}`}
            className="form-input"
            placeholder="Buscar por nombre, email o teléfono"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            autoFocus
          />
          {buscando && <span className="text-xs text-muted">Buscando…</span>}
          {!buscando && busqueda.trim().length >= 2 && resultados.length === 0 && (
            <span className="text-xs text-muted">No hay fichas que coincidan.</span>
          )}
          {resultados.length > 0 && (
            <ul className="cliente-del-turno-resultados">
              {resultados.map((c) => (
                <li key={c.id}>
                  <button type="button" disabled={trabajando} onClick={() => accion(() => vincularTurnoCliente(apt.id, c.id))}>
                    <strong>{c.nombre}</strong>
                    <span className="text-xs text-muted">{[c.email, c.telefono].filter(Boolean).join(' · ') || 'Sin contacto'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModo(null)}>Cancelar</button>
        </div>
      )}
      {error && <div className="notice notice-danger" role="alert">{error}</div>}
    </div>
  );
}
