import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { formatDate, formatPrice, toDateString, getDayName } from '../../utils/dateUtils';
import { hayVariasSucursales, sucursalesActivas, nombreSucursal, profesionalesDeSucursal } from '../../utils/sucursales';
import {
  PERIODOS, rangoDePeriodo, periodoAnterior, filtrarTurnos, indicadores, variacion, serieDiaria,
  mapaDeCalor, horariosFlojos, ocupacionProfesionales, rankingIngresos, clientes, cancelacionesYSenas,
} from '../../utils/estadisticas';
import { StatTile, ColumnasPorDia, BarrasRanking, Medidor, MapaCalor, VerEnTabla } from './Graficos';
import Icon from '../Icon';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const pct = (n) => `${n.toFixed(1).replace('.0', '')}%`;
const fechaCorta = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
const mayuscula = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * Estadísticas del dueño. Una fila de filtros arriba (período, sucursal,
 * profesional) que manda sobre todo lo de abajo, y cuatro secciones:
 * ingresos y turnos, ocupación y horarios pico, clientes, y cancelaciones,
 * ausencias y señas. El cálculo vive en utils/estadisticas.js.
 */
export default function EstadisticasDueno() {
  const { appointments, professionals, services, branches, schedules, blockedDays, business } = useTenant();
  const { terminology } = useBusinessContext();
  const moneda = business?.currency;
  const plata = (n) => formatPrice(Math.round(n), moneda);
  const hoy = toDateString(new Date());

  const [periodo, setPeriodo] = useState('30d');
  const [custom, setCustom] = useState({ desde: '', hasta: '' });
  const [sucursalId, setSucursalId] = useState('');
  const [profesionalId, setProfesionalId] = useState('');

  const varias = hayVariasSucursales(branches);
  const profesionalesVisibles = sucursalId ? profesionalesDeSucursal(professionals, schedules, sucursalId) : professionals;
  const rango = rangoDePeriodo(periodo, hoy, custom);
  const anterior = periodoAnterior(rango);

  const d = useMemo(() => {
    const turnos = filtrarTurnos(appointments, { sucursalId, profesionalId });
    const horarios = (schedules || []).filter((s) => (!sucursalId || s.branchId === sucursalId) && (!profesionalId || s.professionalId === profesionalId));
    const profs = profesionalId ? professionals.filter((p) => p.id === profesionalId) : profesionalesVisibles;
    const calor = mapaDeCalor(turnos, rango, horarios);
    return {
      k: indicadores(turnos, rango, hoy),
      kAnt: indicadores(turnos, anterior, hoy),
      serie: serieDiaria(turnos, rango),
      calor,
      flojos: horariosFlojos(calor),
      ocupacion: ocupacionProfesionales({ turnos, rango, professionals: profs, schedules: horarios, blockedDays, sucursalId }),
      porProfesional: rankingIngresos(turnos, rango, (a) => a.professionalId, (k) => professionals.find((p) => p.id === k)?.name || 'Sin asignar'),
      porServicio: rankingIngresos(turnos, rango, (a) => a.serviceId || a.serviceName, (k, a) => services.find((s) => s.id === k)?.name || a.serviceName || 'Otro'),
      porSucursal: rankingIngresos(turnos, rango, (a) => a.branchId, (k) => nombreSucursal(branches, k) || 'Sin sucursal'),
      cli: clientes(turnos, rango, hoy),
      canc: cancelacionesYSenas(turnos, rango, profs),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, schedules, professionals, services, branches, blockedDays, sucursalId, profesionalId, rango.desde, rango.hasta, hoy]);

  const { k, kAnt } = d;
  const unDia = rango.desde === rango.hasta;
  const turnoPl = `${terminology.appointmentNoun}s`;

  return (
    <div className="estadisticas">
      {/* ── Filtros: una fila, arriba, mandan sobre todo ── */}
      <div className="estadisticas-filtros">
        <select className="form-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {periodo === 'custom' && (
          <>
            <input type="date" className="form-input" value={custom.desde} max={custom.hasta || undefined} onChange={(e) => setCustom({ ...custom, desde: e.target.value })} aria-label="Desde" />
            <input type="date" className="form-input" value={custom.hasta} min={custom.desde || undefined} onChange={(e) => setCustom({ ...custom, hasta: e.target.value })} aria-label="Hasta" />
          </>
        )}
        {varias && (
          <select className="form-input" value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setProfesionalId(''); }} aria-label="Sucursal">
            <option value="">Todas las sucursales</option>
            {sucursalesActivas(branches).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {profesionalesVisibles.length > 1 && (
          <select className="form-input" value={profesionalId} onChange={(e) => setProfesionalId(e.target.value)} aria-label="Profesional">
            <option value="">Todos los {terminology.professionalNoun}s</option>
            {profesionalesVisibles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <span className="text-sm text-secondary estadisticas-rango">
          {unDia ? formatDate(rango.desde) : `${fechaCorta(rango.desde)} al ${fechaCorta(rango.hasta)}`}
        </span>
      </div>

      {/* ── Indicadores ── */}
      <div className="kpis">
        <StatTile destacado label="Ingresos" valor={plata(k.ingresos)} delta={variacion(k.ingresos, kAnt.ingresos)}
          detalle={k.aCobrar ? `+ ${plata(k.aCobrar)} a cobrar (${turnoPl} por venir)` : null} />
        <StatTile label={mayuscula(`${terminology.appointmentNoun}s atendidos`)} valor={k.completados} delta={variacion(k.completados, kAnt.completados)} detalle={`${k.reservas} reservas en total`} />
        <StatTile label="Ticket promedio" valor={plata(k.ticketPromedio)} delta={variacion(k.ticketPromedio, kAnt.ticketPromedio)} />
        <StatTile label={mayuscula(`${terminology.customerNoun}s atendidos`)} valor={k.clientesAtendidos} delta={variacion(k.clientesAtendidos, kAnt.clientesAtendidos)} />
        <StatTile label="Cancelaciones" valor={pct(k.tasaCancelacion)} delta={variacion(k.tasaCancelacion, kAnt.tasaCancelacion)} subirEsBueno={false} detalle={`${k.cancelados} de ${k.reservas}`} />
        <StatTile label="No vinieron" valor={pct(k.tasaNoVino)} delta={variacion(k.tasaNoVino, kAnt.tasaNoVino)} subirEsBueno={false} detalle={`${k.noVino} de ${k.reservas}`} />
      </div>

      {/* ── Ingresos y turnos ── */}
      <Seccion icono="money" titulo="Ingresos y turnos">
        {unDia ? (
          <p className="text-sm text-muted">Elegí un período de más de un día para ver cómo evolucionan.</p>
        ) : (
          <div className="estadisticas-dos">
            <div>
              <h4>Ingresos por día</h4>
              <ColumnasPorDia datos={d.serie} valor={(x) => x.ingresos} formato={plata} etiquetaFecha={(f, corto) => (corto ? fechaCorta(f) : formatDate(f))} />
            </div>
            <div>
              <h4>{mayuscula(turnoPl)} por día</h4>
              <ColumnasPorDia datos={d.serie} valor={(x) => x.turnos} formato={(n) => String(n)} etiquetaFecha={(f, corto) => (corto ? fechaCorta(f) : formatDate(f))} />
            </div>
          </div>
        )}
        {!unDia && (
          <VerEnTabla columnas={['Día', 'Ingresos', turnoPl]} filas={d.serie.map((x) => [formatDate(x.fecha), plata(x.ingresos), x.turnos])} />
        )}
        <div className={`estadisticas-${varias && !sucursalId ? 'tres' : 'dos'} mt-md`}>
          <div>
            <h4>Por {terminology.professionalNoun}</h4>
            <BarrasRanking items={d.porProfesional} formato={plata} detalle={(i) => ` · ${i.cantidad}`} />
          </div>
          <div>
            <h4>Por servicio</h4>
            <BarrasRanking items={d.porServicio} formato={plata} detalle={(i) => ` · ${i.cantidad}`} />
          </div>
          {varias && !sucursalId && (
            <div>
              <h4>Por sucursal</h4>
              <BarrasRanking items={d.porSucursal} formato={plata} detalle={(i) => ` · ${i.cantidad}`} />
            </div>
          )}
        </div>
      </Seccion>

      {/* ── Ocupación y horarios pico ── */}
      <Seccion icono="clock" titulo="Ocupación y horarios pico">
        <div className="estadisticas-dos estadisticas-mapa">
          <div>
            <h4>Cuándo reservan</h4>
            <MapaCalor {...d.calor} dias={DIAS} />
            <VerEnTabla
              columnas={['Día', ...d.calor.horas.map((h) => `${h} hs`)]}
              filas={DIAS.map((nombre, dia) => [nombre, ...d.calor.horas.map((h) => d.calor.celdas[`${dia}-${h}`] || 0)])}
            />
          </div>
          <div>
            <h4>Horarios flojos</h4>
            {d.flojos.length ? (
              <>
                <ul className="lista-simple">
                  {d.flojos.map((f) => (
                    <li key={`${f.dia}-${f.hora}`}>
                      <span>{mayuscula(getDayName(f.dia))} de {f.hora} a {f.hora + 1} hs</span>
                      <span className="text-muted">{f.turnos} {f.turnos === 1 ? terminology.appointmentNoun : turnoPl}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-secondary mt-sm">
                  Una promo en esos horarios ayuda a llenarlos. <Link to="/admin/promociones">Crear promoción →</Link>
                </p>
              </>
            ) : <p className="text-sm text-muted">Sin horarios cargados para comparar.</p>}
            <h4 className="mt-md">Ocupación de cada {terminology.professionalNoun}</h4>
            {d.ocupacion.length ? d.ocupacion.map((o) => (
              <Medidor key={o.id} nombre={o.nombre} porcentaje={o.porcentaje}
                detalle={`${Math.round(o.ocupados / 60)} h reservadas de ${Math.round(o.disponibles / 60)} h de horario`} />
            )) : <p className="text-sm text-muted">Sin horarios en este período.</p>}
          </div>
        </div>
      </Seccion>

      {/* ── Clientes ── */}
      <Seccion icono="users" titulo={mayuscula(`${terminology.customerNoun}s`)}>
        <div className="kpis kpis-chicos">
          <StatTile label="Nuevos" valor={d.cli.nuevos} detalle="Primera vez en este período" />
          <StatTile label="Volvieron" valor={d.cli.recurrentes} detalle="Ya habían venido antes" />
          <StatTile label="Vuelven" valor={d.cli.nuevos + d.cli.recurrentes ? pct((d.cli.recurrentes / (d.cli.nuevos + d.cli.recurrentes)) * 100) : '—'} detalle="De los atendidos, cuántos ya eran clientes" />
        </div>
        <div className="estadisticas-dos mt-md">
          <div>
            <h4>Los que más vinieron</h4>
            {d.cli.top.length ? (
              <table className="data-table tabla-compacta">
                <thead><tr><th>{terminology.customerNoun}</th><th>Visitas</th><th>Total histórico</th></tr></thead>
                <tbody>{d.cli.top.map((c) => <tr key={c.id}><td>{c.nombre}</td><td>{c.visitasPeriodo}</td><td>{plata(c.gastado)}</td></tr>)}</tbody>
              </table>
            ) : <p className="text-sm text-muted">Sin {turnoPl} atendidos en este período.</p>}
          </div>
          <div>
            <h4>Hace más de 2 meses que no vuelven</h4>
            {d.cli.perdidos.length ? (
              <ul className="lista-simple">
                {d.cli.perdidos.map((c) => (
                  <li key={c.id}>
                    <span>{c.nombre} <span className="text-xs text-muted">· {c.visitas.length} visitas · última {fechaCorta(c.ultima)}</span></span>
                    {c.telefono && (
                      <a className="btn btn-ghost btn-sm" href={`https://wa.me/${c.telefono.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                        <Icon name="chat" /> Escribirle
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Nadie para recuperar por ahora.</p>}
          </div>
        </div>
      </Seccion>

      {/* ── Cancelaciones, ausencias y señas ── */}
      <Seccion icono="x-circle" titulo="Cancelaciones, ausencias y señas">
        <div className="kpis kpis-chicos">
          <StatTile label="Canceló el cliente" valor={d.canc.porCliente} />
          <StatTile label="Canceló el negocio" valor={d.canc.porNegocio} />
          <StatTile label="Señas cobradas" valor={plata(d.canc.senas.cobrado)} detalle={`${d.canc.senas.cantidad} señas`} />
          <StatTile label="Señas devueltas" valor={plata(d.canc.senas.devuelto)} />
          <StatTile label="Señas retenidas" valor={plata(d.canc.senas.retenido)} detalle="De quien canceló o no vino" />
        </div>
        <h4 className="mt-md">Ausencias por {terminology.professionalNoun}</h4>
        {d.canc.ausencias.length ? (
          <table className="data-table tabla-compacta">
            <thead><tr><th>{terminology.professionalNoun}</th><th>{turnoPl}</th><th>No vinieron</th><th>%</th></tr></thead>
            <tbody>{d.canc.ausencias.map((a) => <tr key={a.id}><td>{a.nombre}</td><td>{a.total}</td><td>{a.noVino}</td><td>{pct(a.tasa)}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-sm text-muted">Sin {turnoPl} en este período.</p>}
      </Seccion>
    </div>
  );
}

function Seccion({ icono, titulo, children }) {
  return (
    <section className="card estadisticas-seccion">
      <h3><Icon name={icono} /> {titulo}</h3>
      {children}
    </section>
  );
}
