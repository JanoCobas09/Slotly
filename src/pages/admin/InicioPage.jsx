import { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import AgendaDelDia from '../../components/admin/AgendaDelDia';
import AccionesTurno from '../../components/admin/AccionesTurno';
import NuevoTurnoModal from '../../components/admin/NuevoTurnoModal';
import { formatDate, toDateString, getMonthName } from '../../utils/dateUtils';
import { diaEnteroBloqueado, rangosDelDia } from '../../utils/bloqueos';
import Icon from '../../components/Icon';

/**
 * Inicio del dueño: el tablero para VER los turnos, en tres escalas.
 *
 *   - Día:    la agenda de siempre (AgendaDelDia), con las acciones.
 *   - Semana: siete columnas, un vistazo de cómo viene la semana.
 *   - Mes:    el calendario del mes con cuántos turnos hay cada día.
 *
 * Tocar un día o un turno en semana/mes abre ese día en la vista Día, que es
 * donde se actúa (confirmar, editar, cancelar). Las estadísticas viven
 * aparte, en Dashboard.
 */

const VISTAS = [
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
];

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Cuántos turnos se dibujan por día antes de resumir en "+N más" (que abre
// ese día). Sin tope, un día cargado estira toda la grilla: 20 turnos en la
// semana o en una celda del mes rompen la vista.
const MAX_SEMANA = 6;
const MAX_MES = 3;

const aFecha = (iso) => new Date(`${iso}T12:00:00`);

function sumarDias(iso, n) {
  const d = aFecha(iso);
  d.setDate(d.getDate() + n);
  return toDateString(d);
}

function sumarMeses(iso, n) {
  const d = aFecha(iso);
  return toDateString(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** Lunes de la semana de esa fecha. */
function lunesDe(iso) {
  const d = aFecha(iso);
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - dow);
  return toDateString(d);
}

const diaNum = (iso) => Number(iso.slice(8, 10));

export default function InicioPage() {
  const { user } = useAuth();
  const { appointments, professionals, services, business, blockedDays } = useTenant();
  const { terminology } = useBusinessContext();
  const isOwner = user?.role === 'owner';
  const hoy = toDateString(new Date());

  const [vista, setVista] = useState('dia');
  const [fecha, setFecha] = useState(hoy);
  const [filtroProf, setFiltroProf] = useState('');
  const [agendando, setAgendando] = useState(false);
  const [editando, setEditando] = useState(null);

  const varios = professionals.length > 1;
  const nombreProf = (id) => professionals.find((p) => p.id === id)?.name || '—';
  const nombreSrv = (a) => a.serviceName || services.find((s) => s.id === a.serviceId)?.name || (a.type === 'walkin' ? 'Sin turno' : '');

  // Turnos que se muestran: sin cancelados, filtrados por profesional.
  const visibles = useMemo(() => appointments
    .filter((a) => a.status !== 'cancelada')
    .filter((a) => !filtroProf || a.professionalId === filtroProf)
    .sort((a, b) => a.startTime.localeCompare(b.startTime)), [appointments, filtroProf]);

  const porDia = useMemo(() => {
    const m = {};
    for (const a of visibles) (m[a.appointmentDate] ||= []).push(a);
    return m;
  }, [visibles]);

  const activosEn = (iso) => (porDia[iso] || []).filter((a) => a.status === 'pendiente' || a.status === 'confirmada').length;
  const irAlDia = (iso) => { setFecha(iso); setVista('dia'); };

  // ── Navegación según la vista ──
  const mover = (n) => {
    if (vista === 'dia') setFecha(sumarDias(fecha, n));
    else if (vista === 'semana') setFecha(sumarDias(fecha, 7 * n));
    else setFecha(sumarMeses(fecha, n));
  };

  const lunes = lunesDe(fecha);
  const semana = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
  const d = aFecha(fecha);
  const mesInicio = toDateString(new Date(d.getFullYear(), d.getMonth(), 1));

  let titulo;
  let totalPeriodo;
  if (vista === 'dia') {
    titulo = formatDate(fecha);
    totalPeriodo = activosEn(fecha);
  } else if (vista === 'semana') {
    const fin = semana[6];
    const mismoMes = lunes.slice(5, 7) === fin.slice(5, 7);
    titulo = mismoMes
      ? `${diaNum(lunes)} al ${diaNum(fin)} de ${getMonthName(aFecha(fin).getMonth())}`
      : `${diaNum(lunes)} de ${getMonthName(aFecha(lunes).getMonth())} al ${diaNum(fin)} de ${getMonthName(aFecha(fin).getMonth())}`;
    totalPeriodo = semana.reduce((acc, iso) => acc + activosEn(iso), 0);
  } else {
    titulo = `${getMonthName(d.getMonth())} ${d.getFullYear()}`;
    const prefijo = mesInicio.slice(0, 7);
    totalPeriodo = Object.keys(porDia).filter((iso) => iso.startsWith(prefijo)).reduce((acc, iso) => acc + activosEn(iso), 0);
  }
  const esActual = vista === 'dia' ? fecha === hoy
    : vista === 'semana' ? semana.includes(hoy)
      : mesInicio.slice(0, 7) === hoy.slice(0, 7);

  const nombreTurno = (a) => (a.type === 'walkin' ? 'Sin turno' : (a.clientName || 'Cliente'));

  // ── Celdas del mes ──
  const offset = (() => { const p = aFecha(mesInicio); return p.getDay() === 0 ? 6 : p.getDay() - 1; })();
  const diasMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const celdasMes = [
    ...Array(offset).fill(null),
    ...Array.from({ length: diasMes }, (_, i) => sumarDias(mesInicio, i)),
  ];
  // Se completa la última semana con celdas vacías: si no, la grilla queda
  // cortada después del último día del mes.
  while (celdasMes.length % 7 !== 0) celdasMes.push(null);

  const marcaBloqueo = (iso) => {
    if (diaEnteroBloqueado(blockedDays, iso)) return 'entero';
    if (rangosDelDia(blockedDays, iso).length) return 'parcial';
    return null;
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Inicio</h1>
        <button className="btn btn-primary" onClick={() => setAgendando(true)}>+ Agendar {terminology.appointmentNoun}</button>
      </div>

      {agendando && <NuevoTurnoModal onClose={() => setAgendando(false)} />}
      {editando && <NuevoTurnoModal turno={editando} onClose={() => setEditando(null)} />}

      <div className="card">
        {/* ── Barra: vista, navegación, título, filtro ── */}
        <div className="inicio-toolbar">
          <div className="vista-tabs" role="tablist">
            {VISTAS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={vista === v.id}
                className={`vista-tab ${vista === v.id ? 'activa' : ''}`}
                onClick={() => setVista(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="agenda-nav">
            <button className="btn btn-ghost btn-sm" onClick={() => mover(-1)} aria-label="Anterior">‹</button>
            <button className={`btn btn-sm ${esActual ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFecha(hoy)}>Hoy</button>
            <button className="btn btn-ghost btn-sm" onClick={() => mover(1)} aria-label="Siguiente">›</button>
            <input type="date" className="form-input agenda-fecha" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          </div>

          <div className="agenda-titulo">
            <strong>{titulo}</strong>
            <span className="text-secondary text-sm">
              {' '}· {totalPeriodo === 0 ? `sin ${terminology.appointmentNoun}s` : totalPeriodo === 1 ? `1 ${terminology.appointmentNoun}` : `${totalPeriodo} ${terminology.appointmentNoun}s`}
            </span>
          </div>

          {varios && (
            <select className="form-input agenda-filtro" value={filtroProf} onChange={(e) => setFiltroProf(e.target.value)}>
              <option value="">Todos los {terminology.professionalNoun}s</option>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        {/* ── Día ── */}
        {vista === 'dia' && (
          <AgendaDelDia
            appointments={appointments}
            professionals={professionals}
            services={services}
            business={business}
            fecha={fecha}
            onFechaChange={setFecha}
            filtroProfesional={filtroProf}
            sinCabecera
            blockedDays={blockedDays}
            renderAcciones={(apt) => <AccionesTurno apt={apt} isOwner={isOwner} onEditar={setEditando} />}
          />
        )}

        {/* ── Semana ── */}
        {vista === 'semana' && (
          <div className="semana-grid">
            {semana.map((iso, i) => {
              const turnos = porDia[iso] || [];
              const bloqueo = marcaBloqueo(iso);
              return (
                <div key={iso} className={`semana-dia ${iso === hoy ? 'hoy' : ''} ${iso < hoy ? 'pasado' : ''} ${bloqueo === 'entero' ? 'bloqueado' : ''}`}>
                  <button className="semana-dia-cabecera" onClick={() => irAlDia(iso)}>
                    <span className="semana-dia-nombre">{DIAS_CORTOS[i]}</span>
                    <span className="semana-dia-num">{diaNum(iso)}</span>
                    {bloqueo && <Icon name="lock" className="semana-dia-lock" title={bloqueo === 'entero' ? 'Día bloqueado' : 'Horario bloqueado'} />}
                  </button>
                  <div className="semana-dia-turnos">
                    {turnos.length === 0 ? (
                      <span className="semana-vacio">{bloqueo === 'entero' ? 'Bloqueado' : 'Libre'}</span>
                    ) : (
                      <>
                        {turnos.slice(0, MAX_SEMANA).map((a) => (
                          <button key={a.id} className={`mini-turno estado-${a.status}`} onClick={() => irAlDia(iso)}>
                            <span className="mini-turno-hora">{a.startTime}</span>
                            <span className="mini-turno-cliente">{nombreTurno(a)}</span>
                            <span className="mini-turno-detalle">
                              {nombreSrv(a)}{varios && !filtroProf ? ` · ${nombreProf(a.professionalId)}` : ''}
                            </span>
                          </button>
                        ))}
                        {turnos.length > MAX_SEMANA && (
                          <button className="semana-mas" onClick={() => irAlDia(iso)}>
                            +{turnos.length - MAX_SEMANA} más
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Mes ── */}
        {vista === 'mes' && (
          <div className="mes-grid">
            {DIAS_CORTOS.map((n) => <div key={n} className="mes-cabecera">{n}</div>)}
            {celdasMes.map((iso, i) => {
              if (!iso) return <div key={`v-${i}`} className="mes-celda vacia" />;
              const turnos = porDia[iso] || [];
              const bloqueo = marcaBloqueo(iso);
              const activos = activosEn(iso);
              return (
                <button
                  key={iso}
                  className={`mes-celda ${iso === hoy ? 'hoy' : ''} ${iso < hoy ? 'pasado' : ''} ${bloqueo === 'entero' ? 'bloqueado' : ''}`}
                  onClick={() => irAlDia(iso)}
                >
                  <span className="mes-celda-top">
                    <span className="mes-celda-num">{diaNum(iso)}</span>
                    {bloqueo && <Icon name="lock" className="mes-celda-lock" />}
                  </span>
                  {activos > 0 && <span className="mes-celda-cuenta">{activos}</span>}
                  <span className="mes-celda-lista">
                    {turnos.slice(0, MAX_MES).map((a) => (
                      <span key={a.id} className={`mes-mini estado-${a.status}`}>
                        {a.startTime} {nombreTurno(a)}
                      </span>
                    ))}
                    {turnos.length > MAX_MES && <span className="mes-mas">+{turnos.length - MAX_MES} más</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
