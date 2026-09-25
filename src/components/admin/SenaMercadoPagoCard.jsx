import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMpConnectionStatus } from '../../lib/repository';
import { conectarMercadoPago, desconectarMercadoPago } from '../../lib/functions';
import { formatPrice } from '../../utils/dateUtils';
import Icon from '../Icon';

// Lo que se ve al volver de Mercado Pago (mp-oauth-callback redirige con ?mp=).
const AVISO_VUELTA = {
  conectado: { clase: 'notice-info', texto: 'Listo: tu cuenta de Mercado Pago quedó conectada.' },
  cancelado: { clase: 'notice-warn', texto: 'No se conectó Mercado Pago: cancelaste la autorización.' },
  error: { clase: 'notice-danger', texto: 'No se pudo conectar Mercado Pago. Probá de nuevo.' },
};

/**
 * Configuración de la seña obligatoria (Configuración → "Seña con Mercado
 * Pago"). Apagada por defecto en todos los negocios.
 *
 * Conectar/desconectar la cuenta se hace al toque (no espera "Guardar
 * Cambios": es un ida y vuelta con Mercado Pago). Activar la seña, el tipo y
 * el monto sí son campos del formulario y se guardan con el resto.
 */
export default function SenaMercadoPagoCard({ form, editar, businessId, terminology }) {
  const [params, setParams] = useSearchParams();
  const [conexion, setConexion] = useState(undefined); // undefined = cargando
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [aviso] = useState(() => AVISO_VUELTA[params.get('mp')] || null);

  useEffect(() => {
    if (!params.get('mp')) return;
    const limpio = new URLSearchParams(params);
    limpio.delete('mp');
    setParams(limpio, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    getMpConnectionStatus(businessId)
      .then((c) => { if (vigente) setConexion(c); })
      .catch((err) => {
        console.error('[SenaMercadoPagoCard] No se pudo leer la conexión:', err);
        if (vigente) setConexion(null);
      });
    return () => { vigente = false; };
  }, [businessId]);

  const conectar = async () => {
    setTrabajando(true);
    setError('');
    try {
      const { url } = await conectarMercadoPago({ businessId });
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setTrabajando(false);
    }
  };

  const desconectar = async () => {
    if (!window.confirm('¿Desconectar Mercado Pago? Se apaga la seña obligatoria y tus clientes vuelven a reservar sin pagar nada.')) return;
    setTrabajando(true);
    setError('');
    try {
      await desconectarMercadoPago({ businessId });
      setConexion(null);
      editar({ depositEnabled: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando(false);
    }
  };

  const conectado = Boolean(conexion);
  const enPesos = (form.currency || 'ARS') === 'ARS';
  const tipo = form.depositType || 'percent';
  const valor = Number(form.depositValue) || 0;
  const ejemplo = 10000;
  const senaEjemplo = tipo === 'fixed' ? Math.min(valor, ejemplo) : Math.round(ejemplo * Math.min(valor, 100) / 100);
  const { appointmentNoun: turno, customerNoun: cliente } = terminology;

  return (
    <div className="card mt-md">
      <h3 className="mb-sm">Seña con Mercado Pago</h3>
      <p className="text-secondary text-sm mb-md">
        Pedile al {cliente} que pague una seña para reservar. La plata va directo a tu cuenta de
        Mercado Pago: Slotly nunca la toca.
      </p>

      {aviso && <div className={`notice ${aviso.clase} mb-md`}>{aviso.texto}</div>}

      <div className="notice notice-warn mb-md">
        <Icon name="warning" /> <strong>Mercado Pago cobra una comisión de aprox. 8% sobre cada seña.</strong>{' '}
        La cobra Mercado Pago, no Slotly, y varía según en cuántos días elegís recibir la plata en tu cuenta.
      </div>

      <div className="flex flex-col gap-md">
        <div className="form-group">
          <label className="form-label">Cuenta de Mercado Pago</label>
          {conexion === undefined ? (
            <p className="text-sm text-muted">Revisando…</p>
          ) : conectado ? (
            <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
              <span className="badge badge-success"><Icon name="check-circle" /> Conectada{conexion.nickname ? ` · ${conexion.nickname}` : ''}</span>
              {conexion.liveMode === false && <span className="badge badge-warning">Modo prueba</span>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={desconectar} disabled={trabajando}>Desconectar</button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn btn-primary" onClick={conectar} disabled={trabajando}>
                <Icon name="link" /> {trabajando ? 'Abriendo Mercado Pago…' : 'Conectar Mercado Pago'}
              </button>
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                Te lleva a Mercado Pago para que autorices a Slotly a cobrar las señas a tu nombre.
              </p>
            </div>
          )}
          {error && <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</p>}
        </div>

        {!enPesos && (
          <div className="notice notice-info">La seña con Mercado Pago solo funciona con la moneda en pesos argentinos (ARS).</div>
        )}

        <label className="flex items-center gap-sm" style={{ cursor: conectado && enPesos ? 'pointer' : 'not-allowed', opacity: conectado && enPesos ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={Boolean(form.depositEnabled)}
            disabled={!conectado || !enPesos}
            onChange={(e) => editar({
              depositEnabled: e.target.checked,
              ...(e.target.checked && !form.depositValue ? { depositType: 'percent', depositValue: 30 } : {}),
            })}
          />
          <span><strong>Pedir seña obligatoria para reservar</strong></span>
        </label>

        {form.depositEnabled && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Cómo se calcula</label>
                <select className="form-input" value={tipo} onChange={(e) => editar({ depositType: e.target.value })}>
                  <option value="percent">Porcentaje del precio</option>
                  <option value="fixed">Monto fijo</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">{tipo === 'fixed' ? 'Monto ($)' : 'Porcentaje (%)'}</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={tipo === 'percent' ? 100 : undefined}
                  value={form.depositValue ?? ''}
                  onChange={(e) => editar({ depositValue: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </div>
            </div>
            {valor > 0 && (
              <p className="text-sm text-muted">
                Ejemplo: en un servicio de {formatPrice(ejemplo, 'ARS')}, la seña es de <strong>{formatPrice(senaEjemplo, 'ARS')}</strong>
                {tipo === 'fixed' && ' (si el servicio sale menos que la seña, se cobra el precio del servicio)'}.
              </p>
            )}
            <ul className="text-sm text-secondary" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
              <li>El {cliente} tiene <strong>15 minutos</strong> para pagar. Si no paga, el horario se libera solo.</li>
              <li>El {turno} te llega recién cuando la seña está pagada.</li>
              <li>Si el {cliente} cancela, la seña <strong>no se devuelve sola</strong>: la podés devolver desde Citas con “Devolver seña”.</li>
              <li>Los {turno}s que cargás vos desde el panel no piden seña.</li>
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
