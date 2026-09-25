import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from '../../contexts/BookingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment, getBusySlots, resolveMapsLink } from '../../lib/functions';
import { calculateAvailableSlots, professionalWorksOnDate } from '../../utils/availabilityEngine';
import { promoParaSlot, precioConPromo } from '../../utils/promoEngine';
import { formatDate, formatPrice, toDateString, getMonthName, getLocalDayOfWeek } from '../../utils/dateUtils';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import Icon from '../../components/Icon';
import { esDiaEntero, rangosComoOcupados } from '../../utils/bloqueos';

// ---- STEPPER ----
function Stepper({ step }) {
  const labels = ['Profesional', 'Servicio', 'Datos', 'Fecha', 'Horario', 'Confirmar'];
  return (
    <div className="stepper">
      {labels.map((label, idx) => {
        const num = idx + 1;
        const completed = num < step;
        const active = num === step;
        return (
          <div key={num} className="stepper-step">
            {idx > 0 && <div className={`stepper-line ${completed ? 'completed' : ''}`} />}
            <div>
              <div className={`stepper-circle ${active ? 'active' : ''} ${completed ? 'completed' : ''}`}>
                {completed ? <Icon name="check" /> : num}
              </div>
              <div className={`stepper-label ${active ? 'active' : ''}`}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Link para "Cómo llegar" y el mapa: SOLO el que cargó el negocio. Sin link
 * de Maps no se muestra nada de ubicación — ni mapa ni botón —, en vez de
 * adivinar el lugar buscando por el texto de la dirección.
 */
function linkComoLlegar(business) {
  return business.mapsUrl?.trim() || null;
}

// ---- CABECERA DEL NEGOCIO (foto, nombre, colores, contacto) ----
// Es la cara del negocio en su propio link: para el cliente tiene que sentirse
// la agenda de ESE negocio, no la de Slotly. Se ve en todos los pasos — en el
// primero completa (con el mensaje de bienvenida), en los demás compacta para
// no empujar hacia abajo lo que el cliente está eligiendo.
function BusinessHero({ business, compacta }) {
  const { icon: rubroIcon, terminology } = useBusinessContext();

  const contacto = [];
  if (business.phone) {
    contacto.push({ key: 'phone', icon: 'phone', label: business.phone, href: `tel:${business.phone.replace(/[^+\d]/g, '')}` });
  }
  const handle = business.socialLinks?.instagram?.trim().replace(/^@/, '');
  if (handle) {
    contacto.push({ key: 'ig', icon: 'instagram', label: `@${handle}`, href: `https://instagram.com/${handle}` });
  }
  const comoLlegar = linkComoLlegar(business);
  if (comoLlegar) {
    contacto.push({ key: 'maps', icon: 'pin', label: 'Cómo llegar', href: comoLlegar });
  }

  return (
    <section className={`business-hero ${compacta ? 'compacta' : ''}`}>
      <div className="business-hero-band" aria-hidden="true" />
      <div className="business-hero-body">
        <div className="business-hero-photo">
          {business.logoUrl
            ? <img src={business.logoUrl} alt={business.name} />
            : <Icon name={rubroIcon} size={compacta ? 26 : 40} />}
        </div>
        <div className="business-hero-text">
          <h1>{business.name}</h1>
          {!compacta && (
            <p className="business-hero-cta">
              {business.welcomeMessage?.trim() || terminology.ctaLabel}
            </p>
          )}
        </div>
        {contacto.length > 0 && (
          <div className="business-hero-contact">
            {contacto.map((it) => (
              <a key={it.key} href={it.href} target="_blank" rel="noreferrer" className="booking-contact-item">
                <Icon name={it.icon} /> {it.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Coordenadas escritas directo en un link largo de Maps (`!3d..!4d..` o `@lat,lng`). */
function coordsDelLink(url) {
  const texto = (() => { try { return decodeURIComponent(url || ''); } catch { return url || ''; } })();
  const m = texto.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || texto.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? `${m[1]},${m[2]}` : null;
}

/**
 * Dónde centrar el mapa: el lugar REAL del link que cargó el dueño. Si el
 * link es largo, las coordenadas salen de él mismo; si es corto
 * (maps.app.goo.gl/...), las resuelve el servidor (resolve-maps-link),
 * porque el navegador no puede seguir esa redirección. Mientras resuelve, no
 * se pinta nada (sin mapa "de mentira" que después salta). Solo si el
 * link no se pudo resolver, se busca por el texto de la dirección.
 */
function useUbicacionDelMapa(business) {
  const link = business.mapsUrl?.trim() || '';
  const directas = coordsDelLink(link);
  const hayQueResolver = Boolean(link) && !directas;
  const [resuelta, setResuelta] = useState({ link: '', coords: null });

  useEffect(() => {
    if (!hayQueResolver) return;
    let vigente = true;
    resolveMapsLink({ businessId: business.id })
      .then(({ ubicacion: u }) => {
        if (!vigente) return;
        // Coordenadas, o (links viejos de "compartir") el lugar por nombre
        // tal como lo puso Google + su id `ftid`.
        const coords = u?.lat != null ? `${u.lat},${u.lng}` : u?.query || null;
        setResuelta({ link, coords, ftid: u?.ftid || null });
      })
      .catch((err) => {
        console.error('[BookingPage] No se pudo resolver el link de Maps:', err);
        if (vigente) setResuelta({ link, coords: null });
      });
    return () => { vigente = false; };
  }, [hayQueResolver, link, business.id]);

  const direccion = business.address?.trim() || null;
  if (directas) return { consulta: directas, cargando: false };
  if (hayQueResolver && resuelta.link !== link) return { consulta: null, cargando: true };
  if (resuelta.coords) return { consulta: resuelta.coords, ftid: resuelta.ftid, cargando: false };
  return { consulta: direccion, cargando: false };
}

// ---- MAPA ----
// Vista previa del mapa (embed de Google Maps, sin API key) centrada en la
// ubicación real del negocio, que abre su link al tocarla, más la dirección
// como texto plano: se puede seleccionar o copiar con el botón, pero no lleva
// a ningún lado — para eso está "Cómo llegar". Sin link de Maps cargado, no
// se muestra nada (ver linkComoLlegar).
function BusinessMap({ business }) {
  const [copiado, setCopiado] = useState(false);
  const { consulta, ftid, cargando } = useUbicacionDelMapa(business);
  const comoLlegar = linkComoLlegar(business);
  if (!comoLlegar || (!consulta && !cargando)) return null;
  const dir = business.address?.trim();

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(dir);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin permiso de portapapeles: igual se puede seleccionar a mano */ }
  };

  return (
    <section className="business-map">
      <div className="business-map-frame">
        {consulta && (
          <iframe
            title={`Mapa de ${business.name}`}
            src={`https://maps.google.com/maps?q=${encodeURIComponent(consulta)}${ftid ? `&ftid=${encodeURIComponent(ftid)}` : ''}&z=16&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            tabIndex={-1}
          />
        )}
        {/* Capa encima del iframe: el toque abre el link del negocio, no el
            buscador de Google con la dirección tipeada. */}
        <a
          href={comoLlegar}
          target="_blank"
          rel="noreferrer"
          className="business-map-overlay"
          aria-label={`Abrir la ubicación de ${business.name} en Google Maps`}
        >
          <span className="business-map-chip"><Icon name="navigation" /> Ver en Google Maps</span>
        </a>
      </div>

      <div className="business-map-footer">
        <span className="business-map-pin"><Icon name="pin" /></span>
        <div className="business-map-text">
          <span className="business-map-label">Dónde estamos</span>
          {dir && <span className="business-map-address">{dir}</span>}
        </div>
        {dir && (
          <button type="button" className="business-map-copy" onClick={copiar} title="Copiar dirección">
            <Icon name={copiado ? 'check' : 'copy'} />
            <span>{copiado ? 'Copiada' : 'Copiar'}</span>
          </button>
        )}
        <a href={comoLlegar} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm business-map-go">
          <Icon name="navigation" /> Cómo llegar
        </a>
      </div>
    </section>
  );
}

// ---- PROFESSIONAL SELECT ----
function ProfessionalSelect({ professionals, selectedId, onSelect }) {
  return (
    <div>
      <h2 className="booking-step-title">Seleccioná tu profesional</h2>
      <p className="booking-step-subtitle">Elegí con quién querés atenderte</p>
      <div className="professionals-grid">
        {professionals.filter(p => p.isActive).map((prof) => (
          <div
            key={prof.id}
            className={`card card-selectable professional-card ${selectedId === prof.id ? 'card-selected' : ''}`}
            onClick={() => onSelect(prof.id)}
          >
            <div className="avatar avatar-lg">
              {prof.avatarUrl ? <img src={prof.avatarUrl} alt={prof.name} /> : prof.name.split(' ').map(n => n[0]).join('')}
            </div>
            <h3>{prof.name}</h3>
            <p className="specialty">{prof.specialty}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- SERVICE SELECT ----
function ServiceSelect({ services, professionalServices, professionalId, selectedId, onSelect, currency, promotions }) {
  const available = useMemo(() => {
    const psIds = professionalServices
      .filter(ps => ps.professionalId === professionalId)
      .map(ps => ps.serviceId);
    return services.filter(s => s.isActive && psIds.includes(s.id)).map(s => {
      const ps = professionalServices.find(p => p.professionalId === professionalId && p.serviceId === s.id);
      return { ...s, finalPrice: ps?.customPrice || s.price, finalDuration: ps?.customDuration || s.durationMinutes };
    });
  }, [services, professionalServices, professionalId]);

  // Todavía no se eligió fecha ni hora acá: solo se puede avisar que ESTE
  // servicio tiene alguna promo cargada, no si aplica al horario que elija
  // después — eso se ve recién en el paso de horario.
  const tienePromo = (serviceId) => promotions.some((p) => p.serviceId === serviceId && p.isActive !== false);

  return (
    <div>
      <h2 className="booking-step-title">Elegí un servicio</h2>
      <p className="booking-step-subtitle">Servicios disponibles</p>
      <div className="services-list">
        {available.map((service) => (
          <div
            key={service.id}
            className={`card card-selectable service-card ${selectedId === service.id ? 'card-selected' : ''}`}
            onClick={() => onSelect(service.id)}
          >
            <div className="service-info">
              <h3>
                {service.name}
                {tienePromo(service.id) && <span className="badge badge-warning service-promo-badge"><Icon name="tag" /> Promo</span>}
              </h3>
              <p>{service.description}</p>
            </div>
            <div className="service-meta">
              <div className="service-price">{formatPrice(service.finalPrice, currency)}</div>
              <div className="service-duration"><Icon name="clock" /> {service.finalDuration} min</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- DATE PICKER ----
/**
 * Último día que se puede reservar según la ventana del negocio
 * (`maxAdvanceDays`), o null si no tiene límite. Mismo cálculo que el trigger
 * enforce_max_advance_days de la base: hoy + N días, inclusive.
 */
function ultimoDiaReservable(maxAdvanceDays) {
  const n = Number(maxAdvanceDays);
  if (!n) return null;
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toDateString(d);
}

function DatePicker({ selectedDate, onSelect, professionalId, schedules: allSchedules, businessHours, maxAdvanceDays, blockedDays = [] }) {
  // Días que el negocio bloqueó ENTEROS (feriados, vacaciones). Los que solo
  // tienen un rango bloqueado se ofrecen igual: esas horas las saca la grilla.
  const bloqueados = new Set(blockedDays.filter(esDiaEntero).map((b) => b.date));
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDate) return new Date(selectedDate + 'T00:00:00');
    return new Date();
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const today = toDateString(new Date());
  const now = new Date();
  // No se puede retroceder de este mes: es el mes en el que se abrió el
  // picker (o el de la fecha ya elegida), nunca uno anterior al actual.
  const enMesMasTemprano = year === now.getFullYear() && month === now.getMonth();
  // Ventana de reserva: ni días ni meses más allá del último reservable.
  const hasta = ultimoDiaReservable(maxAdvanceDays);
  const ultimoDelMes = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;
  const enMesMasLejano = hasta !== null && ultimoDelMes >= hasta;

  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);

  const prevMonth = () => {
    if (enMesMasTemprano) return;
    setViewDate(new Date(year, month - 1, 1));
  };
  const nextMonth = () => {
    if (enMesMasLejano) return;
    setViewDate(new Date(year, month + 1, 1));
  };

  return (
    <div>
      <h2 className="booking-step-title">Elegí una fecha</h2>
      <p className="booking-step-subtitle">Seleccioná el día de tu cita</p>
      <div className="calendar">
        <div className="calendar-header">
          <button className="calendar-nav" onClick={prevMonth} disabled={enMesMasTemprano} aria-label="Mes anterior">◀</button>
          <h3>{getMonthName(month)} {year}</h3>
          <button className="calendar-nav" onClick={nextMonth} disabled={enMesMasLejano} aria-label="Mes siguiente">▶</button>
        </div>
        <div className="calendar-grid">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
            <div key={d} className="calendar-day-header">{d}</div>
          ))}
          {days.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="calendar-day empty" />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPastDate = dateStr < today || (hasta !== null && dateStr > hasta);
            const works = professionalWorksOnDate(professionalId, dateStr, allSchedules, businessHours) && !bloqueados.has(dateStr);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === today;

            return (
              <button
                key={dateStr}
                className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                disabled={isPastDate || !works}
                onClick={() => onSelect(dateStr)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
      {hasta && (
        <p className="text-sm text-muted" style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
          <Icon name="calendar" /> Por ahora se puede reservar hasta el {formatDate(hasta)}.
        </p>
      )}
    </div>
  );
}

// ---- TIME SLOT GRID ----
function TimeSlotGrid({ slots, selectedSlot, onSelect, date, cargando, serviceId, dayOfWeek, promotions }) {
  const morning = slots.filter(s => parseInt(s.startTime.split(':')[0]) < 13);
  const afternoon = slots.filter(s => parseInt(s.startTime.split(':')[0]) >= 13);
  const esPromo = (slot) => Boolean(promoParaSlot(promotions, { serviceId, dayOfWeek, startTime: slot.startTime }));

  if (cargando) {
    return (
      <div>
        <h2 className="booking-step-title">Horarios disponibles</h2>
        <p className="booking-step-subtitle">{formatDate(date)}</p>
        <div className="empty-state">
          <p>Buscando horarios libres…</p>
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div>
        <h2 className="booking-step-title">Horarios disponibles</h2>
        <p className="booking-step-subtitle">{formatDate(date)}</p>
        <div className="empty-state">
          <div className="empty-state-icon"><Icon name="calendar" /></div>
          <p>No hay horarios disponibles para este día</p>
          <p className="text-sm text-muted mt-sm">Probá seleccionando otra fecha</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="booking-step-title">Elegí un horario</h2>
      <p className="booking-step-subtitle">{formatDate(date)}</p>
      <div className="timeslots-container">
        {morning.length > 0 && (
          <div className="timeslots-section">
            <h3>Mañana</h3>
            <div className="timeslots-grid">
              {morning.map(slot => (
                <button
                  key={slot.startTime}
                  className={`timeslot ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''} ${esPromo(slot) ? 'timeslot-promo' : ''}`}
                  onClick={() => onSelect(slot)}
                >
                  {slot.startTime}
                  {esPromo(slot) && <Icon name="tag" className="timeslot-promo-icon" />}
                </button>
              ))}
            </div>
          </div>
        )}
        {afternoon.length > 0 && (
          <div className="timeslots-section">
            <h3>Tarde</h3>
            <div className="timeslots-grid">
              {afternoon.map(slot => (
                <button
                  key={slot.startTime}
                  className={`timeslot ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''} ${esPromo(slot) ? 'timeslot-promo' : ''}`}
                  onClick={() => onSelect(slot)}
                >
                  {slot.startTime}
                  {esPromo(slot) && <Icon name="tag" className="timeslot-promo-icon" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- PERSONAL INFO ----

/**
 * ¿Parece un teléfono? Se cuentan solo los dígitos: "+54 9 11 1234-5678" y
 * "1123456789" son los dos válidos. Entre 10 y 13 cubre un número argentino
 * con o sin código de país. La function lo vuelve a validar del lado del
 * servidor; esto es para que el error se vea antes de mandar.
 */
function telefonoValido(tel) {
  const digitos = String(tel || '').replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 13;
}

function nombreValido(nombre) {
  return String(nombre || '').trim().length >= 2;
}

function PersonalInfoStep({ user, name, phone, onNameChange, onPhoneChange, customFields, customFieldValues, onCustomFieldChange }) {
  const nombreTocado = name.length > 0;
  const nombreOk = nombreValido(name);
  const tocado = phone.length > 0;
  const valido = telefonoValido(phone);
  return (
    <div>
      <h2 className="booking-step-title">Tus datos</h2>
      <p className="booking-step-subtitle">Necesitamos tu nombre y tu móvil para confirmar la reserva</p>

      <div className="card" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)' }}>
        {user.avatarUrl
          ? <img src={user.avatarUrl} alt={user.name} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
          : <div className="avatar avatar-md">{user.name.split(' ').map(n => n[0]).join('')}</div>
        }
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{user.name}</div>
          <div className="text-sm text-secondary">{user.email}</div>
        </div>
        <span className="badge badge-success"><Icon name="check" /> Verificado</span>
      </div>

      <div className="personal-form">
        <div className="form-group">
          <label className="form-label">Nombre <span className="required">*</span></label>
          <input
            className="form-input"
            type="text"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Nombre y apellido"
            autoFocus
            style={nombreTocado && !nombreOk ? { borderColor: 'var(--danger)' } : undefined}
          />
          {nombreTocado && !nombreOk && (
            <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
              Ingresá el nombre de quien va a atenderse.
            </p>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">Teléfono móvil <span className="required">*</span></label>
          <input
            className="form-input"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="+54 11 1234-5678"
            style={tocado && !valido ? { borderColor: 'var(--danger)' } : undefined}
          />
          {tocado && !valido && (
            <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
              Ingresá el número con código de área, por ejemplo 11 1234-5678.
            </p>
          )}
          <p className="text-xs text-muted" style={{ marginTop: 4 }}>
            Es por donde te va a contactar el negocio si hace falta.
          </p>
        </div>

        {/* Campos extra según el rubro del negocio (professionPresets.js), ej.
            datos del vehículo en un taller o de la mascota en veterinaria.
            Nunca hardcodeados por profesión: vienen del preset resuelto. */}
        {customFields.map((field) => (
          <div className="form-group" key={field.key}>
            <label className="form-label">
              {field.label} {field.required && <span className="required">*</span>}
            </label>
            <input
              className="form-input"
              type="text"
              value={customFieldValues[field.key] || ''}
              onChange={(e) => onCustomFieldChange(field.key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- SUMMARY ----
function BookingSummary({ professional, service, date, timeSlot, price, originalPrice, currency, promo, onConfirm, confirming, onBack }) {
  const { terminology } = useBusinessContext();
  return (
    <div>
      <h2 className="booking-step-title">Confirmar tu {terminology.appointmentNoun}</h2>
      <p className="booking-step-subtitle">Revisá los datos antes de confirmar</p>
      <div className="booking-summary">
        <div className="summary-card">
          <div className="summary-header">
            <div className="avatar avatar-lg" style={{ margin: '0 auto var(--space-sm)' }}>
              {professional.avatarUrl
                ? <img src={professional.avatarUrl} alt={professional.name} />
                : professional.name.split(' ').map(n => n[0]).join('')}
            </div>
            <h3>{professional.name}</h3>
            <p className="text-sm" style={{ opacity: 0.8 }}>{professional.specialty}</p>
          </div>
          <div className="summary-body">
            <div className="summary-row">
              <span className="summary-label"><Icon name="clipboard" /> Servicio</span>
              <span className="summary-value">{service.name}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label"><Icon name="calendar" /> Fecha</span>
              <span className="summary-value">{formatDate(date)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label"><Icon name="clock" /> Horario</span>
              <span className="summary-value">{timeSlot.startTime} — {timeSlot.endTime}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label"><Icon name="money" /> Total</span>
              <span className="summary-value">
                {promo ? (
                  <>
                    <span style={{ textDecoration: 'line-through', opacity: 0.6, marginRight: 6, fontWeight: 400 }}>
                      {formatPrice(originalPrice, currency)}
                    </span>
                    {formatPrice(price, currency)}
                    <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: 11 }}>
                      <Icon name="tag" /> Promo
                    </span>
                  </>
                ) : (
                  formatPrice(price, currency)
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Fija al fondo de la pantalla a propósito: si el botón quedara
          adentro de la tarjeta, en una pantalla baja (celular chico, o una
          notebook con poca altura) el cliente podía no llegar a verlo, no
          scrollear, y creer que la reserva ya había quedado hecha sin haber
          apretado nada. "Atrás" viaja acá adentro también: un botón en el
          flujo normal de la página, aparte de esta barra, puede terminar
          tapado por ella si el contenido de arriba entra sin scroll (pasa
          en pantallas anchas y bajas) — adentro de la misma barra fija no
          hay forma de que eso pase. */}
      <div className="confirm-bar">
        <div className="confirm-bar-inner confirm-bar-actions">
          <button className="btn btn-outline btn-lg" onClick={onBack}>← Atrás</button>
          <button className="btn btn-primary btn-lg" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Confirmando…' : <><Icon name="check-circle" /> Confirmar Reserva</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- AVISO: el negocio no puede tomar turnos ----
// 'frozen'    → cuenta suspendida por falta de pago
// 'not-ready' → cuenta nueva, todavía sin profesionales o sin servicios
function BookingUnavailable({ reason, business }) {
  const isFrozen = reason === 'frozen';
  return (
    <div className="booking-container" style={{ textAlign: 'center', padding: 'var(--space-xl) var(--space-md)' }}>
      <div
        className="card"
        style={{
          padding: 'var(--space-xl)',
          maxWidth: 500,
          margin: '0 auto',
          borderTop: isFrozen ? '4px solid var(--danger)' : '4px solid var(--primary)',
        }}
      >
        <div style={{ fontSize: 60, marginBottom: 'var(--space-md)' }}><Icon name={isFrozen ? 'snowflake' : 'tool'} /></div>
        <h2 style={{ marginBottom: 'var(--space-md)', color: isFrozen ? 'var(--danger)' : 'inherit' }}>
          {isFrozen ? 'Reservas suspendidas' : 'Todavía no hay turnos disponibles'}
        </h2>
        <p className="text-secondary" style={{ marginBottom: 'var(--space-lg)', lineHeight: 1.5 }}>
          {isFrozen
            ? <>Las reservas online de <strong>{business.name}</strong> están temporalmente suspendidas.</>
            : <><strong>{business.name}</strong> está terminando de configurar su agenda online. Volvé a entrar en un rato.</>}
        </p>
        {business.phone && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Si necesitás un turno ahora, escribiles al <strong>{business.phone}</strong>.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// BOOKING PAGE (Main Component)
// ============================================

// El login con Google es un redirect de página completa (Supabase Auth), no
// un popup como era con Firebase: la pantalla entera se destruye y se
// recarga de cero al volver de accounts.google.com, así que BookingContext
// pierde todo lo que tenía en memoria (arranca de nuevo en el paso 1, sin
// profesional ni servicio elegidos). Por eso, justo antes de mandarlo a
// loguearse, se guarda acá lo elegido — y se restaura apenas la sesión
// aparece, sin importar en qué paso arrancó este montaje.
const BOOKING_DRAFT_KEY = 'slotly:bookingDraft';

export default function BookingPage() {
  const { booking, dispatch } = useBooking();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [reservando, setReservando] = useState(false);

  // Datos ya filtrados por el negocio del slug de la URL.
  const { professionals, services, professionalServices, schedules, appointments, business, slug, businessId, promotions, blockedDays } =
    useTenant();
  const { customerFields } = useBusinessContext();
  const { step, professionalId, serviceId, date, timeSlot, personalInfo, customFieldValues } = booking;
  // Día de la semana de la fecha elegida, para saber si hay una promo activa
  // en ese día — mismo remapeo que usa availabilityEngine (0=Lunes).
  const dayOfWeek = date ? getLocalDayOfWeek(new Date(date + 'T00:00:00')) : null;
  const faltanCamposExtra = customerFields.some(
    (f) => f.required && !String(customFieldValues[f.key] || '').trim()
  );

  // Los campos extra (datos del vehículo, de la mascota, motivo de
  // consulta...) no tienen columnas propias en `appointments`: se juntan en
  // el mismo `notes` que ya acepta createAppointment.
  const customFieldsNotes = useMemo(
    () =>
      customerFields
        .map((f) => {
          const valor = String(customFieldValues[f.key] || '').trim();
          return valor ? `${f.label}: ${valor}` : null;
        })
        .filter(Boolean)
        .join(' · ')
        .slice(0, 500),
    [customerFields, customFieldValues]
  );

  // Motivos por los que este negocio no puede tomar turnos ahora mismo.
  // Se calcula acá pero se renderiza recién después de todos los hooks: cortar
  // el render antes rompe las reglas de hooks si el motivo cambia en vivo.
  const blockedReason = business?.isFrozen
    ? 'frozen'
    : (professionals.length === 0 || services.length === 0)
      ? 'not-ready'
      : null;

  // Check if user already has an appointment on this day
  const hasAppointmentToday = useMemo(() => {
    if (!user || !date) return false;
    return appointments.some(app =>
      app.userId === user.id &&
      app.appointmentDate === date &&
      // El estado es 'cancelada'. Con 'cancelado' (que no existe) la comparación
      // nunca era falsa, así que un turno ya cancelado seguía bloqueando la
      // reserva de otro el mismo día.
      app.status !== 'cancelada'
    );
  }, [user, date, appointments]);

  const selectedProfessional = professionals.find(p => p.id === professionalId);
  const selectedService = services.find(s => s.id === serviceId);

  // Get customized price
  const ps = professionalServices.find(p => p.professionalId === professionalId && p.serviceId === serviceId);
  const finalPrice = ps?.customPrice || selectedService?.price || 0;
  const finalDuration = ps?.customDuration || selectedService?.durationMinutes || 30;

  // Promo activa para el horario elegido, si hay uno elegido. Es solo para
  // MOSTRAR el precio con descuento antes de confirmar: quien de verdad lo
  // calcula y lo cobra es createAppointment, del lado del servidor.
  const promoAplicada = timeSlot
    ? promoParaSlot(promotions, { serviceId, dayOfWeek, startTime: timeSlot.startTime })
    : null;
  const precioConDescuento = precioConPromo(finalPrice, promoAplicada);

  // Volvió del login: restaura profesional y servicio (lo único que hacía
  // falta guardar — el nombre lo precarga el efecto de abajo con el de la
  // cuenta, y el teléfono todavía no se había cargado en el paso 2) y salta
  // directo al paso de "Tus datos". No depende de en qué paso arrancó este
  // montaje: después del redirect siempre arranca en 1, sin nada elegido.
  useEffect(() => {
    if (!user) return;
    let draft = null;
    try {
      const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
      sessionStorage.removeItem(BOOKING_DRAFT_KEY);
    } catch { /* sin sessionStorage, no hay nada que restaurar */ }
    if (!draft?.professionalId || !draft?.serviceId) return;
    dispatch({ type: 'SET_PROFESSIONAL', payload: draft.professionalId });
    dispatch({ type: 'SET_SERVICE', payload: draft.serviceId });
    dispatch({ type: 'SET_STEP', payload: 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Precarga el nombre con el de la cuenta de Google, editable: el cliente
  // puede estar reservando para otra persona o preferir otra grafía.
  useEffect(() => {
    if (user && !personalInfo.name) {
      dispatch({ type: 'SET_PERSONAL_INFO', payload: { name: user.name } });
    }
  }, [user, personalInfo.name, dispatch]);

  // Qué está ocupado ese día para ese profesional. No sale de `appointments`
  // del contexto: para un cliente esa lista trae SOLO sus propios turnos (las
  // Rules no le dejan ver los de los demás, y está bien), así que con ella la
  // grilla mostraría como libre lo que ya tomó otro y cada reserva moriría en
  // "ese horario ya fue tomado". Se le pide al servidor solo las horas.
  //
  // La respuesta se guarda junto con la clave que la pidió: si cambia el
  // profesional o el día, la que hay deja de valer sola, sin un setState
  // sincrónico en el efecto (que el compilador de React rechaza).
  const claveOcupados = `${businessId}|${professionalId}|${date}`;
  const [ocupados, setOcupados] = useState({ clave: '', lista: [] });
  useEffect(() => {
    if (!businessId || !professionalId || !date) return;
    let vigente = true;
    getBusySlots({ businessId, professionalId, appointmentDate: date })
      .then(({ ocupados }) => {
        if (!vigente) return;
        // Con la forma que espera availabilityEngine.
        const lista = ocupados.map((o) => ({ ...o, professionalId, appointmentDate: date, status: 'confirmada' }));
        setOcupados({ clave: claveOcupados, lista });
      })
      .catch((err) => {
        console.error('[BookingPage] No se pudieron leer los horarios ocupados:', err);
        // Mejor una grilla optimista que ninguna: la transacción del servidor
        // sigue frenando el solapamiento.
        if (vigente) setOcupados({ clave: claveOcupados, lista: [] });
      });
    return () => { vigente = false; };
  }, [businessId, professionalId, date, claveOcupados]);
  const cargandoOcupados = ocupados.clave !== claveOcupados;

  // Calculate available slots
  const availableSlots = useMemo(() => {
    if (!professionalId || !serviceId || !date || cargandoOcupados) return [];
    return calculateAvailableSlots({
      professionalId,
      serviceId,
      date,
      schedules,
      // Los rangos bloqueados por el negocio ese día van como horarios
      // ocupados: el motor los saca de la grilla sin saber de bloqueos.
      appointments: [...ocupados.lista, ...rangosComoOcupados(blockedDays, date, professionalId)],
      services,
      professionalServices,
      slotInterval: business.slotInterval,
      businessHours: business.businessHours,
    });
  }, [professionalId, serviceId, date, schedules, ocupados, cargandoOcupados, services, professionalServices, business, blockedDays]);

  if (blockedReason) {
    return <BookingUnavailable reason={blockedReason} business={business} />;
  }

  const canGoNext = () => {
    switch (step) {
      case 1: return !!professionalId;
      case 2: return !!serviceId;
      case 3: return telefonoValido(personalInfo.phone) && nombreValido(personalInfo.name) && !faltanCamposExtra;
      case 4: return !!date && !hasAppointmentToday;
      case 5: return !!timeSlot;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step === 4 && hasAppointmentToday) {
      setError('Ya tenés un turno reservado para este día.');
      return;
    }
    // Hasta acá se puede mirar sin cuenta. Para poner sus datos y confirmar,
    // tiene que entrar. profesional y servicio se guardan porque el login
    // recarga la página entera (ver BOOKING_DRAFT_KEY más arriba) — sin
    // esto, volver de Google largaba de nuevo en "elegí tu profesional".
    if (step === 2 && !user) {
      setError('');
      try { sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({ professionalId, serviceId })); } catch { /* sin storage, hay que re-elegir al volver */ }
      navigate('/login', { state: { from: `/${slug}` } });
      return;
    }
    setError('');
    dispatch({ type: 'NEXT_STEP' });
  };

  const handleBack = () => {
    setError('');
    dispatch({ type: 'PREV_STEP' });
  };

  const handleConfirm = async () => {
    if (reservando) return;
    setReservando(true);
    setError('');

    const notes = customFieldsNotes;

    const datos = {
      userId: user.id,
      clientName: personalInfo.name,
      clientEmail: user.email,
      clientPhone: personalInfo.phone,
      professionalId,
      serviceId,
      appointmentDate: date,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      price: finalPrice,
      notes,
      adminNotes: '',
    };

    try {
      // El turno lo revalida enteró el servidor (Edge Function
      // create-appointment): el motor de disponibilidad de acá arriba pinta
      // la grilla, pero cualquiera con la consola abierta lo saltea. El
      // precio sale del servicio, no de este formulario.
      const res = await createAppointment({
        businessId,
        professionalId,
        serviceId,
        appointmentDate: date,
        startTime: timeSlot.startTime,
        clientName: personalInfo.name,
        clientPhone: personalInfo.phone,
        clientEmail: user.email,
        notes,
      });
      const id = res.id;
      datos.price = res.price;
      datos.endTime = res.endTime;

      dispatch({ type: 'RESET' });
      navigate(`/${slug}/confirmacion`, {
        state: { appointment: { ...datos, id, businessId, status: 'pendiente' } },
      });
    } catch (err) {
      console.error('[BookingPage] No se pudo reservar:', err);
      // La Edge Function devuelve mensajes ya escritos para el cliente
      // ("Ese horario ya fue tomado. Elegí otro."), así que se muestran tal
      // cual en vez de envolverlos en otra frase.
      const esDeNegocio = [
        'already-exists',
        'failed-precondition',
        'invalid-argument',
        'not-found',
      ].includes(err.code);
      setError(
        esDeNegocio
          ? err.message
          : 'No se pudo confirmar la reserva. Actualizá la página e intentá de nuevo.'
      );
      setReservando(false);
    }
  };

  return (
    <div className={`booking-container ${step === 6 ? 'has-confirm-bar' : ''}`}>
      <BusinessHero business={business} compacta={step > 1} />
      <Stepper step={step} />
      {error && (
        <div className="badge badge-danger mb-md" style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <ProfessionalSelect
          professionals={professionals}
          selectedId={professionalId}
          onSelect={id => dispatch({ type: 'SET_PROFESSIONAL', payload: id })}
        />
      )}

      {step === 2 && (
        <ServiceSelect
          services={services}
          professionalServices={professionalServices}
          professionalId={professionalId}
          selectedId={serviceId}
          onSelect={id => dispatch({ type: 'SET_SERVICE', payload: id })}
          currency={business.currency}
          promotions={promotions}
        />
      )}

      {step === 3 && (
        <PersonalInfoStep
          user={user}
          name={personalInfo.name}
          onNameChange={name => dispatch({ type: 'SET_PERSONAL_INFO', payload: { name } })}
          phone={personalInfo.phone}
          onPhoneChange={phone => dispatch({ type: 'SET_PERSONAL_INFO', payload: { phone } })}
          customFields={customerFields}
          customFieldValues={customFieldValues}
          onCustomFieldChange={(key, value) => dispatch({ type: 'SET_CUSTOM_FIELD', payload: { key, value } })}
        />
      )}

      {step === 4 && (
        <DatePicker
          selectedDate={date}
          onSelect={d => dispatch({ type: 'SET_DATE', payload: d })}
          professionalId={professionalId}
          schedules={schedules}
          businessHours={business.businessHours}
          maxAdvanceDays={business.maxAdvanceDays}
          blockedDays={blockedDays}
        />
      )}

      {step === 5 && (
        <TimeSlotGrid
          slots={availableSlots}
          selectedSlot={timeSlot}
          onSelect={s => dispatch({ type: 'SET_TIMESLOT', payload: s })}
          date={date}
          cargando={cargandoOcupados}
          serviceId={serviceId}
          dayOfWeek={dayOfWeek}
          promotions={promotions}
        />
      )}

      {step === 6 && selectedProfessional && selectedService && (
        <BookingSummary
          professional={selectedProfessional}
          service={{ ...selectedService, finalDuration }}
          date={date}
          timeSlot={timeSlot}
          price={precioConDescuento}
          originalPrice={finalPrice}
          currency={business.currency}
          promo={promoAplicada}
          onConfirm={handleConfirm}
          confirming={reservando}
          onBack={handleBack}
        />
      )}

      {step < 6 && (
        <div className="booking-nav">
          {step > 1 ? (
            <button className="btn btn-outline" onClick={handleBack}>← Atrás</button>
          ) : <div />}

          <button className="btn btn-primary" disabled={!canGoNext()} onClick={handleNext}>
            Siguiente →
          </button>
        </div>
      )}

      {/* Debajo del "Siguiente" a propósito: está para quien quiere saber
          dónde queda antes de reservar, sin meterse en el medio del flujo. */}
      {step === 1 && <BusinessMap business={business} />}
    </div>
  );
}
