import { useMemo, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { blockDays, unblockDays } from '../../lib/repository';
import { formatDate, toDateString, getMonthName } from '../../utils/dateUtils';
import Icon from '../../components/Icon';

/**
 * Días bloqueados: el dueño marca en un calendario los días que no va a
 * trabajar (feriados, vacaciones, un trámite) y ese día no se puede reservar
 * online, aunque el horario semanal diga que se atiende.
 *
 * Un toque en el calendario bloquea o desbloquea el día. Para varios días
 * seguidos (vacaciones) está el "desde / hasta", así no hay que tocar uno por
 * uno. La base lo hace cumplir también (trigger enforce_blocked_days): no es
 * solo que el calendario del cliente no los muestre.
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

export default function BlockedDaysPage() {
  const { blockedDays, appointments, businessId } = useTenant();
  const { terminology } = useBusinessContext();
  const hoy = toDateString(new Date());

  const [vista, setVista] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [rango, setRango] = useState({ desde: '', hasta: '' });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const bloqueados = useMemo(() => new Set(blockedDays.map((b) => b.date)), [blockedDays]);

  // Turnos vivos por día: bloquear un día NO cancela lo que ya estaba
  // reservado — hay que avisarle al dueño para que les escriba.
  const turnosPorDia = useMemo(() => {
    const m = {};
    for (const a of appointments) {
      if (a.status !== 'pendiente' && a.status !== 'confirmada') continue;
      m[a.appointmentDate] = (m[a.appointmentDate] || 0) + 1;
    }
    return m;
  }, [appointments]);

  const ejecutar = async (fn) => {
    if (ocupado) return;
    setOcupado(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      console.error('[BlockedDaysPage] No se pudo guardar:', err);
      setError('No se pudo guardar: ' + err.message);
    } finally {
      setOcupado(false);
    }
  };

  const alternar = (fecha) => ejecutar(() =>
    bloqueados.has(fecha) ? unblockDays(businessId, [fecha]) : blockDays(businessId, [fecha]));

  const rangoValido = rango.desde && rango.hasta && rango.desde >= hoy && rango.hasta >= rango.desde;
  const bloquearRango = () => {
    if (!rangoValido) return;
    ejecutar(async () => {
      await blockDays(businessId, fechasEntre(rango.desde, rango.hasta));
      setRango({ desde: '', hasta: '' });
    });
  };

  // ── Calendario del mes ──
  const year = vista.getFullYear();
  const month = vista.getMonth();
  const primero = new Date(year, month, 1);
  const offset = primero.getDay() === 0 ? 6 : primero.getDay() - 1;
  const diasDelMes = new Date(year, month + 1, 0).getDate();
  const celdas = [...Array(offset).fill(null), ...Array.from({ length: diasDelMes }, (_, i) => i + 1)];
  const enMesActual = year === new Date().getFullYear() && month === new Date().getMonth();

  const proximos = blockedDays
    .filter((b) => b.date >= hoy)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Días bloqueados</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Los días que no vas a trabajar. Ese día nadie puede reservar online, aunque tu horario semanal diga que atendés.
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
            Tocá un día para bloquearlo. Tocalo de nuevo para liberarlo.
          </p>
          <div className="calendar">
            <div className="calendar-header">
              <button
                className="calendar-nav"
                onClick={() => setVista(new Date(year, month - 1, 1))}
                disabled={enMesActual}
                aria-label="Mes anterior"
              >◀</button>
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
                const bloqueado = bloqueados.has(fecha);
                const turnos = turnosPorDia[fecha] || 0;
                return (
                  <button
                    key={fecha}
                    className={`calendar-day ${bloqueado ? 'bloqueado' : ''} ${fecha === hoy ? 'today' : ''}`}
                    disabled={fecha < hoy || ocupado}
                    onClick={() => alternar(fecha)}
                    title={bloqueado ? 'Bloqueado — tocá para liberar' : 'Tocá para bloquear'}
                  >
                    {dia}
                    {turnos > 0 && <span className="calendar-day-dot" aria-label={`${turnos} ${terminology.appointmentNoun}s`} />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="bloqueos-leyenda text-xs text-muted">
            <span><span className="leyenda-bloqueado" /> Bloqueado</span>
            <span><span className="calendar-day-dot" /> Tiene {terminology.appointmentNoun}s</span>
          </div>
        </div>

        <div className="flex flex-col gap-md">
          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-sm)' }}>Bloquear varios días</h3>
            <p className="text-sm text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
              Para vacaciones o una semana entera.
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
            <button className="btn btn-primary btn-full" onClick={bloquearRango} disabled={!rangoValido || ocupado}>
              <Icon name="lock" /> Bloquear {rangoValido ? `${fechasEntre(rango.desde, rango.hasta).length} días` : 'días'}
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Próximos días bloqueados</h3>
            {proximos.length === 0 ? (
              <p className="text-sm text-muted">No tenés días bloqueados.</p>
            ) : (
              <ul className="bloqueos-lista">
                {proximos.map((b) => {
                  const turnos = turnosPorDia[b.date] || 0;
                  return (
                    <li key={b.id}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{formatDate(b.date)}</div>
                        {turnos > 0 && (
                          <div className="text-xs" style={{ color: 'var(--warning)' }}>
                            <Icon name="warning" /> Ya {turnos === 1 ? `hay 1 ${terminology.appointmentNoun}` : `hay ${turnos} ${terminology.appointmentNoun}s`} ese día: no se cancela{turnos === 1 ? '' : 'n'} solo{turnos === 1 ? '' : 's'}, avisale{turnos === 1 ? '' : 's'}.
                          </div>
                        )}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => ejecutar(() => unblockDays(businessId, [b.date]))} disabled={ocupado}>
                        Liberar
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
