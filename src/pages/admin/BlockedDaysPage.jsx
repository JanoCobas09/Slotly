import { useMemo, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { blockDays, removeBlocks } from '../../lib/repository';
import { formatDate, toDateString, getMonthName } from '../../utils/dateUtils';
import { esDiaEntero, diaEnteroBloqueado, rangosDelDia } from '../../utils/bloqueos';
import Icon from '../../components/Icon';

/**
 * Días bloqueados: el dueño marca en un calendario los días (o partes del
 * día) que no va a trabajar, y ahí no se puede reservar online aunque el
 * horario semanal diga que se atiende.
 *
 * Tocar un día lo selecciona y abre el detalle: por defecto se bloquea el
 * día entero, o se elige "solo un horario" (ej. la mañana sí, la tarde no).
 * Un día puede tener varios rangos. Para varios días seguidos (vacaciones)
 * está el "desde / hasta", con la misma opción. La base lo hace cumplir
 * también (trigger enforce_blocked_days).
 */

/** Todas las fechas 'YYYY-MM-DD' entre dos, inclusive. */
function fechasEntre(desde, hasta) {
  const out = [];
  const d = new Date(`${desde}T12:00:00`);
  const fin = new Date(`${hasta}T12:00:00`);
  while (d <= fin && out.length < 366) {
    out.push(toDateString(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const ALCANCE_INICIAL = { modo: 'dia', desde: '09:00', hasta: '13:00' };

/** "Todo el día" (por defecto) o "Solo un horario" con desde/hasta. */
function SelectorAlcance({ alcance, onChange, nombre }) {
  const set = (patch) => onChange({ ...alcance, ...patch });
  return (
    <div className="bloqueo-alcance">
      <label className="bloqueo-opcion">
        <input type="radio" name={nombre} checked={alcance.modo === 'dia'} onChange={() => set({ modo: 'dia' })} />
        <span>Todo el día</span>
      </label>
      <label className="bloqueo-opcion">
        <input type="radio" name={nombre} checked={alcance.modo === 'horario'} onChange={() => set({ modo: 'horario' })} />
        <span>Solo un horario</span>
      </label>
      {alcance.modo === 'horario' && (
        <div className="bloqueo-horas">
          <input type="time" className="form-input" value={alcance.desde} onChange={(e) => set({ desde: e.target.value })} aria-label="Desde" />
          <span className="text-muted">a</span>
          <input type="time" className="form-input" value={alcance.hasta} onChange={(e) => set({ hasta: e.target.value })} aria-label="Hasta" />
        </div>
      )}
      {alcance.modo === 'horario' && alcance.desde >= alcance.hasta && (
        <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 6 }}>La hora de fin tiene que ser posterior a la de inicio.</p>
      )}
    </div>
  );
}

const alcanceValido = (a) => a.modo === 'dia' || (a.desde && a.hasta && a.desde < a.hasta);
const rangoDe = (a) => (a.modo === 'dia' ? null : { startTime: a.desde, endTime: a.hasta });
const textoBloqueo = (b) => (esDiaEntero(b) ? 'Todo el día' : `${b.startTime} a ${b.endTime}`);

export default function BlockedDaysPage() {
  const { blockedDays, appointments, businessId } = useTenant();
  const { terminology } = useBusinessContext();
  const hoy = toDateString(new Date());

  const [vista, setVista] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [seleccionado, setSeleccionado] = useState(null);
  const [alcanceDia, setAlcanceDia] = useState(ALCANCE_INICIAL);
  const [rango, setRango] = useState({ desde: '', hasta: '' });
  const [alcanceRango, setAlcanceRango] = useState(ALCANCE_INICIAL);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  // Turnos vivos: bloquear NO cancela lo ya reservado — hay que avisarle al
  // dueño cuántos caen en cada bloqueo para que les escriba.
  const vivos = useMemo(
    () => appointments.filter((a) => a.status === 'pendiente' || a.status === 'confirmada'),
    [appointments]
  );
  const turnosEn = (b) => vivos.filter((a) =>
    a.appointmentDate === b.date
    && (esDiaEntero(b) || (a.startTime < b.endTime && (a.endTime || a.startTime) > b.startTime))
  ).length;

  const ejecutar = async (fn) => {
    if (ocupado) return;
    setOcupado(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (err) {
      console.error('[BlockedDaysPage] No se pudo guardar:', err);
      setError('No se pudo guardar: ' + err.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };

  /**
   * Bloquea las fechas con el alcance elegido, salteando lo que ya estaba:
   * un día ya bloqueado entero no suma nada, y el mismo rango repetido
   * tampoco (los índices únicos de la tabla lo rechazarían).
   */
  const bloquear = (fechas, alcance) => {
    const r = rangoDe(alcance);
    const pendientes = fechas.filter((f) =>
      !diaEnteroBloqueado(blockedDays, f)
      && !(r && rangosDelDia(blockedDays, f).some((b) => b.startTime === r.startTime && b.endTime === r.endTime)));
    return ejecutar(() => blockDays(businessId, pendientes, r));
  };

  const rangoFechasValido = rango.desde && rango.hasta && rango.desde >= hoy && rango.hasta >= rango.desde;
  const bloquearRango = () => {
    if (!rangoFechasValido || !alcanceValido(alcanceRango)) return;
    bloquear(fechasEntre(rango.desde, rango.hasta), alcanceRango).then((ok) => ok && setRango({ desde: '', hasta: '' }));
  };

  // ── Calendario del mes ──
  const year = vista.getFullYear();
  const month = vista.getMonth();
  const primero = new Date(year, month, 1);
  const offset = primero.getDay() === 0 ? 6 : primero.getDay() - 1;
  const diasDelMes = new Date(year, month + 1, 0).getDate();
  const celdas = [...Array(offset).fill(null), ...Array.from({ length: diasDelMes }, (_, i) => i + 1)];
  const enMesActual = year === new Date().getFullYear() && month === new Date().getMonth();

  const bloqueosDelSeleccionado = seleccionado ? blockedDays.filter((b) => b.date === seleccionado) : [];
  const seleccionadoEntero = bloqueosDelSeleccionado.some(esDiaEntero);

  // Próximos, agrupados por día (un día puede tener varios rangos).
  const proximos = useMemo(() => {
    const porDia = new Map();
    for (const b of blockedDays) {
      if (b.date < hoy) continue;
      if (!porDia.has(b.date)) porDia.set(b.date, []);
      porDia.get(b.date).push(b);
    }
    return [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bloques]) => ({
        date,
        bloques: bloques.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
      }));
  }, [blockedDays, hoy]);

  const avisoTurnos = (b) => {
    const n = turnosEn(b);
    if (!n) return null;
    return (
      <div className="text-xs" style={{ color: 'var(--warning)' }}>
        <Icon name="warning" /> {n === 1 ? `Hay 1 ${terminology.appointmentNoun}` : `Hay ${n} ${terminology.appointmentNoun}s`} reservado{n === 1 ? '' : 's'} ahí: no se cancela{n === 1 ? '' : 'n'} solo{n === 1 ? '' : 's'}, avisale{n === 1 ? '' : 's'}.
      </div>
    );
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Días bloqueados</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Los días (o partes del día) que no vas a trabajar. Ahí nadie puede reservar online, aunque tu horario semanal diga que atendés.
          </p>
        </div>
      </div>

      {error && (
        <div className="badge badge-danger" style={{ display: 'block', padding: '10px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
          {error}
        </div>
      )}

      <div className="bloqueos-layout">
        <div className="card">
          <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
            Tocá un día para bloquearlo entero o solo un horario.
          </p>
          <div className="calendar">
            <div className="calendar-header">
              <button className="calendar-nav" onClick={() => setVista(new Date(year, month - 1, 1))} disabled={enMesActual} aria-label="Mes anterior">◀</button>
              <h3>{getMonthName(month)} {year}</h3>
              <button className="calendar-nav" onClick={() => setVista(new Date(year, month + 1, 1))} aria-label="Mes siguiente">▶</button>
            </div>
            <div className="calendar-grid">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                <div key={d} className="calendar-day-header">{d}</div>
              ))}
              {celdas.map((dia, i) => {
                if (dia === null) return <div key={`v-${i}`} className="calendar-day empty" />;
                const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
                const entero = diaEnteroBloqueado(blockedDays, fecha);
                const parcial = !entero && rangosDelDia(blockedDays, fecha).length > 0;
                const tieneTurnos = vivos.some((a) => a.appointmentDate === fecha);
                return (
                  <button
                    key={fecha}
                    className={`calendar-day ${entero ? 'bloqueado' : ''} ${parcial ? 'parcial' : ''} ${fecha === seleccionado ? 'elegido' : ''} ${fecha === hoy ? 'today' : ''}`}
                    disabled={fecha < hoy}
                    onClick={() => { setSeleccionado(fecha); setAlcanceDia(ALCANCE_INICIAL); }}
                  >
                    {dia}
                    {tieneTurnos && <span className="calendar-day-dot" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="bloqueos-leyenda text-xs text-muted">
            <span><span className="leyenda-bloqueado" /> Todo el día</span>
            <span><span className="leyenda-parcial" /> Parte del día</span>
            <span><span className="calendar-day-dot" /> Tiene {terminology.appointmentNoun}s</span>
          </div>

          {/* ── Detalle del día elegido ── */}
          {seleccionado && (
            <div className="bloqueo-detalle">
              <div className="bloqueo-detalle-titulo">
                <strong>{formatDate(seleccionado)}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() => setSeleccionado(null)} aria-label="Cerrar"><Icon name="x" /></button>
              </div>

              {bloqueosDelSeleccionado.length > 0 && (
                <ul className="bloqueos-lista">
                  {bloqueosDelSeleccionado.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')).map((b) => (
                    <li key={b.id}>
                      <div>
                        <div style={{ fontWeight: 600 }}><Icon name="lock" /> {textoBloqueo(b)}</div>
                        {avisoTurnos(b)}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => ejecutar(() => removeBlocks(businessId, [b.id]))} disabled={ocupado}>Liberar</button>
                    </li>
                  ))}
                </ul>
              )}

              {!seleccionadoEntero && (
                <>
                  <SelectorAlcance alcance={alcanceDia} onChange={setAlcanceDia} nombre="alcance-dia" />
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => bloquear([seleccionado], alcanceDia)}
                    disabled={ocupado || !alcanceValido(alcanceDia)}
                  >
                    <Icon name="lock" /> {alcanceDia.modo === 'dia' ? 'Bloquear todo el día' : `Bloquear de ${alcanceDia.desde} a ${alcanceDia.hasta}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-md">
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-sm)' }}>Bloquear varios días</h3>
            <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
              Para vacaciones, o para bloquear por ejemplo las mañanas de toda una semana.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Desde</label>
                <input type="date" className="form-input" min={hoy} value={rango.desde}
                  onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Hasta</label>
                <input type="date" className="form-input" min={rango.desde || hoy} value={rango.hasta}
                  onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
              </div>
            </div>
            <SelectorAlcance alcance={alcanceRango} onChange={setAlcanceRango} nombre="alcance-rango" />
            <button className="btn btn-primary btn-full" onClick={bloquearRango} disabled={!rangoFechasValido || !alcanceValido(alcanceRango) || ocupado}>
              <Icon name="lock" /> Bloquear {rangoFechasValido ? `${fechasEntre(rango.desde, rango.hasta).length} días` : 'días'}
              {alcanceRango.modo === 'horario' && alcanceValido(alcanceRango) ? ` (${alcanceRango.desde} a ${alcanceRango.hasta})` : ''}
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Próximos bloqueos</h3>
            {proximos.length === 0 ? (
              <p className="text-sm text-muted">No tenés días bloqueados.</p>
            ) : (
              <ul className="bloqueos-lista">
                {proximos.map(({ date, bloques }) => (
                  <li key={date} style={{ alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{formatDate(date)}</div>
                      {bloques.map((b) => (
                        <div key={b.id} className="bloqueo-item">
                          <div>
                            <span className="text-sm text-secondary">{textoBloqueo(b)}</span>
                            {avisoTurnos(b)}
                          </div>
                          <button className="btn btn-ghost btn-sm" onClick={() => ejecutar(() => removeBlocks(businessId, [b.id]))} disabled={ocupado}>
                            Liberar
                          </button>
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
