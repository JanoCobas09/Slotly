import { useEffect, useMemo, useRef, useState } from 'react';
import { PROFESSION_PRESETS } from '../../config/professionPresets';
import { formatDate, formatPrice, getMonthName, toDateString } from '../../utils/dateUtils';
import { capitalize, reservadoPara } from '../../utils/text';
import Icon from '../Icon';

// ============================================================================
// "Así se vería tu comercio" — vitrina de la landing
// ============================================================================
// A la izquierda, un EJEMPLO fijo de lo que el dueño carga en Configuración
// (nombre, bienvenida, teléfono, Instagram, ubicación): lo único que se elige
// es el rubro. A la derecha, un celular con la página de reserva REAL que abre
// su cliente, y se puede reservar de punta a punta: profesional → servicio →
// datos → fecha → horario → confirmar → "¡Turno reservado!". Nada se guarda.
//
// Es una copia del markup de BookingPage / ConfirmationPage con sus mismas
// clases de CSS y sus mismas reglas (qué se muestra, cuándo se habilita
// "Siguiente", el encabezado compacto desde el paso 2, el mapa solo en el
// paso 1...). Si cambia esa página, actualizar esta copia para que la vitrina
// no mienta. El mapa es el embed de Google Maps de verdad.
// ============================================================================

const DEMOS = {
  beauty: {
    chip: 'Barbería',
    nombre: 'Barbería El Corte',
    instagram: 'barberia.elcorte',
    direccion: 'Av. Corrientes 1850, CABA',
    profesionales: [{ name: 'Mateo Díaz', specialty: 'Barbero' }, { name: 'Lucas Ruiz', specialty: 'Colorista' }],
    precios: [9000, 13000, 8000, 25000, 15000],
  },
  healthcare: {
    chip: 'Consultorio',
    nombre: 'Consultorio Dra. Paz',
    instagram: 'odontologia.paz',
    direccion: 'Av. Santa Fe 2450, CABA',
    profesionales: [{ name: 'Ana Paz', specialty: 'Odontóloga' }, { name: 'Diego Ibáñez', specialty: 'Ortodoncista' }],
    precios: [25000, 18000, 30000, 28000],
  },
  wellness: {
    chip: 'Bienestar',
    nombre: 'Espacio Raíz',
    instagram: 'espacio.raiz',
    direccion: 'Gorriti 4800, CABA',
    profesionales: [{ name: 'Sol Medina', specialty: 'Masajista' }, { name: 'Camila Sosa', specialty: 'Psicóloga' }],
    precios: [28000, 22000],
  },
  automotive: {
    chip: 'Taller',
    nombre: 'Taller Don Julio',
    instagram: 'taller.donjulio',
    direccion: 'Av. Warnes 1200, CABA',
    profesionales: [{ name: 'Julio Pérez', specialty: 'Mecánico' }, { name: 'Nico Vera', specialty: 'Electricidad' }],
    precios: [35000, 20000, 90000],
  },
  education: {
    chip: 'Clases',
    nombre: 'Estudio Pilates Sur',
    instagram: 'pilates.sur',
    direccion: 'Defensa 900, CABA',
    profesionales: [{ name: 'Flor Gómez', specialty: 'Instructora' }, { name: 'Agus Luna', specialty: 'Instructor' }],
    precios: [15000, 12000],
  },
  pet_services: {
    chip: 'Veterinaria',
    nombre: 'Veterinaria Patitas',
    instagram: 'vet.patitas',
    direccion: 'Av. Rivadavia 5000, CABA',
    profesionales: [{ name: 'Laura Vega', specialty: 'Veterinaria' }, { name: 'Martín Paz', specialty: 'Peluquero canino' }],
    precios: [20000, 24000, 18000],
  },
  professional_services: {
    chip: 'Estudio',
    nombre: 'Estudio Contable Ríos',
    instagram: 'estudio.rios',
    direccion: 'Tucumán 600, CABA',
    profesionales: [{ name: 'Laura Ríos', specialty: 'Contadora' }, { name: 'Pablo Ferro', specialty: 'Sueldos' }],
    precios: [30000, 20000],
  },
};

const RUBROS = Object.keys(DEMOS).filter((k) => PROFESSION_PRESETS[k]);

const TELEFONO_DEMO = '11 4567-8910';

// El cliente de ejemplo, ya "logueado con Google" (en la página real el paso
// de datos pide entrar con Google; acá se saltea).
const CLIENTE_DEMO = { nombre: 'Santiago Rossi', email: 'santiago.rossi@gmail.com', telefono: '11 2345-6789' };
const EXTRAS_DEMO = { vehicleInfo: 'Fiat Cronos · AB 123 CD', petInfo: 'Luna · perra' };

const PASOS = ['Profesional', 'Servicio', 'Datos', 'Fecha', 'Horario', 'Confirmar'];

/** "Barbería El Corte" → "barberia-el-corte" (sin tildes ni símbolos). */
function slugDe(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tu-negocio';
}

const iniciales = (nombre) => nombre.split(' ').map((n) => n[0]).join('');
const aMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Mismas reglas que la página real (BookingPage.jsx).
const telefonoValido = (tel) => { const d = String(tel || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 && /^[\d\s+()\-.]+$/.test(tel); };
const nombreValido = (nombre) => String(nombre || '').trim().length >= 2;

/**
 * Horarios libres de ejemplo: franjas de 9 a 13 y de 15 a 19:30, cada 30 min,
 * que entran enteras con la duración del servicio. Algunos se sacan (ya
 * reservados) según el día, para que no todas las fechas se vean iguales —
 * como en la real, los ocupados directamente no aparecen.
 */
function horariosDelDia(fecha, duracion) {
  const dia = Number(fecha.slice(8, 10));
  const ahora = new Date();
  const esHoy = fecha === toDateString(ahora);
  const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const slots = [];
  [[9 * 60, 13 * 60], [15 * 60, 19 * 60 + 30]].forEach(([desde, hasta]) => {
    for (let t = desde, i = 0; t + duracion <= hasta; t += 30, i++) {
      if ((i + dia) % 4 === 0) continue;
      if (esHoy && t <= minAhora) continue;
      slots.push({ startTime: aHora(t), endTime: aHora(t + duracion) });
    }
  });
  return slots;
}

/**
 * Mes en el que abre el calendario: el actual, salvo que le queden menos de 3
 * días con horarios libres (fin de mes) — ahí abre en el siguiente, en vez de
 * mostrar un mes casi entero apagado. Con ◀ se vuelve al actual.
 */
function mesInicial() {
  const hoy = new Date();
  const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  let libres = 0;
  for (let dia = hoy.getDate(); dia <= ultimo; dia++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
    if (d.getDay() !== 0 && horariosDelDia(toDateString(d), 30).length > 0) libres++;
  }
  return new Date(hoy.getFullYear(), hoy.getMonth() + (libres < 3 ? 1 : 0), 1);
}

// Campos del panel de ejemplo. `etiqueta` dice dónde aparece en la página.
const CAMPOS = [
  { key: 'nombre', label: 'Nombre del negocio', etiqueta: 'Cabecera' },
  { key: 'bienvenida', label: 'Mensaje de bienvenida', etiqueta: 'Debajo del nombre' },
  { key: 'telefono', label: 'Teléfono', etiqueta: 'Botón para llamar' },
  { key: 'instagram', label: 'Instagram', etiqueta: 'Botón a tu perfil', prefijo: '@' },
  { key: 'direccion', label: 'Ubicación en Google Maps', etiqueta: 'Mapa + Cómo llegar' },
];

const RESERVA_VACIA = {
  paso: 1, proIdx: null, servicioIdx: null, fecha: null, slot: null,
  nombre: CLIENTE_DEMO.nombre, telefono: CLIENTE_DEMO.telefono, extras: EXTRAS_DEMO,
};

export default function VitrinaComercio() {
  const [rubro, setRubro] = useState('beauty');
  const [foco, setFoco] = useState(null);
  const [reserva, setReserva] = useState(RESERVA_VACIA);
  const [mes, setMes] = useState(mesInicial);
  const pantallaRef = useRef(null);
  const tocado = useRef(false);

  const preset = PROFESSION_PRESETS[rubro];
  const demo = DEMOS[rubro];
  const { terminology } = preset;
  const nombre = demo.nombre;
  const host = typeof window !== 'undefined' ? window.location.host : 'slotly-turnos.vercel.app';
  const valores = { nombre, bienvenida: '', telefono: TELEFONO_DEMO, instagram: demo.instagram, direccion: demo.direccion };

  const servicios = preset.suggestedServices.map((s, i) => ({ ...s, price: demo.precios[i] ?? 15000 }));
  const profesional = reserva.proIdx !== null ? demo.profesionales[reserva.proIdx] : null;
  const servicio = reserva.servicioIdx !== null ? servicios[reserva.servicioIdx] : null;
  const campos = preset.customerFields || [];
  const { paso } = reserva;
  const confirmado = paso === 7;

  // Las mismas variables que pisa applyTheme() en la página del negocio,
  // acotadas al celular para no teñir la landing.
  const tema = useMemo(() => ({
    '--primary': preset.theme.primaryColor,
    '--primary-hover': preset.theme.primaryHover,
    '--primary-light': preset.theme.primaryLight,
    '--secondary': preset.theme.secondaryColor,
    '--accent': preset.theme.accentColor,
    '--on-primary': '#ffffff',
  }), [preset]);

  const reiniciar = () => {
    setReserva(RESERVA_VACIA);
    setMes(mesInicial());
  };

  const elegirRubro = (k) => {
    setRubro(k);
    reiniciar();
  };

  const cambiar = (cambios) => setReserva((r) => ({ ...r, ...cambios }));

  // Cada cambio de paso arranca la pantalla desde arriba, como una página nueva.
  useEffect(() => {
    pantallaRef.current?.scrollTo({ top: 0 });
  }, [paso]);

  // Recorrido de una sola vez: cuando la vitrina entra en pantalla, el
  // celular baja hasta el mapa y vuelve arriba — el mapa queda debajo de los
  // profesionales (igual que en la página real) y si no, nadie lo ve. Se
  // cancela apenas la persona toca el celular o un campo.
  useEffect(() => {
    const pantalla = pantallaRef.current;
    if (!pantalla || !('IntersectionObserver' in window)) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timers = [];
    const ir = (top) => { if (!tocado.current) pantalla.scrollTo({ top, behavior: 'smooth' }); };
    const obs = new IntersectionObserver(([entrada]) => {
      if (!entrada.isIntersecting) return;
      obs.disconnect();
      timers.push(setTimeout(() => ir(pantalla.scrollHeight), 1400));
      timers.push(setTimeout(() => ir(0), 5200));
    }, { threshold: 0.6 });
    obs.observe(pantalla);
    return () => { obs.disconnect(); timers.forEach(clearTimeout); };
  }, []);

  // Al tocar un campo del panel, el celular baja hasta donde aparece ese dato.
  useEffect(() => {
    const pantalla = pantallaRef.current;
    if (!foco || !pantalla) return;
    const el = pantalla.querySelector(`[data-vc-ancla="${foco}"]`) || pantalla.querySelector(`[data-vc="${foco}"]`);
    if (!el) return;
    const destino = el.getBoundingClientRect().top - pantalla.getBoundingClientRect().top + pantalla.scrollTop - 140;
    pantalla.scrollTo({ top: Math.max(0, destino), behavior: 'smooth' });
  }, [foco]);

  const enfocar = (key) => { tocado.current = true; setFoco(key); };
  const marca = (key) => (foco === key ? ' vc-foco' : '');

  const faltaExtra = campos.some((f) => f.required && !String(reserva.extras[f.key] || '').trim());
  const puedeSeguir = {
    1: reserva.proIdx !== null,
    2: reserva.servicioIdx !== null,
    3: nombreValido(reserva.nombre) && telefonoValido(reserva.telefono) && !faltaExtra,
    4: !!reserva.fecha,
    5: !!reserva.slot,
  }[paso];

  const siguiente = () => { if (puedeSeguir) cambiar({ paso: paso + 1 }); };
  const atras = () => cambiar({ paso: Math.max(1, paso - 1) });

  const contacto = [
    { key: 'telefono', icon: 'phone', label: TELEFONO_DEMO },
    { key: 'instagram', icon: 'instagram', label: `@${demo.instagram}` },
    { key: 'direccion', icon: 'pin', label: 'Cómo llegar' },
  ];

  // ── Calendario (paso 4) ──
  const hoy = toDateString(new Date());
  const ahora = new Date();
  const anio = mes.getFullYear();
  const m = mes.getMonth();
  const offset = (new Date(anio, m, 1).getDay() + 6) % 7;
  const diasDelMes = new Date(anio, m + 1, 0).getDate();
  // Se puede ir del mes actual al siguiente, no más atrás ni más adelante.
  const mesesDesdeHoy = (anio - ahora.getFullYear()) * 12 + (m - ahora.getMonth());
  const dias = [...Array(offset).fill(null), ...Array.from({ length: diasDelMes }, (_, i) => i + 1)];

  return (
    <div className="vitrina">
      {/* ── El panel del dueño (ejemplo fijo: solo cambia el rubro) ── */}
      <div className="vitrina-panel card">
        <div className="vitrina-panel-cabecera">
          <span className="vitrina-panel-kicker"><Icon name="settings" /> Tu panel · Configuración</span>
          <p>Esto es lo que cargás en tu cuenta. Elegí un rubro y probá reservar en el celular.</p>
        </div>

        <div className="form-group">
          <span className="form-label">Rubro <em className="vitrina-donde">Colores e ícono</em></span>
          <div className="vitrina-rubros" role="radiogroup" aria-label="Rubro">
            {RUBROS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={rubro === k}
                className={`vitrina-rubro ${rubro === k ? 'activo' : ''}`}
                style={rubro === k ? { background: PROFESSION_PRESETS[k].theme.primaryColor, borderColor: PROFESSION_PRESETS[k].theme.primaryColor } : undefined}
                onClick={() => elegirRubro(k)}
                onFocus={() => enfocar('rubro')}
                onBlur={() => setFoco(null)}
              >
                <Icon name={PROFESSION_PRESETS[k].icon} /> {DEMOS[k].chip}
              </button>
            ))}
          </div>
        </div>

        {CAMPOS.map((c) => (
          <label key={c.key} className="form-group vitrina-campo">
            <span className="form-label">{c.label} <em className="vitrina-donde">{c.etiqueta}</em></span>
            <span className={`vitrina-input ${c.prefijo ? 'con-prefijo' : ''}`}>
              {c.prefijo && <span className="vitrina-prefijo">{c.prefijo}</span>}
              <input
                className="form-input"
                type="text"
                readOnly
                value={valores[c.key]}
                placeholder={c.key === 'bienvenida' ? terminology.ctaLabel : ''}
                onFocus={() => enfocar(c.key)}
                onBlur={() => setFoco(null)}
              />
            </span>
          </label>
        ))}

        <p className="vitrina-nota">
          <Icon name="check" /> Lo que dejás vacío no aparece: sin Instagram no hay botón de
          Instagram, sin ubicación no hay mapa.
        </p>
      </div>

      {/* ── Lo que ve el cliente: la reserva completa ── */}
      <figure className="vitrina-celu">
        <div className="vc-phone">
          <div className="vc-status"><span>9:41</span><span className="vc-status-isla" /><span>5G</span></div>
          <div className="vc-url">
            <Icon name="lock" size={10} /> {host}/{slugDe(nombre)}{confirmado ? '/confirmacion' : ''}
          </div>

          <div
            className="vc-pantalla"
            ref={pantallaRef}
            style={tema}
            onPointerDown={() => { tocado.current = true; }}
            onWheel={() => { tocado.current = true; }}
          >
            {/* Header.jsx con un negocio activo, ya con la sesión del cliente */}
            <header className="header">
              <span className={`header-logo${marca('nombre')}`}>
                <span className="header-logo-icon"><Icon name={preset.icon} size="18" /></span>
                <span>{nombre}</span>
              </span>
              <div className="header-actions">
                {paso >= 3
                  ? <span className="btn btn-ghost btn-sm"><Icon name="calendar" /> Mis Citas</span>
                  : <span className="btn btn-secondary btn-sm">Iniciar Sesión</span>}
              </div>
            </header>

            {confirmado ? (
              /* ConfirmationPage */
              <div className="confirmation-container">
                <div className="confirmation-icon"><Icon name="check" /></div>
                <h1>¡{capitalize(terminology.appointmentNoun)} {reservadoPara(terminology)}!</h1>
                <p className="text-secondary mt-sm mb-lg">{terminology.confirmationMsg}</p>
                <div className="summary-card" style={{ textAlign: 'left' }}>
                  <div className="summary-body">
                    <div className="summary-row"><span className="summary-label"><Icon name="user" /> Profesional</span><span className="summary-value">{profesional.name}</span></div>
                    <div className="summary-row"><span className="summary-label"><Icon name="clipboard" /> Servicio</span><span className="summary-value">{servicio.name}</span></div>
                    <div className="summary-row"><span className="summary-label"><Icon name="calendar" /> Fecha</span><span className="summary-value">{formatDate(reserva.fecha)}</span></div>
                    <div className="summary-row"><span className="summary-label"><Icon name="clock" /> Horario</span><span className="summary-value">{reserva.slot.startTime} — {reserva.slot.endTime}</span></div>
                    <div className="summary-row"><span className="summary-label"><Icon name="money" /> Precio</span><span className="summary-value">{formatPrice(servicio.price)}</span></div>
                  </div>
                </div>
                <div className="confirmation-actions">
                  <span className="btn btn-primary"><Icon name="calendar" /> Ver Mis Citas</span>
                  <button type="button" className="btn btn-outline" onClick={reiniciar}>Reservar Otra Cita</button>
                </div>
                <p className="text-sm text-muted mt-lg" style={{ textAlign: 'center' }}>
                  <Icon name="mail" /> Te enviamos la confirmación por mail. Si no la ves,
                  revisá la carpeta de spam.
                </p>
              </div>
            ) : (
              <div className={`booking-container ${paso === 6 ? 'has-confirm-bar' : ''}`}>
                {/* BusinessHero: completa en el paso 1, compacta después */}
                <section className={`business-hero ${paso > 1 ? 'compacta' : ''}`}>
                  <div className={`business-hero-band${marca('rubro')}`} aria-hidden="true" />
                  <div className="business-hero-body">
                    <div className="business-hero-photo"><Icon name={preset.icon} size={paso > 1 ? 26 : 40} /></div>
                    <div className="business-hero-text">
                      <h1 className={marca('nombre').trim()} data-vc="nombre">{nombre}</h1>
                      {paso === 1 && (
                        <p className={`business-hero-cta${marca('bienvenida')}`} data-vc="bienvenida">{terminology.ctaLabel}</p>
                      )}
                    </div>
                    <div className="business-hero-contact">
                      {contacto.map((it) => (
                        <span key={it.key} className={`booking-contact-item${marca(it.key)}`} data-vc={it.key}>
                          <Icon name={it.icon} /> {it.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>

                {/* Stepper */}
                <div className="stepper">
                  {PASOS.map((label, idx) => {
                    const num = idx + 1;
                    return (
                      <div key={label} className="stepper-step">
                        {idx > 0 && <div className={`stepper-line ${num <= paso ? 'completed' : ''}`} />}
                        <div>
                          <div className={`stepper-circle ${num === paso ? 'active' : ''} ${num < paso ? 'completed' : ''}`}>
                            {num < paso ? <Icon name="check" /> : num}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {paso === 1 && (
                  <div>
                    <h2 className="booking-step-title">Seleccioná tu profesional</h2>
                    <p className="booking-step-subtitle">Elegí con quién querés atenderte</p>
                    <div className="professionals-grid">
                      {demo.profesionales.map((prof, i) => (
                        <div
                          key={prof.name}
                          className={`card card-selectable professional-card ${reserva.proIdx === i ? 'card-selected' : ''}`}
                          onClick={() => cambiar({ proIdx: i, servicioIdx: null, fecha: null, slot: null })}
                        >
                          <div className="avatar avatar-lg">{iniciales(prof.name)}</div>
                          <h3>{prof.name}</h3>
                          <p className="specialty">{prof.specialty}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {paso === 2 && (
                  <div>
                    <h2 className="booking-step-title">Elegí un servicio</h2>
                    <p className="booking-step-subtitle">Servicios disponibles</p>
                    <div className="services-list">
                      {servicios.map((s, i) => (
                        <div
                          key={s.name}
                          className={`card card-selectable service-card ${reserva.servicioIdx === i ? 'card-selected' : ''}`}
                          onClick={() => cambiar({ servicioIdx: i, fecha: null, slot: null })}
                        >
                          <div className="service-info"><h3>{s.name}</h3></div>
                          <div className="service-meta">
                            <div className="service-price">{formatPrice(s.price)}</div>
                            <div className="service-duration"><Icon name="clock" /> {s.durationMinutes} min</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {paso === 3 && (
                  <div>
                    <h2 className="booking-step-title">Tus datos</h2>
                    <p className="booking-step-subtitle">Necesitamos tu nombre y tu móvil para confirmar la reserva</p>
                    <div className="card" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)' }}>
                      <div className="avatar avatar-md">{iniciales(CLIENTE_DEMO.nombre)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{CLIENTE_DEMO.nombre}</div>
                        <div className="text-sm text-secondary" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{CLIENTE_DEMO.email}</div>
                      </div>
                      <span className="badge badge-success"><Icon name="check" /> Verificado</span>
                    </div>
                    <div className="personal-form">
                      <div className="form-group">
                        <label className="form-label">Nombre <span className="required">*</span></label>
                        <input
                          className="form-input"
                          type="text"
                          value={reserva.nombre}
                          maxLength={60}
                          onChange={(e) => cambiar({ nombre: e.target.value })}
                          placeholder="Nombre y apellido"
                          style={!nombreValido(reserva.nombre) ? { borderColor: 'var(--danger)' } : undefined}
                        />
                        {!nombreValido(reserva.nombre) && (
                          <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>Ingresá el nombre de quien va a atenderse.</p>
                        )}
                      </div>
                      <div className="form-group">
                        <label className="form-label">Teléfono móvil <span className="required">*</span></label>
                        <input
                          className="form-input"
                          type="tel"
                          inputMode="tel"
                          value={reserva.telefono}
                          maxLength={20}
                          onChange={(e) => cambiar({ telefono: e.target.value })}
                          placeholder="+54 11 1234-5678"
                          style={!telefonoValido(reserva.telefono) ? { borderColor: 'var(--danger)' } : undefined}
                        />
                        {!telefonoValido(reserva.telefono) && (
                          <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>Ingresá el número con código de área, por ejemplo 11 1234-5678.</p>
                        )}
                        <p className="text-xs text-muted" style={{ marginTop: 4 }}>Es por donde te va a contactar el negocio si hace falta.</p>
                      </div>
                      {campos.map((f) => (
                        <div className="form-group" key={f.key}>
                          <label className="form-label">{f.label} {f.required && <span className="required">*</span>}</label>
                          <input
                            className="form-input"
                            type="text"
                            value={reserva.extras[f.key] || ''}
                            maxLength={150}
                            onChange={(e) => cambiar({ extras: { ...reserva.extras, [f.key]: e.target.value } })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {paso === 4 && (
                  <div>
                    <h2 className="booking-step-title">Elegí una fecha</h2>
                    <p className="booking-step-subtitle">Seleccioná el día de tu cita</p>
                    <div className="calendar">
                      <div className="calendar-header">
                        <button type="button" className="calendar-nav" disabled={mesesDesdeHoy <= 0} onClick={() => setMes(new Date(anio, m - 1, 1))} aria-label="Mes anterior">◀</button>
                        <h3>{getMonthName(m)} {anio}</h3>
                        <button type="button" className="calendar-nav" disabled={mesesDesdeHoy >= 1} onClick={() => setMes(new Date(anio, m + 1, 1))} aria-label="Mes siguiente">▶</button>
                      </div>
                      <div className="calendar-grid">
                        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                          <div key={d} className="calendar-day-header">{d}</div>
                        ))}
                        {dias.map((dia, idx) => {
                          if (dia === null) return <div key={`vacio-${idx}`} className="calendar-day empty" />;
                          const fecha = `${anio}-${String(m + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
                          // Domingo: el profesional de ejemplo no trabaja.
                          const trabaja = new Date(anio, m, dia).getDay() !== 0;
                          const sinHorarios = horariosDelDia(fecha, servicio.durationMinutes).length === 0;
                          return (
                            <button
                              key={fecha}
                              type="button"
                              className={`calendar-day ${fecha === reserva.fecha ? 'selected' : ''} ${fecha === hoy ? 'today' : ''}`}
                              disabled={fecha < hoy || !trabaja || sinHorarios}
                              onClick={() => cambiar({ fecha, slot: null })}
                            >
                              {dia}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {paso === 5 && (() => {
                  const slots = horariosDelDia(reserva.fecha, servicio.durationMinutes);
                  const franja = (lista) => lista.map((s) => (
                    <button
                      key={s.startTime}
                      type="button"
                      className={`timeslot ${reserva.slot?.startTime === s.startTime ? 'selected' : ''}`}
                      onClick={() => cambiar({ slot: s })}
                    >
                      {s.startTime}
                    </button>
                  ));
                  const manana = slots.filter((s) => aMin(s.startTime) < 13 * 60);
                  const tarde = slots.filter((s) => aMin(s.startTime) >= 13 * 60);
                  return (
                    <div>
                      <h2 className="booking-step-title">Elegí un horario</h2>
                      <p className="booking-step-subtitle">{formatDate(reserva.fecha)}</p>
                      <div className="timeslots-container">
                        {manana.length > 0 && (
                          <div className="timeslots-section"><h3>Mañana</h3><div className="timeslots-grid">{franja(manana)}</div></div>
                        )}
                        {tarde.length > 0 && (
                          <div className="timeslots-section"><h3>Tarde</h3><div className="timeslots-grid">{franja(tarde)}</div></div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {paso === 6 && (
                  <div>
                    <h2 className="booking-step-title">Confirmar tu {terminology.appointmentNoun}</h2>
                    <p className="booking-step-subtitle">Revisá los datos antes de confirmar</p>
                    <div className="booking-summary">
                      <div className="summary-card">
                        <div className="summary-header">
                          <div className="avatar avatar-lg" style={{ margin: '0 auto var(--space-sm)' }}>{iniciales(profesional.name)}</div>
                          <h3>{profesional.name}</h3>
                          <p className="text-sm" style={{ opacity: 0.8 }}>{profesional.specialty}</p>
                        </div>
                        <div className="summary-body">
                          <div className="summary-row"><span className="summary-label"><Icon name="clipboard" /> Servicio</span><span className="summary-value">{servicio.name}</span></div>
                          <div className="summary-row"><span className="summary-label"><Icon name="calendar" /> Fecha</span><span className="summary-value">{formatDate(reserva.fecha)}</span></div>
                          <div className="summary-row"><span className="summary-label"><Icon name="clock" /> Horario</span><span className="summary-value">{reserva.slot.startTime} — {reserva.slot.endTime}</span></div>
                          <div className="summary-row"><span className="summary-label"><Icon name="money" /> Total</span><span className="summary-value">{formatPrice(servicio.price)}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {paso < 6 && (
                  <div className="booking-nav">
                    {paso > 1
                      ? <button type="button" className="btn btn-outline" onClick={atras}>← Atrás</button>
                      : <div />}
                    <button type="button" className="btn btn-primary" disabled={paso !== 3 && !puedeSeguir} onClick={siguiente}>
                      Siguiente →
                    </button>
                  </div>
                )}

                {/* BusinessMap: debajo del "Siguiente", solo en el paso 1 */}
                {paso === 1 && (
                  <section className={`business-map${marca('direccion')}`} data-vc-ancla="direccion">
                    <div className="business-map-frame">
                      <iframe
                        title={`Mapa de ${nombre}`}
                        src={`https://maps.google.com/maps?q=${encodeURIComponent(demo.direccion)}&z=16&output=embed`}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        tabIndex={-1}
                      />
                      <span className="business-map-overlay">
                        <span className="business-map-chip"><Icon name="navigation" /> Ver en Google Maps</span>
                      </span>
                    </div>
                    <div className="business-map-footer">
                      <span className="business-map-pin"><Icon name="pin" /></span>
                      <div className="business-map-text">
                        <span className="business-map-label">Dónde estamos</span>
                        <span className="business-map-address">{demo.direccion}</span>
                      </div>
                      <span className="business-map-copy"><Icon name="copy" /><span>Copiar</span></span>
                      <span className="btn btn-primary btn-sm business-map-go"><Icon name="navigation" /> Cómo llegar</span>
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* Barra de confirmar: afuera del contenedor para que ocupe todo el
                ancho, como la fija de la página real. */}
            {paso === 6 && (
              <div className="confirm-bar">
                <div className="confirm-bar-inner confirm-bar-actions">
                  <button type="button" className="btn btn-outline btn-lg" onClick={atras}>← Atrás</button>
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => cambiar({ paso: 7 })}>
                    <Icon name="check-circle" /> Confirmar Reserva
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <figcaption>
          {confirmado
            ? 'Así termina tu cliente. Al negocio le llega el aviso y a él, el mail.'
            : 'Probalo: elegí profesional, servicio, día y horario, y confirmá.'}
        </figcaption>
      </figure>
    </div>
  );
}
