import { useEffect, useMemo, useRef, useState } from 'react';
import { PROFESSION_PRESETS } from '../../config/professionPresets';
import Icon from '../Icon';

// ============================================================================
// "Así se vería tu comercio" — vitrina de la landing
// ============================================================================
// A la izquierda, los mismos campos que el dueño completa en Configuración
// (nombre, mensaje de bienvenida, teléfono, Instagram, ubicación). A la
// derecha, un celular con la página de reserva REAL que abre su cliente:
// mismas clases de CSS que BookingPage (business-hero, stepper,
// professionals-grid, business-map...) y las mismas reglas de qué se muestra
// — sin Instagram no hay botón de Instagram, sin ubicación no hay mapa, sin
// mensaje de bienvenida va la frase del rubro. El mapa es el embed de Google
// Maps de verdad, igual que en la página del negocio.
//
// Si cambia el markup de BusinessHero / BusinessMap / Stepper en
// BookingPage.jsx, actualizar la copia de acá para que la vitrina no mienta.
// ============================================================================

const DEMOS = {
  beauty: {
    chip: 'Barbería',
    nombre: 'Barbería El Corte',
    instagram: 'barberia.elcorte',
    direccion: 'Av. Corrientes 1850, CABA',
    profesionales: [{ name: 'Mateo Díaz', specialty: 'Barbero' }, { name: 'Lucas Ruiz', specialty: 'Colorista' }],
  },
  healthcare: {
    chip: 'Consultorio',
    nombre: 'Consultorio Dra. Paz',
    instagram: 'odontologia.paz',
    direccion: 'Av. Santa Fe 2450, CABA',
    profesionales: [{ name: 'Ana Paz', specialty: 'Odontóloga' }, { name: 'Diego Ibáñez', specialty: 'Ortodoncista' }],
  },
  wellness: {
    chip: 'Bienestar',
    nombre: 'Espacio Raíz',
    instagram: 'espacio.raiz',
    direccion: 'Gorriti 4800, CABA',
    profesionales: [{ name: 'Sol Medina', specialty: 'Masajista' }, { name: 'Camila Sosa', specialty: 'Psicóloga' }],
  },
  automotive: {
    chip: 'Taller',
    nombre: 'Taller Don Julio',
    instagram: 'taller.donjulio',
    direccion: 'Av. Warnes 1200, CABA',
    profesionales: [{ name: 'Julio Pérez', specialty: 'Mecánico' }, { name: 'Nico Vera', specialty: 'Electricidad' }],
  },
  education: {
    chip: 'Clases',
    nombre: 'Estudio Pilates Sur',
    instagram: 'pilates.sur',
    direccion: 'Defensa 900, CABA',
    profesionales: [{ name: 'Flor Gómez', specialty: 'Instructora' }, { name: 'Agus Luna', specialty: 'Instructor' }],
  },
  pet_services: {
    chip: 'Veterinaria',
    nombre: 'Veterinaria Patitas',
    instagram: 'vet.patitas',
    direccion: 'Av. Rivadavia 5000, CABA',
    profesionales: [{ name: 'Laura Vega', specialty: 'Veterinaria' }, { name: 'Martín Paz', specialty: 'Peluquero canino' }],
  },
  professional_services: {
    chip: 'Estudio',
    nombre: 'Estudio Contable Ríos',
    instagram: 'estudio.rios',
    direccion: 'Tucumán 600, CABA',
    profesionales: [{ name: 'Laura Ríos', specialty: 'Contadora' }, { name: 'Pablo Ferro', specialty: 'Sueldos' }],
  },
};

const RUBROS = Object.keys(DEMOS).filter((k) => PROFESSION_PRESETS[k]);

const TELEFONO_DEMO = '11 4567-8910';

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

/** El mapa se recarga recién cuando se deja de escribir, no con cada letra. */
function useDemorado(valor, ms) {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}

// Campos del "panel". `etiqueta` dice dónde aparece en la página del cliente.
const CAMPOS = [
  { key: 'nombre', label: 'Nombre del negocio', etiqueta: 'Cabecera' },
  { key: 'bienvenida', label: 'Mensaje de bienvenida', etiqueta: 'Debajo del nombre' },
  { key: 'telefono', label: 'Teléfono', etiqueta: 'Botón para llamar', type: 'tel' },
  { key: 'instagram', label: 'Instagram', etiqueta: 'Botón a tu perfil', prefijo: '@' },
  { key: 'direccion', label: 'Ubicación en Google Maps', etiqueta: 'Mapa + Cómo llegar' },
];

export default function VitrinaComercio() {
  const [rubro, setRubro] = useState('beauty');
  // null = "todavía no lo tocó": se muestra el dato de ejemplo del rubro.
  // '' = lo borró a propósito: se muestra la página como queda sin ese dato.
  const [datos, setDatos] = useState({ nombre: null, bienvenida: null, telefono: null, instagram: null, direccion: null });
  const [foco, setFoco] = useState(null);
  const pantallaRef = useRef(null);

  const preset = PROFESSION_PRESETS[rubro];
  const demo = DEMOS[rubro];

  const valores = {
    nombre: datos.nombre ?? demo.nombre,
    bienvenida: datos.bienvenida ?? '',
    telefono: datos.telefono ?? TELEFONO_DEMO,
    instagram: datos.instagram ?? demo.instagram,
    direccion: datos.direccion ?? demo.direccion,
  };

  const nombre = valores.nombre.trim() || demo.nombre;
  const handle = valores.instagram.trim().replace(/^@/, '');
  const telefono = valores.telefono.trim();
  const direccion = valores.direccion.trim();
  const direccionMapa = useDemorado(direccion, 700);
  const host = typeof window !== 'undefined' ? window.location.host : 'slotly-turnos.vercel.app';

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

  // Al tocar un campo, el celular baja solo hasta donde aparece ese dato.
  useEffect(() => {
    const pantalla = pantallaRef.current;
    if (!foco || !pantalla) return;
    const el = pantalla.querySelector(`[data-vc-ancla="${foco}"]`) || pantalla.querySelector(`[data-vc="${foco}"]`);
    if (!el) return;
    const destino = el.getBoundingClientRect().top - pantalla.getBoundingClientRect().top + pantalla.scrollTop - 140;
    pantalla.scrollTo({ top: Math.max(0, destino), behavior: 'smooth' });
  }, [foco]);

  // Recorrido de una sola vez: cuando la vitrina entra en pantalla, el
  // celular baja hasta el mapa y vuelve arriba — el mapa queda debajo de los
  // profesionales (igual que en la página real) y si no, nadie lo ve. Se
  // cancela apenas la persona toca el celular o un campo.
  const tocado = useRef(false);
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

  const marca = (key) => (foco === key ? ' vc-foco' : '');
  const editar = (key, valor) => setDatos((d) => ({ ...d, [key]: valor }));
  const enfocar = (key) => { tocado.current = true; setFoco(key); };

  const contacto = [];
  if (telefono) contacto.push({ key: 'telefono', icon: 'phone', label: telefono });
  if (handle) contacto.push({ key: 'instagram', icon: 'instagram', label: `@${handle}` });
  if (direccion) contacto.push({ key: 'direccion', icon: 'pin', label: 'Cómo llegar' });

  return (
    <div className="vitrina">
      {/* ── El panel del dueño ── */}
      <div className="vitrina-panel card">
        <div className="vitrina-panel-cabecera">
          <span className="vitrina-panel-kicker"><Icon name="settings" /> Tu panel · Configuración</span>
          <p>Completalo como lo harías en tu cuenta. El celular muestra la página que abre tu cliente.</p>
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
                onClick={() => setRubro(k)}
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
                type={c.type || 'text'}
                maxLength={c.key === 'bienvenida' ? 90 : 60}
                value={c.key === 'instagram' ? valores.instagram.replace(/^@/, '') : valores[c.key]}
                placeholder={c.key === 'bienvenida' ? preset.terminology.ctaLabel : c.key === 'direccion' ? 'Calle, número y ciudad' : ''}
                onChange={(e) => editar(c.key, e.target.value)}
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

      {/* ── Lo que ve el cliente ── */}
      <figure className="vitrina-celu">
        <div className="vc-phone">
          <div className="vc-status"><span>9:41</span><span className="vc-status-isla" /><span>5G</span></div>
          <div className="vc-url"><Icon name="lock" size={10} /> {host}/{slugDe(nombre)}</div>

          <div
            className="vc-pantalla"
            ref={pantallaRef}
            style={tema}
            onPointerDown={() => { tocado.current = true; }}
            onWheel={() => { tocado.current = true; }}
          >
            {/* Header.jsx con un negocio activo */}
            <header className="header">
              <span className={`header-logo${marca('nombre')}`}>
                <span className="header-logo-icon"><Icon name={preset.icon} size="18" /></span>
                <span>{nombre}</span>
              </span>
              <div className="header-actions">
                <span className="btn btn-secondary btn-sm">Iniciar Sesión</span>
              </div>
            </header>

            <div className="booking-container">
              {/* BusinessHero (paso 1, completa) */}
              <section className="business-hero">
                <div className={`business-hero-band${marca('rubro')}`} aria-hidden="true" />
                <div className="business-hero-body">
                  <div className="business-hero-photo"><Icon name={preset.icon} size={40} /></div>
                  <div className="business-hero-text">
                    <h1 className={marca('nombre').trim()} data-vc="nombre">{nombre}</h1>
                    <p className={`business-hero-cta${marca('bienvenida')}`} data-vc="bienvenida">
                      {valores.bienvenida.trim() || preset.terminology.ctaLabel}
                    </p>
                  </div>
                  {contacto.length > 0 && (
                    <div className="business-hero-contact">
                      {contacto.map((it) => (
                        <span key={it.key} className={`booking-contact-item${marca(it.key)}`} data-vc={it.key}>
                          <Icon name={it.icon} /> {it.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Stepper, paso 1 */}
              <div className="stepper">
                {['Profesional', 'Servicio', 'Datos', 'Fecha', 'Horario', 'Confirmar'].map((label, idx) => (
                  <div key={label} className="stepper-step">
                    {idx > 0 && <div className="stepper-line" />}
                    <div><div className={`stepper-circle ${idx === 0 ? 'active' : ''}`}>{idx + 1}</div></div>
                  </div>
                ))}
              </div>

              {/* ProfessionalSelect */}
              <h2 className="booking-step-title">Seleccioná tu profesional</h2>
              <p className="booking-step-subtitle">Elegí con quién querés atenderte</p>
              <div className="professionals-grid">
                {demo.profesionales.map((prof, i) => (
                  <div key={prof.name} className={`card card-selectable professional-card ${i === 0 ? 'card-selected' : ''}`}>
                    <div className="avatar avatar-lg">{iniciales(prof.name)}</div>
                    <h3>{prof.name}</h3>
                    <p className="specialty">{prof.specialty}</p>
                  </div>
                ))}
              </div>

              <div className="booking-nav">
                <div />
                <span className="btn btn-primary">Siguiente →</span>
              </div>

              {/* BusinessMap: solo si el negocio cargó su ubicación */}
              {direccion && (
                <section className={`business-map${marca('direccion')}`} data-vc-ancla="direccion">
                  <div className="business-map-frame">
                    {direccionMapa && (
                      <iframe
                        title={`Mapa de ${nombre}`}
                        src={`https://maps.google.com/maps?q=${encodeURIComponent(direccionMapa)}&z=16&output=embed`}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        tabIndex={-1}
                      />
                    )}
                    <span className="business-map-overlay">
                      <span className="business-map-chip"><Icon name="navigation" /> Ver en Google Maps</span>
                    </span>
                  </div>
                  <div className="business-map-footer">
                    <span className="business-map-pin"><Icon name="pin" /></span>
                    <div className="business-map-text">
                      <span className="business-map-label">Dónde estamos</span>
                      <span className="business-map-address">{direccion}</span>
                    </div>
                    <span className="business-map-copy"><Icon name="copy" /><span>Copiar</span></span>
                    <span className="btn btn-primary btn-sm business-map-go"><Icon name="navigation" /> Cómo llegar</span>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
        <figcaption>Así lo ve tu cliente. Deslizá dentro del celular para ver el mapa.</figcaption>
      </figure>
    </div>
  );
}
