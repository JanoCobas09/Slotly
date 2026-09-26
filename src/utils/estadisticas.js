// ============================================================================
// Estadísticas del dueño (Dashboard): cálculo puro, sin UI
// ============================================================================
// Recibe arrays por argumento y no sabe de dónde salen (mismo criterio que
// statsCalculator.js, que no se toca y sigue usándose donde estaba).
//
// Criterios:
//   - Ingresos = turnos COMPLETADOS (lo que ya se atendió y cobró), igual que
//     el Dashboard de siempre. "A cobrar" = confirmados/pendientes del período
//     que todavía no pasaron.
//   - Un turno "atendido" es uno completado. Los cancelados no cuentan para
//     ocupación ni para ingresos; los "no vino" ocuparon el horario igual.
//   - Un cliente se identifica por su cuenta (userId); los que carga el
//     negocio a mano, por su teléfono (o su nombre si no dejó teléfono).
import { toDateString, timeToMinutes, getLocalDayOfWeek } from './dateUtils';

const DIA_MS = 24 * 3600 * 1000;
const aFecha = (iso) => new Date(`${iso}T12:00:00`);
const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return toDateString(d); };
const diasEntre = (desde, hasta) => Math.round((aFecha(hasta) - aFecha(desde)) / DIA_MS) + 1;

export const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: 'Últimos 7 días' },
  { id: '30d', label: 'Últimos 30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes-pasado', label: 'Mes pasado' },
  { id: 'custom', label: 'Personalizado' },
];

/** { desde, hasta } (inclusive, 'YYYY-MM-DD') de un período. */
export function rangoDePeriodo(id, hoy = toDateString(new Date()), custom = {}) {
  const d = aFecha(hoy);
  switch (id) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy };
    case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy };
    case 'mes': return { desde: toDateString(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: toDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
    case 'mes-pasado': return { desde: toDateString(new Date(d.getFullYear(), d.getMonth() - 1, 1)), hasta: toDateString(new Date(d.getFullYear(), d.getMonth(), 0)) };
    default: {
      const desde = custom.desde || hoy;
      const hasta = custom.hasta && custom.hasta >= desde ? custom.hasta : desde;
      return { desde, hasta };
    }
  }
}

/** El período inmediatamente anterior, del mismo largo (para comparar). */
export function periodoAnterior({ desde, hasta }) {
  const largo = diasEntre(desde, hasta);
  return { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1) };
}

export const fechasDelRango = ({ desde, hasta }) => Array.from({ length: diasEntre(desde, hasta) }, (_, i) => sumarDias(desde, i));

export const enRango = (apt, { desde, hasta }) => apt.appointmentDate >= desde && apt.appointmentDate <= hasta;

/** Turnos de verdad (no los "servicio sin turno" del staff) con el filtro de sucursal y profesional. */
export function filtrarTurnos(appointments, { sucursalId = '', profesionalId = '' } = {}) {
  return (appointments || []).filter((a) =>
    a.type !== 'walkin'
    && !(a.depositStatus === 'pendiente' && a.status === 'pendiente') // esperando seña: todavía no es un turno
    && (!sucursalId || a.branchId === sucursalId)
    && (!profesionalId || a.professionalId === profesionalId));
}

const precio = (a) => Number(a.price) || 0;
const duracion = (a) => {
  if (a.startTime && a.endTime) return Math.max(0, timeToMinutes(a.endTime) - timeToMinutes(a.startTime));
  return Number(a.durationMinutes) || 0;
};

export function claveCliente(a) {
  if (a.type === 'client' && a.userId) return `u:${a.userId}`;
  const tel = String(a.clientPhone || '').replace(/\D/g, '');
  if (tel.length >= 6) return `t:${tel.slice(-10)}`;
  const nombre = String(a.clientName || '').trim().toLowerCase();
  return nombre ? `n:${nombre}` : null;
}

/** Indicadores del período. `hoy` separa lo ya pasado de lo que está por venir. */
export function indicadores(turnos, rango, hoy = toDateString(new Date())) {
  const del = turnos.filter((a) => enRango(a, rango));
  const completados = del.filter((a) => a.status === 'completada');
  const cancelados = del.filter((a) => a.status === 'cancelada');
  const noVino = del.filter((a) => a.status === 'no_asistio');
  const vivos = del.filter((a) => a.status === 'pendiente' || a.status === 'confirmada');
  const ingresos = completados.reduce((s, a) => s + precio(a), 0);
  const aCobrar = vivos.filter((a) => a.appointmentDate >= hoy).reduce((s, a) => s + precio(a), 0);
  const clientes = new Set(completados.map(claveCliente).filter(Boolean));
  const base = del.length || 1;
  return {
    reservas: del.length,
    completados: completados.length,
    ingresos,
    aCobrar,
    ticketPromedio: completados.length ? ingresos / completados.length : 0,
    clientesAtendidos: clientes.size,
    cancelados: cancelados.length,
    noVino: noVino.length,
    tasaCancelacion: del.length ? (cancelados.length / base) * 100 : 0,
    tasaNoVino: del.length ? (noVino.length / base) * 100 : 0,
  };
}

/** Variación porcentual (null si no hay base para comparar). */
export const variacion = (actual, anterior) => (anterior ? ((actual - anterior) / anterior) * 100 : null);

/** Por día del rango: ingresos (completados) y turnos (no cancelados). */
export function serieDiaria(turnos, rango) {
  const porDia = new Map(fechasDelRango(rango).map((f) => [f, { fecha: f, ingresos: 0, turnos: 0 }]));
  for (const a of turnos) {
    const d = porDia.get(a.appointmentDate);
    if (!d || a.status === 'cancelada') continue;
    d.turnos += 1;
    if (a.status === 'completada') d.ingresos += precio(a);
  }
  return [...porDia.values()];
}

/**
 * Mapa de calor día de la semana (0=Lunes) × hora: cuántos turnos (no
 * cancelados) empezaron en esa franja. `abiertas` marca las celdas donde
 * alguien atiende según los horarios (para detectar horarios flojos).
 */
export function mapaDeCalor(turnos, rango, schedules) {
  const celdas = {};
  let min = 24, max = 0;
  const abiertas = new Set();
  for (const s of schedules || []) {
    if (s.isActive === false || !s.startTime || !s.endTime) continue;
    const h0 = Math.floor(timeToMinutes(s.startTime) / 60);
    const h1 = Math.ceil(timeToMinutes(s.endTime) / 60);
    for (let h = h0; h < h1; h++) { abiertas.add(`${s.dayOfWeek}-${h}`); min = Math.min(min, h); max = Math.max(max, h); }
  }
  for (const a of turnos) {
    if (!enRango(a, rango) || a.status === 'cancelada' || !a.startTime) continue;
    const dia = getLocalDayOfWeek(aFecha(a.appointmentDate));
    const h = Math.floor(timeToMinutes(a.startTime) / 60);
    const k = `${dia}-${h}`;
    celdas[k] = (celdas[k] || 0) + 1;
    min = Math.min(min, h); max = Math.max(max, h);
  }
  if (min > max) return { horas: [], celdas, abiertas, maximo: 0 };
  const horas = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const maximo = Math.max(0, ...Object.values(celdas));
  return { horas, celdas, abiertas, maximo };
}

/** Las franjas abiertas con menos turnos: candidatas a una promo. */
export function horariosFlojos({ celdas, abiertas }, cuantos = 3) {
  return [...abiertas]
    .map((k) => { const [dia, hora] = k.split('-').map(Number); return { dia, hora, turnos: celdas[k] || 0 }; })
    .sort((a, b) => a.turnos - b.turnos || a.dia - b.dia || a.hora - b.hora)
    .slice(0, cuantos);
}

/**
 * Ocupación de cada profesional: minutos reservados / minutos que tenía en
 * su horario dentro del período (franjas de la sucursal elegida, sin los días
 * bloqueados enteros).
 */
export function ocupacionProfesionales({ turnos, rango, professionals, schedules, blockedDays, sucursalId = '' }) {
  const fechas = fechasDelRango(rango);
  const bloqueado = (f) => (blockedDays || []).some((b) => b.date === f && !b.startTime
    && (!b.branchId || !sucursalId || b.branchId === sucursalId));
  return (professionals || []).map((p) => {
    const franjas = (schedules || []).filter((s) => s.professionalId === p.id && s.isActive !== false && s.startTime && s.endTime
      && (!sucursalId || s.branchId === sucursalId));
    let disponibles = 0;
    for (const f of fechas) {
      if (bloqueado(f)) continue;
      const dia = getLocalDayOfWeek(aFecha(f));
      for (const s of franjas) if (s.dayOfWeek === dia) disponibles += timeToMinutes(s.endTime) - timeToMinutes(s.startTime);
    }
    const ocupados = turnos
      .filter((a) => a.professionalId === p.id && enRango(a, rango) && a.status !== 'cancelada')
      .reduce((s, a) => s + duracion(a), 0);
    return { id: p.id, nombre: p.name, disponibles, ocupados, porcentaje: disponibles ? Math.min(100, (ocupados / disponibles) * 100) : null };
  }).filter((o) => o.disponibles > 0 || o.ocupados > 0)
    .sort((a, b) => (b.porcentaje ?? -1) - (a.porcentaje ?? -1));
}

/** Ranking de ingresos (completados) agrupados por una clave. */
export function rankingIngresos(turnos, rango, claveDe, nombreDe) {
  const acc = new Map();
  for (const a of turnos) {
    if (!enRango(a, rango) || a.status !== 'completada') continue;
    const k = claveDe(a);
    if (!k) continue;
    const r = acc.get(k) || { id: k, nombre: nombreDe(k, a), total: 0, cantidad: 0 };
    r.total += precio(a);
    r.cantidad += 1;
    acc.set(k, r);
  }
  return [...acc.values()].sort((a, b) => b.total - a.total);
}

/**
 * Clientes: nuevos (su primer turno completado fue en el período),
 * recurrentes (ya habían venido antes), los que más vinieron, y los que
 * vinieron más de una vez pero hace más de `diasSinVolver` que no aparecen.
 */
export function clientes(turnos, rango, hoy = toDateString(new Date()), diasSinVolver = 60) {
  const historia = new Map();
  for (const a of turnos) {
    if (a.status !== 'completada') continue;
    const k = claveCliente(a);
    if (!k) continue;
    const c = historia.get(k) || { id: k, nombre: a.clientName || 'Cliente', telefono: a.clientPhone || '', visitas: [], gastado: 0 };
    c.visitas.push(a.appointmentDate);
    c.gastado += precio(a);
    if (a.clientName) c.nombre = a.clientName;
    if (a.clientPhone) c.telefono = a.clientPhone;
    historia.set(k, c);
  }
  let nuevos = 0, recurrentes = 0;
  const top = [];
  const limite = sumarDias(hoy, -diasSinVolver);
  const perdidos = [];
  // Quién tiene algo reservado a futuro no está "perdido".
  const conTurnoFuturo = new Set(turnos
    .filter((a) => a.appointmentDate >= hoy && (a.status === 'pendiente' || a.status === 'confirmada'))
    .map(claveCliente).filter(Boolean));
  for (const c of historia.values()) {
    c.visitas.sort();
    const enPeriodo = c.visitas.filter((f) => f >= rango.desde && f <= rango.hasta);
    if (enPeriodo.length) {
      if (c.visitas[0] >= rango.desde) nuevos += 1; else recurrentes += 1;
      top.push({ ...c, visitasPeriodo: enPeriodo.length, gastadoPeriodo: null });
    }
    const ultima = c.visitas[c.visitas.length - 1];
    if (c.visitas.length >= 2 && ultima < limite && !conTurnoFuturo.has(c.id)) {
      perdidos.push({ ...c, ultima });
    }
  }
  top.sort((a, b) => b.visitasPeriodo - a.visitasPeriodo || b.gastado - a.gastado);
  perdidos.sort((a, b) => b.visitas.length - a.visitas.length || a.ultima.localeCompare(b.ultima));
  return { nuevos, recurrentes, top: top.slice(0, 5), perdidos: perdidos.slice(0, 8) };
}

/** Cancelaciones (quién), ausencias por profesional y señas del período. */
export function cancelacionesYSenas(turnos, rango, professionals) {
  const del = turnos.filter((a) => enRango(a, rango));
  const cancelados = del.filter((a) => a.status === 'cancelada');
  const porCliente = cancelados.filter((a) => a.cancelledBy === 'client').length;
  const ausencias = (professionals || []).map((p) => {
    const suyos = del.filter((a) => a.professionalId === p.id && a.status !== 'cancelada');
    const no = suyos.filter((a) => a.status === 'no_asistio').length;
    return { id: p.id, nombre: p.name, total: suyos.length, noVino: no, tasa: suyos.length ? (no / suyos.length) * 100 : 0 };
  }).filter((x) => x.total > 0).sort((a, b) => b.tasa - a.tasa);
  const conSena = del.filter((a) => a.depositStatus && a.depositStatus !== 'pendiente');
  const cobradas = conSena.filter((a) => a.depositStatus === 'pagada' || a.depositStatus === 'devuelta');
  const devueltas = conSena.filter((a) => a.depositStatus === 'devuelta');
  const suma = (arr) => arr.reduce((s, a) => s + (Number(a.depositAmount) || 0), 0);
  return {
    cancelados: cancelados.length,
    porCliente,
    porNegocio: cancelados.length - porCliente,
    ausencias,
    senas: {
      cantidad: cobradas.length,
      cobrado: suma(cobradas),
      devuelto: suma(devueltas),
      // Señas que se quedó el negocio porque el cliente canceló o no vino.
      retenido: suma(cobradas.filter((a) => a.depositStatus === 'pagada' && (a.status === 'cancelada' || a.status === 'no_asistio'))),
    },
  };
}
