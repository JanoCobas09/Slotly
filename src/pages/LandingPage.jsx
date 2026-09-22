import { Link } from 'react-router-dom';
import { PLANS, FEATURES_COMUNES, OVERAGE_COST_USD } from '../config/plans';
import HeroMotionMockup from '../components/landing/HeroMotionMockup';
import FloatingActionWidget from '../components/landing/FloatingActionWidget';
import Icon from '../components/Icon';

// ============================================================================
// Landing pública de Slotly
// ============================================================================
// Decisión que ordena todo lo demás: el onboarding es MANUAL. No hay registro
// self-service, así que el CTA no puede ser "creá tu cuenta gratis" — sería una
// promesa que la app no cumple. Todos los CTA van a WhatsApp, que además es
// donde el dueño del negocio realmente contesta.
//
// El orden de las secciones sigue el recorrido de alguien que no conoce el
// producto: primero se reconoce en el problema, después ve la solución, después
// pregunta el precio, y recién al final se le contestan las objeciones.

const WHATSAPP = '5492257660073';
const mensajeWA = encodeURIComponent(
  'Hola, vi la plataforma y quiero saber más para mi negocio.'
);
const LINK_WA = `https://wa.me/${WHATSAPP}?text=${mensajeWA}`;

const DOLORES = [
  {
    icono: 'phone',
    titulo: 'Frenás todo para contestar',
    texto: 'Cada mensaje que entra te saca de lo que estás haciendo. Y si no contestás en el momento, el cliente se va a otro lado.',
  },
  {
    icono: 'user-x',
    titulo: 'Reservan y no aparecen',
    texto: 'Un turno vacío es plata que no vuelve. Sin recordatorio, entre el 20% y el 30% no se presenta.',
  },
  {
    icono: 'note',
    titulo: 'La agenda vive en un cuaderno',
    texto: 'Si el cuaderno no está, nadie sabe quién viene. Y averiguar cuánto facturaste el mes pasado es imposible.',
  },
];

const BENEFICIOS = [
  {
    icono: 'link',
    titulo: 'Tu link, tu agenda',
    texto: 'Cada negocio tiene su propia dirección. La ponés en el perfil de Instagram y tus clientes reservan solos, a cualquier hora, sin instalar nada.',
  },
  {
    icono: 'bell',
    titulo: 'Recordatorio por WhatsApp',
    texto: 'El sistema le avisa al cliente el día antes y unas horas antes. Es la función que más ausencias evita.',
    proximamente: true,
  },
  {
    icono: 'calendar',
    titulo: 'Sabe quién trabaja cuándo',
    texto: 'Cargás el horario de cada profesional, sus descansos y qué servicios hace. La agenda no ofrece turnos que no se pueden atender.',
  },
  {
    icono: 'users',
    titulo: 'Cada uno ve lo suyo',
    texto: 'El dueño ve todo: caja, estadísticas, el equipo completo. Cada profesional ve solo sus propios turnos del día.',
  },
  {
    icono: 'chart-bar',
    titulo: 'Números de verdad',
    texto: 'Cuánto facturaste, qué servicio deja más, quién tiene más ausencias. Sin planillas.',
  },
  {
    icono: 'sparkle',
    titulo: 'Con tu cara, no la nuestra',
    texto: 'Tu nombre, tus colores y tu propia terminología: cada negocio tiene su paleta y su lenguaje. Para tu cliente es la agenda de tu negocio, no la de un proveedor.',
  },
];

const PASOS = [
  { n: '01', icono: 'chat', t: 'Hablamos', d: 'Nos contás cómo trabajás: a qué te dedicás, cuántos profesionales, qué servicios, qué horarios.' },
  { n: '02', icono: 'settings', t: 'Te la dejamos lista', d: 'Configuramos todo nosotros: tu equipo, tus precios, tus horarios. Vos no tocás nada.' },
  { n: '03', icono: 'link', t: 'Compartís el link', d: 'Lo ponés en Instagram y en tu estado de WhatsApp. Esa misma tarde entra el primer turno.' },
];

const FAQ = [
  {
    q: '¿Mis clientes tienen que bajarse una app?',
    a: 'No. Abren el link, entran con su cuenta de Google y reservan. Funciona en cualquier celular, desde el navegador.',
  },
  {
    q: 'Mis clientes son grandes, ¿lo van a poder usar?',
    a: 'Son cuatro pasos: profesional, servicio, día y hora. Nada de formularios ni contraseñas nuevas. Y el que prefiere llamarte, te sigue llamando: vos cargás ese turno a mano en dos toques.',
  },
  {
    q: '¿Sirve para cualquier tipo de negocio?',
    a: 'Sí. Al armar la cuenta nos contás a qué te dedicás — barbería, consultorio, taller, estudio, lo que sea — y dejamos la terminología, los servicios sugeridos y los colores acomodados a tu rubro.',
  },
  {
    q: '¿Y si ya tengo turnos anotados?',
    a: 'Los pasamos nosotros en el armado. No arrancás con la agenda vacía.',
  },
  {
    q: '¿Tengo que firmar algo?',
    a: 'No hay permanencia. Es mes a mes: si no te sirve, avisás y listo.',
  },
  {
    q: '¿Cuánto tarda en estar andando?',
    a: 'Si tenemos tus datos, el mismo día. Lo que más tarda sos vos decidiendo los precios.',
  },
  {
    q: '¿Qué pasa con la información de mis clientes?',
    a: 'Es tuya. Cada negocio está separado de los demás: nadie de otro negocio ve tus turnos. Si algún día te vas, coordinamos cómo pasártela.',
  },
];

// Días de prueba que se ofrecen en la landing. Tiene que coincidir con lo que
// cargues en "Días de prueba sin cargo" al dar de alta el negocio.
const DIAS_DEMO = 10;

function CTAWhatsApp({ children = 'Hablemos por WhatsApp', clase = 'btn-primary btn-lg' }) {
  return (
    <a href={LINK_WA} target="_blank" rel="noreferrer" className={`btn ${clase}`} style={{ textDecoration: 'none' }}>
      {children} →
    </a>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="landing-hero" id="inicio">
        <span className="eyebrow">• Turnos y reservas para tu negocio · Argentina</span>

        <h1 className="landing-title">
          Tu agenda no vive
          <br />
          <span className="acento">en WhatsApp.</span>
          <br />
          Vive acá.
        </h1>

        <p className="landing-lead">
          Tus clientes reservan solos desde un link. Vos atendés. El
          sistema se acuerda del resto.
        </p>

        <div className="landing-cta-row">
          <CTAWhatsApp />
          <a href="#precios" className="btn btn-outline btn-lg" style={{ textDecoration: 'none' }}>
            Ver precios
          </a>
        </div>

        <ul className="landing-checks">
          <li><Icon name="check" /> Lo configuramos nosotros</li>
          <li><Icon name="check" /> Sin permanencia</li>
          <li><Icon name="check" /> Andando el mismo día</li>
        </ul>

        {/* Dynamic 3D HTML Motion Hero Mockup */}
        <HeroMotionMockup />
      </section>

      {/* ── PROBLEMA ─────────────────────────────────────────────────────── */}
      <section className="landing-section" id="problema">
        <span className="eyebrow">• El día a día</span>
        <h2 className="landing-h2">Esto ya lo viviste</h2>
        <div className="landing-grid-3">
          {DOLORES.map((d) => (
            <div key={d.titulo} className="card landing-card">
              <div className="landing-card-icon">
                <Icon name={d.icono} />
              </div>
              <h3>{d.titulo}</h3>
              <p>{d.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SOLUCIÓN ─────────────────────────────────────────────────────── */}
      <section className="landing-section landing-section-alt" id="funciones">
        <span className="eyebrow">• Lo que hace</span>
        <h2 className="landing-h2">Una agenda que trabaja sola</h2>
        <div className="landing-grid-3">
          {BENEFICIOS.map((b) => (
            <div key={b.titulo} className="card landing-card landing-card-benefit">
              <div className="landing-benefit-icon">
                <Icon name={b.icono} />
              </div>
              <h3>
                {b.titulo}
                {b.proximamente && <span className="badge badge-warning landing-soon">pronto</span>}
              </h3>
              <p>{b.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CÓMO EMPIEZA ─────────────────────────────────────────────────── */}
      <section className="landing-section" id="como-arranca">
        <span className="eyebrow">• Cómo arranca</span>
        <h2 className="landing-h2">No tenés que configurar nada</h2>
        <p className="landing-sub">
          No es un sistema que te bajás y peleás solo. Lo dejamos andando nosotros.
        </p>
        <div className="landing-grid-3">
          {PASOS.map((p) => (
            <div key={p.n} className="landing-step">
              <div className="landing-step-header">
                <span className="landing-step-num">{p.n}</span>
                <div className="landing-step-icon">
                  <Icon name={p.icono} />
                </div>
              </div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRECIOS ──────────────────────────────────────────────────────── */}
      <section className="landing-section landing-section-alt" id="precios">
        <span className="eyebrow">• Precios</span>
        <h2 className="landing-h2">Sin letra chica</h2>
        <p className="landing-sub">
          Mes a mes, sin permanencia. La diferencia entre planes es la capacidad
          de tu negocio: cuántos profesionales y qué tan lejos llegan las
          estadísticas.
        </p>

        {/* La prueba sin cargo no se activa sola: la damos nosotros al preparar
            la cuenta. Por eso el llamado es a escribir, no a un botón de alta. */}
        <div className="card landing-demo">
          <h3 style={{ marginBottom: 8 }}>
            Probala {DIAS_DEMO} días sin pagar nada
          </h3>
          <p className="text-secondary" style={{ marginBottom: 16 }}>
            Te dejamos la cuenta lista con tu equipo, tus servicios y tus
            horarios cargados. Si a los {DIAS_DEMO} días no te sirve, no hacés
            nada y se cierra sola. No pedimos tarjeta.
          </p>
          <CTAWhatsApp clase="btn-primary">
            Pedir mi prueba de {DIAS_DEMO} días
          </CTAWhatsApp>
        </div>

        <div className="landing-grid-3">
          {PLANS.map((plan, i) => (
            <div key={plan.id} className={`card landing-price ${i === 1 ? 'destacado' : ''}`}>
              {i === 1 && <span className="landing-price-tag">El más elegido</span>}
              <h3>{plan.label.replace('Plan ', '')}</h3>
              <div className="landing-price-amount">
                ${plan.monthlyFee.toLocaleString('es-AR')}
                <span>/mes</span>
              </div>
              <p className="landing-price-desc">{plan.description}</p>
              <ul className="landing-price-list">
                {plan.features.map((feat) => {
                  // Una feature puede venir como texto o como objeto con
                  // `proximamente`: lo que todavía no anda se marca en vez de
                  // venderse como disponible.
                  const texto = typeof feat === 'string' ? feat : feat.texto;
                  const pronto = typeof feat === 'object' && feat.proximamente;
                  return (
                    <li key={texto} style={pronto ? { opacity: 0.7 } : undefined}>
                      <Icon name={pronto ? 'clock' : 'check'} /> {texto}
                      {pronto && <span className="badge badge-warning landing-soon">pronto</span>}
                    </li>
                  );
                })}
              </ul>
              <CTAWhatsApp clase={i === 1 ? 'btn-primary btn-full' : 'btn-outline btn-full'}>
                Lo quiero
              </CTAWhatsApp>
            </div>
          ))}
        </div>

        {/* Lo que no cambia entre planes va una sola vez: así cada tarjeta
            muestra únicamente por qué elegirla, y no se promete como exclusivo
            lo que en realidad tienen todos. */}
        <div className="card landing-comunes">
          <strong>Todos los planes incluyen:</strong>{' '}
          {FEATURES_COMUNES.join(' · ')}
        </div>

        <p className="landing-fineprint">
          Precios en pesos argentinos. Los mensajes por encima del plan se cobran
          USD {OVERAGE_COST_USD.toFixed(2)} cada uno — te avisamos antes de que
          pase, nunca hay sorpresas en la factura.
        </p>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="landing-section" id="dudas">
        <span className="eyebrow">• Dudas</span>
        <h2 className="landing-h2">Lo que siempre nos preguntan</h2>
        <div className="landing-faq">
          {FAQ.map((f) => (
            <details key={f.q} className="card landing-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CIERRE ───────────────────────────────────────────────────────── */}
      <section className="landing-final">
        <h2 className="landing-h2">¿Cuántos turnos perdiste este mes?</h2>
        <p className="landing-lead" style={{ margin: '0 auto var(--space-lg)' }}>
          Contanos cómo trabajás y te decimos en cinco minutos si te sirve. Si no
          te sirve, te lo decimos igual.
        </p>
        <CTAWhatsApp />
        <p className="landing-login">
          ¿Ya sos cliente? <Link to="/login">Entrá a tu panel</Link>
        </p>
      </section>

      {/* Botón flotante de contacto por WhatsApp */}
      <FloatingActionWidget />
    </div>
  );
}
