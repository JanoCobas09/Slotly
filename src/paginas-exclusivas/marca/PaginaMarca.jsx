import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice } from '../../utils/dateUtils';
import { mixColor, necesitaTextoOscuro } from '../../utils/colorUtils';
import { linkComoLlegar } from '../../utils/linkComoLlegar';
import { telefonoWhatsApp } from '../../utils/avisosWhatsApp';
import { useUbicacionDelMapa } from '../../hooks/useUbicacionDelMapa';
import Icon from '../../components/Icon';
import './marca.css';

// ============================================================================
// Página de marca — la plantilla del perfil personalizado
// ============================================================================
// Una sola plantilla para todos los negocios con perfil personalizado (ver
// `../index.js`), con la estructura de la de Neytan en BarberOS. La idea en
// una línea: que el link de la bio deje de parecer un formulario sin perder
// lo que lo hace útil, que es sacar turno.
//
// Por eso el orden no se negocia: lo PRIMERO que se ve, sin scrollear y en el
// celular más chico, es el botón de reservar. Lo demás (sobre nosotros,
// servicios, Instagram, horarios, dónde) queda abajo para el que quiere mirar,
// y desde cualquier punto la barra de abajo lo devuelve a reservar.
//
// La identidad sale del negocio: su logo, su color principal (si lo cambia
// desde Configuración cambia acá también) y los textos de su entrada en
// MARCAS. Todo dato del negocio se lee de lo cargado.

const ZONA = 'America/Argentina/Buenos_Aires';
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Día (0 = lunes, como `businessHours`) y minutos desde las 00:00, en Argentina. */
function ahoraEnArgentina() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(v.weekday);
  return { dia, min: Number(v.hour) * 60 + Number(v.minute) };
}

const aMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return h * 60 + (m || 0);
};
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const precio = (s) => `${s.variaPrecio ? 'Desde ' : ''}${formatPrice(s.price)}`;
const duracion = (s) => {
  if (!s.durationMinutes) return '';
  return s.durMax && s.durMax !== s.durationMinutes ? `${s.durationMinutes}–${s.durMax} min` : `${s.durationMinutes} min`;
};

const abreEseDia = (d) => Boolean(d && d.isActive !== false && d.startTime && d.endTime);

/**
 * "Abierto · hasta las 20:00" o "Cerrado · abre mañana 09:00".
 *
 * No es decorado: a las 22 un cliente que ve "abierto" y escribe por WhatsApp
 * espera respuesta. Y "abre mañana" le dice que igual puede reservar ya.
 */
function estadoDeAhora(semana) {
  if (!semana?.length) return null;
  const { dia, min } = ahoraEnArgentina();
  if (dia < 0) return null;
  const delDia = (n) => semana.find((d) => d.dayOfWeek === n);

  const hoy = delDia(dia);
  if (abreEseDia(hoy) && min >= aMin(hoy.startTime) && min < aMin(hoy.endTime)) {
    return { abierto: true, texto: `hasta las ${aHora(aMin(hoy.endTime))}` };
  }
  for (let i = 0; i < 7; i++) {
    const n = (dia + i) % 7;
    const d = delDia(n);
    if (abreEseDia(d) && (i > 0 || aMin(d.startTime) > min)) {
      const cuando = i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${DIAS_LARGOS[n]}`;
      return { abierto: false, texto: `abre ${cuando} ${aHora(aMin(d.startTime))}` };
    }
  }
  return null;
}

/** La semana en renglones: días seguidos con el mismo horario van juntos ("Lun a Vie"). */
function renglonesDeHorario(semana) {
  const dias = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const d = (semana || []).find((x) => x.dayOfWeek === n);
    return { n, horas: abreEseDia(d) ? `${d.startTime}–${d.endTime}` : null };
  });
  if (!dias.some((d) => d.horas)) return [];
  const renglones = [];
  for (const d of dias) {
    const ultimo = renglones[renglones.length - 1];
    if (ultimo && ultimo.horas === d.horas) ultimo.hasta = d.n;
    else renglones.push({ desde: d.n, hasta: d.n, horas: d.horas });
  }
  return renglones.map((r) => ({
    ...r,
    dias: r.desde === r.hasta ? DIAS_CORTOS[r.desde] : `${DIAS_CORTOS[r.desde]} a ${DIAS_CORTOS[r.hasta]}`,
  }));
}

/**
 * Aparece al llegar scrolleando. Una vez por elemento; el CSS lo apaga con
 * reduced-motion. `clave` cambia cuando llega contenido nuevo: sin eso, lo
 * que llega tarde nunca se observa y queda invisible.
 */
function useAparecer(clave) {
  const ref = useRef(null);
  useEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    const pendientes = raiz.querySelectorAll('.pm-aparece:not(.pm-visible)');
    if (typeof IntersectionObserver === 'undefined') {
      pendientes.forEach((el) => el.classList.add('pm-visible'));
      return;
    }
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) { e.target.classList.add('pm-visible'); obs.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    pendientes.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [clave]);
  return ref;
}

/**
 * Pinta el fondo del documento y la barra del navegador con el de la página
 * mientras está abierta: sin esto, al estirar la página en el iPhone (el
 * rebote) se ve el fondo de Slotly detrás.
 */
function useFondoDelDocumento(color) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const antes = { body: document.body.style.background, html: document.documentElement.style.background, meta: meta?.content };
    document.body.style.background = color;
    document.documentElement.style.background = color;
    if (meta) meta.content = color;
    return () => {
      document.body.style.background = antes.body;
      document.documentElement.style.background = antes.html;
      if (meta && antes.meta) meta.content = antes.meta;
    };
  }, [color]);
}

const Flecha = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="pm-flecha"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" /></svg>
);

function Mapa({ business }) {
  const { consulta, ftid } = useUbicacionDelMapa(business);
  if (!consulta) return null;
  return (
    <div className="pm-mapa">
      <iframe
        title={`Mapa de ${business.name}`}
        src={`https://maps.google.com/maps?q=${encodeURIComponent(consulta)}${ftid ? `&ftid=${encodeURIComponent(ftid)}` : ''}&z=16&output=embed`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

export default function PaginaMarca({ marca, business, servicios = [], slug, onReservar }) {
  const oscuro = marca.tema !== 'claro';
  const fondo = oscuro ? '#070707' : '#f7f5f1';
  useFondoDelDocumento(fondo);

  // El "abierto / cerrado" se recalcula cada minuto: la página puede quedar
  // abierta en una pestaña. El intervalo solo fuerza el redibujo.
  const [, setMinuto] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuto((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const estado = estadoDeAhora(business.businessHours);

  // La barra de abajo aparece cuando el botón grande de la portada se fue de
  // pantalla, y se va cuando llega el del cierre: dos botones de reservar a la
  // vista a la vez es ruido.
  const heroCta = useRef(null);
  const cierreCta = useRef(null);
  const [barra, setBarra] = useState(false);
  useEffect(() => {
    const arriba = heroCta.current;
    const abajo = cierreCta.current;
    if (!arriba || typeof IntersectionObserver === 'undefined') return;
    const vista = { pasoArriba: false, llegoAbajo: false };
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.target === arriba) vista.pasoArriba = !e.isIntersecting && e.boundingClientRect.top < 0;
        else vista.llegoAbajo = e.isIntersecting;
      }
      setBarra(vista.pasoArriba && !vista.llegoAbajo);
    });
    obs.observe(arriba);
    if (abajo) obs.observe(abajo);
    return () => obs.disconnect();
  }, []);

  const color = business.primaryColor || '#404040';
  // El color como TEXTO tiene que leerse sobre el fondo: un verde neón sobre
  // claro o un azul marino sobre negro no se leen, así que se corre hacia el
  // negro o el blanco. Los botones y la cinta usan el color tal cual.
  const claroElColor = necesitaTextoOscuro(color);
  const colorTexto = oscuro
    ? (claroElColor ? color : mixColor(color, '#ffffff', 0.45))
    : (claroElColor ? mixColor(color, '#000000', 0.5) : color);
  const estilo = {
    '--pm-color': color,
    '--pm-color-texto': colorTexto,
    '--pm-sobre-color': necesitaTextoOscuro(color) ? '#0b0b0b' : '#ffffff',
    '--pm-fondo': fondo,
  };

  const activos = useMemo(
    () => [...servicios].sort((a, b) => (a.price || 0) - (b.price || 0)),
    [servicios]
  );
  // El servicio destacado: el que eligió el negocio, o el más caro si hay de
  // dónde elegir. Con uno o dos, destacarlo es destacar la lista.
  const estrella = activos.find((s) => s.id === marca.estrella)
    || (activos.length > 2 ? activos[activos.length - 1] : null);
  const carta = estrella ? activos.filter((s) => s.id !== estrella.id) : activos;

  const numeroWa = telefonoWhatsApp(business.socialLinks?.whatsapp || business.phone);
  const wa = numeroWa ? `https://wa.me/${numeroWa}` : null;
  const usuarioIg = String(business.socialLinks?.instagram || '').trim().replace(/^@/, '');
  const ig = usuarioIg ? `https://instagram.com/${usuarioIg}` : null;
  const comoLlegar = linkComoLlegar(business);
  const direccion = business.address?.trim() || '';

  const horarios = renglonesDeHorario(business.businessHours);
  const hoy = ahoraEnArgentina().dia;

  const parrafos = (marca.sobre?.parrafos || []).map((p) => String(p).trim()).filter(Boolean).slice(0, 3);
  const ref = useAparecer(`${activos.length}-${horarios.length}`);
  const reservar = () => onReservar();

  const cinta = [marca.frase, business.name, marca.ciudad, 'Reservá online'].filter(Boolean);

  return (
    <div className={`pm ${oscuro ? 'pm-oscuro' : 'pm-claro'}`} style={estilo} ref={ref}>
      {/* ───── Portada ───── */}
      <header className={`pm-hero ${marca.portada ? 'pm-hero-foto' : ''}`}>
        <div className="pm-hero-fondo" aria-hidden="true">
          {marca.portada && <img src={marca.portada} alt="" className="pm-portada" />}
          <div className="pm-halo" />
          <div className="pm-grano" />
        </div>

        <div className="pm-topbar">
          <span className="pm-etiqueta">{marca.ciudad ? `${marca.ciudad} · AR` : business.name}</span>
          <div className="pm-topbar-redes">
            {ig && <a href={ig} target="_blank" rel="noreferrer" aria-label="Instagram"><Icon name="instagram" /></a>}
            {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label="WhatsApp"><Icon name="whatsapp" /></a>}
          </div>
        </div>

        <div className="pm-hero-cuerpo">
          {business.logoUrl
            ? <img src={business.logoUrl} alt={business.name} className="pm-logo" />
            : <p className="pm-logo-texto">{business.name}</p>}
          <h1 className="pm-oculto">{business.name}</h1>
          {marca.frase && <p className="pm-frase">{marca.frase}</p>}

          {estado && (
            <p className={`pm-estado ${estado.abierto ? 'pm-estado-abierto' : ''}`}>
              <span className="pm-punto" aria-hidden="true" />
              <strong>{estado.abierto ? 'Abierto' : 'Cerrado'}</strong> · {estado.texto}
            </p>
          )}

          <button type="button" ref={heroCta} className="pm-cta pm-cta-grande" onClick={reservar}>
            Reservá tu turno <Flecha />
          </button>
          <p className="pm-cta-nota">Elegís día y hora, y listo. Sin llamar.</p>
        </div>

        <a href="#pm-servicios" className="pm-bajar">
          <span>Conocé más</span>
          <span className="pm-bajar-linea" aria-hidden="true" />
        </a>
      </header>

      {/* ───── Cinta ───── */}
      <div className="pm-cinta" aria-hidden="true">
        <div className="pm-cinta-pista">
          {[0, 1].map((k) => (
            <span key={k}>{cinta.map((t, i) => <span key={i}>{t} <i>✦</i> </span>)}</span>
          ))}
        </div>
      </div>

      <main className="pm-cuerpo">
        {/* ───── Sobre nosotros ───── */}
        {parrafos.length > 0 && (
          <section className="pm-seccion pm-aparece">
            <p className="pm-etiqueta">Quiénes somos</p>
            <h2 className="pm-titulo">{marca.sobre?.titulo || business.name}</h2>
            <div className="pm-texto">{parrafos.map((t, i) => <p key={i}>{t}</p>)}</div>
          </section>
        )}

        {/* ───── Servicios ───── */}
        {activos.length > 0 && (
          <section className="pm-seccion" id="pm-servicios">
            <div className="pm-aparece">
              <p className="pm-etiqueta">La carta</p>
              <h2 className="pm-titulo">Servicios</h2>
              <p className="pm-bajada">Tocá uno y entrás a reservar con ese ya elegido.</p>
            </div>

            {estrella && (
              <button type="button" className="pm-estrella pm-aparece" onClick={() => onReservar(estrella.id)}>
                <span className="pm-etiqueta">El destacado de la casa</span>
                <span className="pm-estrella-nombre">{estrella.name}</span>
                <span className="pm-estrella-pie">
                  <span>{duracion(estrella)}</span>
                  <span className="pm-estrella-precio">{precio(estrella)}</span>
                </span>
                <span className="pm-estrella-cta">Reservar este <Flecha /></span>
              </button>
            )}

            <ul className="pm-carta">
              {carta.map((s) => (
                <li key={s.id} className="pm-aparece">
                  <button type="button" className="pm-item" onClick={() => onReservar(s.id)}>
                    <span className="pm-item-nombre">{s.name}</span>
                    <span className="pm-item-puntos" aria-hidden="true" />
                    <span className="pm-item-precio">{precio(s)}</span>
                    <span className="pm-item-min">{duracion(s)}</span>
                    <span className="pm-item-ir" aria-hidden="true"><Flecha /></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ───── Instagram ───── */}
        {ig && (
          <section className="pm-seccion pm-aparece">
            <a href={ig} target="_blank" rel="noreferrer" className="pm-ig">
              <span className="pm-etiqueta">Instagram</span>
              <span className="pm-ig-frase">Mirá lo que<br />hacemos.</span>
              <span className="pm-ig-pie">
                <Icon name="instagram" />
                <span>Seguinos en <strong>@{usuarioIg}</strong></span>
                <Flecha />
              </span>
            </a>
          </section>
        )}

        {/* ───── Horarios ───── */}
        {horarios.length > 0 && (
          <section className="pm-seccion pm-aparece">
            <p className="pm-etiqueta">Cuándo</p>
            <h2 className="pm-titulo">Horarios</h2>
            <ul className="pm-horarios">
              {horarios.map((h) => {
                const esHoy = hoy >= h.desde && hoy <= h.hasta;
                return (
                  <li key={h.dias} className={`${esHoy ? 'pm-hoy' : ''} ${h.horas ? '' : 'pm-cerrado'}`}>
                    <span>{h.dias}{esHoy && <em>hoy</em>}</span>
                    <span className="pm-horas">{h.horas || 'Cerrado'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ───── Dónde ───── */}
        {(comoLlegar || wa) && (
          <section className="pm-seccion pm-aparece">
            <p className="pm-etiqueta">Dónde</p>
            <h2 className="pm-titulo">Encontranos</h2>
            {direccion && <p className="pm-bajada">{direccion}</p>}
            {comoLlegar && <Mapa business={business} />}
            <div className="pm-acciones">
              {comoLlegar && (
                <a href={comoLlegar} target="_blank" rel="noreferrer nofollow" className="pm-boton"><Icon name="navigation" /> Cómo llegar</a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="pm-boton"><Icon name="whatsapp" /> Escribinos por WhatsApp</a>
              )}
            </div>
          </section>
        )}

        {/* ───── Cierre ───── */}
        <section className="pm-cierre pm-aparece">
          <p className="pm-cierre-frase">¿Reservamos<br /><span>tu turno?</span></p>
          <button type="button" ref={cierreCta} className="pm-cta pm-cta-grande" onClick={reservar}>
            Reservá tu turno <Flecha />
          </button>
        </section>
      </main>

      <footer className="pm-pie">
        <Link to={`/${slug}/mis-citas`}>Mis turnos</Link>
        <span>{business.name}</span>
        <a href="/" className="pm-marca">Hecho con Slotly</a>
      </footer>

      {/* La barra de abajo: desde cualquier punto de la página, reservar está a un toque. */}
      <div className={`pm-barra ${barra ? 'pm-barra-visible' : ''}`} aria-hidden={!barra}>
        <button type="button" className="pm-cta" onClick={reservar} tabIndex={barra ? 0 : -1}>
          Reservá tu turno <Flecha />
        </button>
      </div>
    </div>
  );
}
