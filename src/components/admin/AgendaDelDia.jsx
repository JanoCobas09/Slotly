import { useMemo, useState } from 'react';
import { formatDate, toDateString, timeToMinutes } from '../../utils/dateUtils';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import Icon from '../Icon';

/**
 * La agenda de un día, como un calendario: una fila por franja horaria, con
 * la hora bien grande a la izquierda y, a la derecha, quién viene y para qué.
 *
 * Es la pantalla que el barbero mira veinte veces por día desde el celular,
 * entre corte y corte. Por eso es una lista vertical y no una grilla de
 * columnas: en 375px una grilla no se lee. Con más de un profesional (vista
 * del dueño) cada turno lleva el nombre del barbero, y se puede filtrar.
 *
 * Recibe los arrays por props (regla de oro: nada de Firestore acá).
 */

const ESTADO = {
  pendiente:  { label: 'Pendiente',  clase: 'badge-warning' },
  confirmada: { label: 'Confirmada', clase: 'badge-success' },
  completada: { label: 'Completada', clase: 'badge-primary' },
  cancelada:  { label: 'Cancelada',  clase: 'badge-danger' },
  no_asistio: { label: 'No asistió', clase: 'badge-danger' },
};

/** 'YYYY-MM-DD' ± n días, en local. */
function sumarDias(fechaISO, n) {
  const d = new Date(`${fechaISO}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDateString(d);
}

/** Horario de apertura del local ese día, o 08:00–21:00 si no está cargado. */
function rangoDelDia(business, fechaISO) {
  const js = new Date(`${fechaISO}T12:00:00`).getDay();
  const dow = js === 0 ? 6 : js - 1; // 0=Lunes … 6=Domingo
  const dia = business?.businessHours?.find((h) => h.dayOfWeek === dow);
  if (dia?.isActive && dia.startTime && dia.endTime) {
    return { desde: timeToMinutes(dia.startTime), hasta: timeToMinutes(dia.endTime), cerrado: false };
  }
  return { desde: 8 * 60, hasta: 21 * 60, cerrado: Boolean(dia) && !dia.isActive };
}

const pad = (n) => String(n).padStart(2, '0');
const aHora = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** "1 h 30 min", "45 min", "2 h" — para el resumen de un hueco libre largo. */
function aDuracion(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// A partir de esta cantidad de franjas libres SEGUIDAS, se muestran como un
// solo resumen en vez de una fila por franja. Con turnos cada 15 min y el
// local abierto todo el día, sin esto la agenda es scroll infinito de filas
// que dicen "libre" una debajo de la otra.
const UMBRAL_COLAPSO = 3;

export default function AgendaDelDia({
  appointments,
  professionals,
  services,
  business,
  /** Si viene, la agenda es de un solo profesional (vista del barbero). */
  professionalId = null,
  /** Qué hacer al tocar un turno (opcional). */
  onSelect = null,
  /** Acciones opcionales por turno: (apt) => ReactNode. */
  renderAcciones = null,
}) {
  const { terminology } = useBusinessContext();
  const hoy = toDateString(new Date());
  const [fecha, setFecha] = useState(hoy);
  const [filtroProf, setFiltroProf] = useState('');

  const profActivo = professionalId || filtroProf || null;
  const varios = !professionalId && professionals.length > 1;

  const { desde, hasta, cerrado } = rangoDelDia(business, fecha);
  const paso = Number(business?.slotInterval) || 30;

  const delDia = useMemo(() => {
    return appointments
      .filter((a) => a.appointmentDate === fecha)
      .filter((a) => !profActivo || a.professionalId === profActivo)
      .filter((a) => a.status !== 'cancelada')
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [appointments, fecha, profActivo]);

  // Franjas: desde la apertura hasta el cierre, en pasos del intervalo. Si
  // hay un turno fuera de ese rango (walk-in tarde, horario viejo), se
  // extiende para que no desaparezca.
  const franjas = useMemo(() => {
    let ini = desde, fin = hasta;
    for (const a of delDia) {
      ini = Math.min(ini, Math.floor(timeToMinutes(a.startTime) / paso) * paso);
      fin = Math.max(fin, a.endTime ? timeToMinutes(a.endTime) : timeToMinutes(a.startTime) + paso);
    }
    const out = [];
    for (let m = ini; m < fin; m += paso) out.push(m);
    return out;
  }, [desde, hasta, paso, delDia]);

  const ahoraMin = (() => {
    if (fecha !== hoy) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  // Una entrada por franja, con todo lo que ya calculaba el render antes de
  // agruparlas (turnos, si sigue un turno anterior, si es "ahora", si ya
  // pasó). Separado del agrupamiento de abajo para no calcularlo dos veces.
  const infoFranjas = useMemo(() => franjas.map((m) => {
    const turnos = delDia.filter((a) => {
      const ini = timeToMinutes(a.startTime);
      return ini >= m && ini < m + paso;
    });
    // Un turno largo (60 min con paso de 30) ocupa también las franjas
    // siguientes: no están libres, sigue el mismo cliente.
    const enCurso = turnos.length === 0 ? delDia.find((a) => {
      const ini = timeToMinutes(a.startTime);
      const fin = a.endTime ? timeToMinutes(a.endTime) : ini + paso;
      return ini < m && fin > m;
    }) : null;
    const esAhora = ahoraMin !== null && ahoraMin >= m && ahoraMin < m + paso;
    const yaPaso = ahoraMin !== null && m + paso <= ahoraMin;
    return { m, turnos, enCurso, esAhora, yaPaso };
  }), [franjas, delDia, paso, ahoraMin]);

  // Agrupa corridas largas de franjas libres seguidas en un solo resumen
  // ("09:00–13:00 · libre") en vez de una fila por cada media hora vacía.
  // "Ahora" y las franjas con turno cortan la corrida: siempre quedan
  // visibles como filas propias.
  const filas = useMemo(() => {
    const out = [];
    let corrida = [];
    const flush = () => {
      if (corrida.length === 0) return;
      if (corrida.length < UMBRAL_COLAPSO) {
        for (const info of corrida) out.push({ tipo: 'franja', info });
      } else {
        out.push({
          tipo: 'bloque',
          desde: corrida[0].m,
          hasta: corrida[corrida.length - 1].m + paso,
          pasada: corrida.every((info) => info.yaPaso),
        });
      }
      corrida = [];
    };
    for (const info of infoFranjas) {
      const esLibre = info.turnos.length === 0 && !info.enCurso && !info.esAhora;
      if (esLibre) {
        corrida.push(info);
      } else {
        flush();
        out.push({ tipo: 'franja', info });
      }
    }
    flush();
    return out;
  }, [infoFranjas, paso]);

  const nombreProf = (id) => professionals.find((p) => p.id === id)?.name || '—';
  const nombreSrv = (a) => a.serviceName || services.find((s) => s.id === a.serviceId)?.name || (a.type === 'walkin' ? 'Servicio sin turno' : '—');

  const activos = delDia.filter((a) => a.status === 'pendiente' || a.status === 'confirmada');

  return (
    <div className="agenda">
      <div className="agenda-cabecera">
        <div className="agenda-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior">‹</button>
          <button
            className={`btn btn-sm ${fecha === hoy ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFecha(hoy)}
          >
            Hoy
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente">›</button>
          <input
            type="date"
            className="form-input agenda-fecha"
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
          />
        </div>
        <div className="agenda-titulo">
          <strong>{formatDate(fecha)}</strong>
          <span className="text-secondary text-sm">
            {' '}· {activos.length === 0 ? 'sin turnos' : activos.length === 1 ? '1 turno' : `${activos.length} turnos`}
          </span>
        </div>
        {varios && (
          <select className="form-input agenda-filtro" value={filtroProf} onChange={(e) => setFiltroProf(e.target.value)}>
            <option value="">Todos los {terminology.professionalNoun}s</option>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {cerrado && delDia.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
          <p>El negocio está cerrado este día.</p>
        </div>
      ) : (
        <div className="agenda-franjas">
          {filas.map((fila) => {
            if (fila.tipo === 'bloque') {
              return (
                <div key={`bloque-${fila.desde}`} className={`agenda-franja bloque-libre ${fila.pasada ? 'pasada' : ''}`}>
                  <div className="agenda-hora">{aHora(fila.desde)}</div>
                  <div className="agenda-celda">
                    <span className="agenda-libre">
                      libre hasta las {aHora(fila.hasta)} · {aDuracion(fila.hasta - fila.desde)}
                    </span>
                  </div>
                </div>
              );
            }

            const { m, turnos, enCurso, esAhora, yaPaso } = fila.info;
            return (
              <div key={m} className={`agenda-franja ${turnos.length ? 'con-turno' : enCurso ? 'ocupada' : 'libre'} ${esAhora ? 'ahora' : ''} ${yaPaso ? 'pasada' : ''}`}>
                <div className="agenda-hora">{aHora(m)}</div>
                <div className="agenda-celda">
                  {turnos.length === 0 ? (
                    enCurso
                      ? <span className="agenda-libre agenda-sigue">↑ sigue {enCurso.type === 'walkin' ? 'servicio sin turno' : (enCurso.clientName || 'cliente')}</span>
                      : <span className="agenda-libre">libre</span>
                  ) : turnos.map((a) => {
                    const est = ESTADO[a.status] || { label: a.status, clase: 'badge-neutral' };
                    const walkin = a.type === 'walkin';
                    return (
                      <div
                        key={a.id}
                        className={`agenda-turno estado-${a.status} ${onSelect ? 'clickeable' : ''}`}
                        onClick={onSelect ? () => onSelect(a) : undefined}
                        role={onSelect ? 'button' : undefined}
                      >
                        <div className="agenda-turno-principal">
                          <div className="agenda-turno-cliente">
                            {walkin ? <><Icon name="clipboard" /> Servicio sin turno</> : (a.clientName || 'Cliente')}
                          </div>
                          <div className="agenda-turno-detalle">
                            {a.startTime}–{a.endTime || '?'} · {nombreSrv(a)}
                            {varios && !profActivo && <> · <strong>{nombreProf(a.professionalId)}</strong></>}
                          </div>
                          {a.clientPhone && !walkin && (
                            <a className="agenda-turno-tel" href={`tel:${a.clientPhone}`} onClick={(e) => e.stopPropagation()}>
                              <Icon name="phone" /> {a.clientPhone}
                            </a>
                          )}
                          {a.notes && (
                            <div className="text-xs text-muted"><Icon name="note" /> {a.notes}</div>
                          )}
                        </div>
                        <div className="agenda-turno-lateral">
                          <span className={`badge ${est.clase}`}>{est.label}</span>
                          {renderAcciones && <div className="agenda-turno-acciones" onClick={(e) => e.stopPropagation()}>{renderAcciones(a)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
