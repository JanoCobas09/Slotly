import { useState } from 'react';
import Icon from '../Icon';

// ============================================================================
// Gráficos del Dashboard (sin librerías): marcas finas del color del
// negocio (--primary), una sola escala por gráfico, valor en la punta de la
// barra, tooltip al pasar el mouse o con el foco del teclado, y cada dato
// también en texto o en tabla — nunca solo en el color.
// ============================================================================

/**
 * Indicador: etiqueta, valor y variación contra el período anterior. La
 * flecha y el signo dicen la dirección; el color dice si es buena o mala
 * (`subirEsBueno`), nunca solo el color.
 */
export function StatTile({ label, valor, delta = null, subirEsBueno = true, detalle = null, destacado = false }) {
  let cambio = null;
  if (delta !== null && Number.isFinite(delta)) {
    const sube = delta > 0.5, baja = delta < -0.5;
    const bueno = (sube && subirEsBueno) || (baja && !subirEsBueno);
    const malo = (sube && !subirEsBueno) || (baja && subirEsBueno);
    cambio = (
      <span className={`kpi-delta ${bueno ? 'bueno' : malo ? 'malo' : ''}`}>
        {sube ? '▲' : baja ? '▼' : '='} {Math.abs(delta).toFixed(0)}% <span className="kpi-delta-vs">vs. período anterior</span>
      </span>
    );
  }
  return (
    <div className={`kpi ${destacado ? 'kpi-destacado' : ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-valor">{valor}</span>
      {cambio}
      {detalle && <span className="kpi-detalle">{detalle}</span>}
    </div>
  );
}

/** Tooltip que sigue a la marca: valor fuerte, etiqueta secundaria. */
function Tooltip({ info }) {
  if (!info) return null;
  return (
    <div className="grafico-tooltip" style={{ left: info.x, top: info.y }} role="status">
      <strong>{info.valor}</strong>
      <span>{info.label}</span>
    </div>
  );
}

function useTooltip() {
  const [info, setInfo] = useState(null);
  const mostrar = (ev, valor, label) => {
    const caja = ev.currentTarget.closest('.grafico').getBoundingClientRect();
    const marca = ev.currentTarget.getBoundingClientRect();
    setInfo({ x: marca.left - caja.left + marca.width / 2, y: marca.top - caja.top, valor, label });
  };
  return { info, mostrar, ocultar: () => setInfo(null) };
}

/**
 * Columnas por día (una sola serie). Cada columna es foco de teclado y
 * tiene tooltip; el eje X marca la primera, la última y algunas del medio.
 */
export function ColumnasPorDia({ datos, valor, formato, etiquetaFecha, vacio = 'Sin datos en este período' }) {
  const { info, mostrar, ocultar } = useTooltip();
  const max = Math.max(0, ...datos.map(valor));
  if (!datos.length || max === 0) return <p className="text-sm text-muted grafico-vacio">{vacio}</p>;
  const cada = Math.max(1, Math.ceil(datos.length / 7));
  return (
    <div className="grafico">
      <div className="grafico-eje-y"><span>{formato(max)}</span><span>0</span></div>
      <div className="grafico-columnas" onMouseLeave={ocultar}>
        {datos.map((d) => {
          const v = valor(d);
          return (
            <button
              key={d.fecha}
              type="button"
              className="grafico-col"
              aria-label={`${etiquetaFecha(d.fecha)}: ${formato(v)}`}
              onMouseEnter={(e) => mostrar(e, formato(v), etiquetaFecha(d.fecha))}
              onFocus={(e) => mostrar(e, formato(v), etiquetaFecha(d.fecha))}
              onBlur={ocultar}
            >
              <span className="grafico-col-barra" style={{ height: `${(v / max) * 100}%` }} />
            </button>
          );
        })}
      </div>
      <div className="grafico-eje-x">
        {datos.map((d, i) => (
          <span key={d.fecha}>{i % cada === 0 || i === datos.length - 1 ? etiquetaFecha(d.fecha, true) : ''}</span>
        ))}
      </div>
      <Tooltip info={info} />
    </div>
  );
}

/** Ranking horizontal: nombre, barra y valor en la punta. */
export function BarrasRanking({ items, formato, detalle, vacio = 'Sin datos en este período' }) {
  if (!items.length) return <p className="text-sm text-muted">{vacio}</p>;
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <ul className="ranking">
      {items.map((it) => (
        <li key={it.id}>
          <span className="ranking-nombre" title={it.nombre}>{it.nombre}</span>
          <span className="ranking-pista">
            <span className="ranking-barra" style={{ width: `${Math.max(2, (it.total / max) * 100)}%` }} />
          </span>
          <span className="ranking-valor">{formato(it.total)}{detalle && <small>{detalle(it)}</small>}</span>
        </li>
      ))}
    </ul>
  );
}

/** Medidor 0–100%: la pista es un paso más claro del mismo color. */
export function Medidor({ nombre, porcentaje, detalle }) {
  const p = porcentaje ?? 0;
  return (
    <div className="medidor">
      <div className="medidor-cabecera">
        <span>{nombre}</span>
        <strong>{porcentaje === null ? '—' : `${p.toFixed(0)}%`}</strong>
      </div>
      <div className="medidor-pista" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={`Ocupación de ${nombre}`}>
        <span style={{ width: `${p}%` }} />
      </div>
      {detalle && <span className="text-xs text-muted">{detalle}</span>}
    </div>
  );
}

const PASOS = [0, 1, 2, 3, 4];
const pasoDe = (n, max) => (n <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));

/**
 * Mapa de calor día × hora, en un solo color (más turnos = más oscuro). Las
 * franjas donde nadie atiende quedan en blanco para no confundirlas con
 * "abierto y vacío".
 */
export function MapaCalor({ horas, celdas, abiertas, maximo, dias }) {
  const { info, mostrar, ocultar } = useTooltip();
  if (!horas.length) return <p className="text-sm text-muted grafico-vacio">Todavía no hay horarios ni turnos para armar el mapa.</p>;
  return (
    <div className="grafico">
      {/* Columnas por variable CSS y no por `gridTemplateColumns` inline: en el
          celular hay una regla del panel que pasa a una columna todo grid
          definido inline, y desarmaba el mapa. */}
      <div className="mapa-scroll">
      <div className="mapa-calor" style={{ '--horas': horas.length }} onMouseLeave={ocultar}>
        <span />
        {horas.map((h) => <span key={h} className="mapa-hora">{h}</span>)}
        {dias.map((nombre, dia) => (
          <Fila key={dia} nombre={nombre} dia={dia} horas={horas} celdas={celdas} abiertas={abiertas} maximo={maximo} mostrar={mostrar} ocultar={ocultar} />
        ))}
      </div>
      </div>
      <div className="mapa-leyenda" aria-hidden="true">
        <span>Menos</span>
        {PASOS.map((p) => <span key={p} className={`mapa-celda paso-${p}`} />)}
        <span>Más turnos</span>
        <span className="mapa-celda cerrada" style={{ marginLeft: 12 }} /> <span>Nadie atiende</span>
      </div>
      <Tooltip info={info} />
    </div>
  );
}

function Fila({ nombre, dia, horas, celdas, abiertas, maximo, mostrar, ocultar }) {
  return (
    <>
      <span className="mapa-dia">{nombre}</span>
      {horas.map((h) => {
        const k = `${dia}-${h}`;
        const n = celdas[k] || 0;
        const abierta = abiertas.has(k) || n > 0;
        const texto = `${nombre} ${h} a ${h + 1} hs`;
        const valor = abierta ? `${n} ${n === 1 ? 'turno' : 'turnos'}` : 'Nadie atiende';
        return (
          <button
            key={k}
            type="button"
            className={`mapa-celda ${abierta ? `paso-${pasoDe(n, maximo)}` : 'cerrada'}`}
            aria-label={`${texto}: ${valor}`}
            onMouseEnter={(e) => mostrar(e, valor, texto)}
            onFocus={(e) => mostrar(e, valor, texto)}
            onBlur={ocultar}
          />
        );
      })}
    </>
  );
}

/** Tabla con los mismos datos del gráfico (accesible sin hover). */
export function VerEnTabla({ columnas, filas }) {
  return (
    <details className="ver-tabla">
      <summary><Icon name="clipboard" /> Ver en tabla</summary>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr>{columnas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
