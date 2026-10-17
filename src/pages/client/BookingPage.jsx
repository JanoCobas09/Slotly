import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBooking } from '../../contexts/BookingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment, getBusySlots } from '../../lib/functions';
import { getUltimoTelefono } from '../../lib/repository';
import { calculateAvailableSlots, professionalWorksOnDate } from '../../utils/availabilityEngine';
import { promoParaSlot, precioConPromo } from '../../utils/promoEngine';
import { formatDate, formatPrice, toDateString, getMonthName, getLocalDayOfWeek } from '../../utils/dateUtils';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import Icon from '../../components/Icon';
import BusinessHero from '../../components/reserva/BusinessHero';
import BusinessMap from '../../components/reserva/BusinessMap';
import { esDiaEntero, rangosComoOcupados, bloqueosQueAplican } from '../../utils/bloqueos';
import { esTelefono, problema, LIMITES } from '../../utils/validaciones';
import ErrorDeCampo from '../../components/ErrorDeCampo';
import { rutaDeReserva } from '../../paginas-exclusivas';
import { useErrorDeCampo } from '../../hooks/useErrorDeCampo';
import { sucursalesActivas, profesionalesDeSucursal, schedulesDeSucursal, precioEn, horarioDe, datosDe } from '../../utils/sucursales';
import { CUALQUIERA, modoProfesional, candidatosDelServicio, juntarGrillas, esHorarioTomado } from '../../utils/asignacionProfesional';

// ---- PASOS ----
// Orden pensado para que reserve rápido y sin trabas (pedido del usuario,
// 15/10/2026): primero elige QUÉ, CON QUIÉN y CUÁNDO — viendo los horarios
// libres antes de que se le pida nada — y recién al final entra con Google y
// deja sus datos. Los pasos de una sola opción avanzan solos al tocarla.
const PASO = { SERVICIO: 1, PROFESIONAL: 2, HORARIO: 3, DATOS: 4, CONFIRMAR: 5 };
const ETIQUETAS_PASO = ['Servicio', 'Profesional', 'Día y hora', 'Tus datos', 'Confirmar'];
// Cuánto se ve marcada la opción tocada antes de pasar al paso siguiente:
// que se note qué eligió, y que no parezca que la pantalla "saltó sola".
const DEMORA_AVANCE_MS = 320;

// ---- STEPPER ----
// `step` es el número interno (PASO); si el profesional no se pregunta
// (lo asigna el negocio, o hay uno solo), ese círculo no se muestra y los
// demás se renumeran.
function Stepper({ step, saltearProfesional }) {
  const pasos = ETIQUETAS_PASO
    .map((label, idx) => ({ label, paso: idx + 1 }))
    .filter(({ paso }) => !(saltearProfesional && paso === PASO.PROFESIONAL));
  return (
    <div className="stepper">
      {pasos.map(({ label, paso }, idx) => {
        const num = idx + 1;
        const completed = paso < step;
        const active = paso === step;
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

// La cabecera del negocio (BusinessHero) vive en components/reserva/: la
// comparte la vista previa de Configuración → Tu negocio.

// ---- SUCURSAL ----
// Primer paso cuando el negocio atiende en más de un lugar: dónde. No es un
// paso numerado del stepper (no cambia la numeración de los demás): hasta
// elegir sucursal no se muestra el resto.
function SucursalSelect({ sucursales, negocio, onSelect }) {
  return (
    <div>
      <h2 className="booking-step-title">Elegí la sucursal</h2>
      <p className="booking-step-subtitle">¿Dónde te queda mejor?</p>
      <div className="flex flex-col gap-sm">
        {sucursales.map((b) => {
          const { address } = datosDe(b, negocio);
          return (
            <button key={b.id} type="button" className="card card-selectable sucursal-opcion" onClick={() => onSelect(b.id)}>
              <Icon name="pin" />
              <span style={{ flex: 1, textAlign: 'left' }}>
                <strong>{b.name}</strong>
                {address && <span className="text-sm text-secondary" style={{ display: 'block' }}>{address}</span>}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- SERVICE SELECT ----
// Primer paso: qué se quiere hacer. Solo se ofrecen los servicios que hace
// al menos un profesional activo. Cada profesional puede tener su propio
// precio y duración para un servicio (professionalServices): si varían, se
// muestra "Desde" el más barato y el rango de minutos; el precio de cada uno
// se ve en el paso siguiente.
function ServiceSelect({ services, professionals, professionalServices, selectedId, onSelect, currency, promotions }) {
  const available = useMemo(() => {
    const activos = new Set(professionals.filter((p) => p.isActive).map((p) => p.id));
    return services.filter((s) => s.isActive).map((s) => {
      const opciones = professionalServices
        .filter((ps) => ps.serviceId === s.id && activos.has(ps.professionalId))
        .map((ps) => ({ precio: ps.customPrice || s.price, duracion: ps.customDuration || s.durationMinutes }));
      if (opciones.length === 0) return null;
      const precios = opciones.map((o) => o.precio);
      const duraciones = opciones.map((o) => o.duracion);
      return {
        ...s,
        precioDesde: Math.min(...precios),
        variaPrecio: new Set(precios).size > 1,
        durMin: Math.min(...duraciones),
        durMax: Math.max(...duraciones),
      };
    }).filter(Boolean);
  }, [services, professionals, professionalServices]);

  // Todavía no se eligió fecha ni hora acá: solo se puede avisar que ESTE
  // servicio tiene alguna promo cargada, no si aplica al horario que elija
  // después — eso se ve recién en el paso de horario.
  const tienePromo = (serviceId) => promotions.some((p) => p.serviceId === serviceId && p.isActive !== false);

  return (
    <div>
      <h2 className="booking-step-title">Elegí un servicio</h2>
      <p className="booking-step-subtitle">¿Qué te querés hacer?</p>
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
              <div className="service-price">
                {service.variaPrecio && <span className="service-price-desde">Desde </span>}
                {formatPrice(service.precioDesde, currency)}
              </div>
              <div className="service-duration">
                <Icon name="clock" /> {service.durMin === service.durMax ? service.durMin : `${service.durMin}–${service.durMax}`} min
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- PROFESSIONAL SELECT ----
// Segundo paso: quién. Solo los profesionales que hacen el servicio elegido.
// Si el precio cambia según quién lo haga, cada tarjeta muestra el suyo.
// Con `ofrecerCualquiera` (modo 'elige_o_cualquiera' y más de uno para
// elegir) la primera tarjeta es "Cualquier profesional".
function ProfessionalSelect({ professionals, professionalServices, service, selectedId, onSelect, currency, ofrecerCualquiera }) {
  const disponibles = useMemo(() => professionals
    .filter((p) => p.isActive)
    .map((p) => {
      const ps = professionalServices.find((x) => x.professionalId === p.id && x.serviceId === service?.id);
      return ps ? { ...p, precio: ps.customPrice || service.price } : null;
    })
    .filter(Boolean), [professionals, professionalServices, service]);
  const variaPrecio = new Set(disponibles.map((p) => p.precio)).size > 1;

  return (
    <div>
      <h2 className="booking-step-title">Seleccioná tu profesional</h2>
      <p className="booking-step-subtitle">Elegí con quién querés atenderte</p>
      <div className="professionals-grid">
        {ofrecerCualquiera && disponibles.length > 1 && (
          <div
            className={`card card-selectable professional-card professional-card-cualquiera ${selectedId === CUALQUIERA ? 'card-selected' : ''}`}
            onClick={() => onSelect(CUALQUIERA)}
          >
            <div className="avatar avatar-lg"><Icon name="users" /></div>
            <h3>Cualquier profesional</h3>
            <p className="specialty">Te mostramos todos los horarios libres</p>
            {variaPrecio && (
              <p className="professional-card-precio">
                <span className="service-price-desde">Desde </span>
                {formatPrice(Math.min(...disponibles.map((p) => p.precio)), currency)}
              </p>
            )}
          </div>
        )}
        {disponibles.map((prof) => (
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
            {variaPrecio && <p className="professional-card-precio">{formatPrice(prof.precio, currency)}</p>}
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

function DatePicker({ selectedDate, onSelect, professionalIds, schedules: allSchedules, businessHours, maxAdvanceDays, blockedDays = [] }) {
  // Días bloqueados ENTEROS (feriados, vacaciones) para cada profesional: los
  // de todo el negocio y los suyos. Los que solo tienen un rango bloqueado se
  // ofrecen igual: esas horas las saca la grilla. Con "Cualquier
  // profesional" llegan varios y el día se ofrece si al menos uno atiende.
  const bloqueadosDe = useMemo(() => new Map(professionalIds.map((id) => [
    id,
    new Set(bloqueosQueAplican(blockedDays, { professionalId: id }).filter(esDiaEntero).map((b) => b.date)),
  ])), [professionalIds, blockedDays]);
  const atiende = (dateStr) => professionalIds.some((id) =>
    professionalWorksOnDate(id, dateStr, allSchedules, businessHours) && !bloqueadosDe.get(id).has(dateStr));
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
      <h2 className="booking-step-title">Elegí el día</h2>
      <p className="booking-step-subtitle">Tocá un día y abajo te mostramos sus horarios libres</p>
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
            const works = atiende(dateStr);
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
function TimeSlotGrid({ slots, selectedSlot, onSelect, date, cargando, serviceId, dayOfWeek, promotions, minAdvanceHours }) {
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
          {minAdvanceHours > 0 && (
            <p className="text-sm text-muted mt-sm">
              Este negocio toma turnos con al menos {minAdvanceHours === 1 ? '1 hora' : `${minAdvanceHours} horas`} de anticipación.
            </p>
          )}
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
  // esTelefono: solo números y + ( ) - . espacios — sin esto "11 abc 1234-5678"
  // pasaba acá (se contaban solo los dígitos) y la base lo rechazaba después.
  return digitos.length >= 10 && digitos.length <= 13 && esTelefono(tel);
}

function nombreValido(nombre) {
  return String(nombre || '').trim().length >= 2;
}

/** El primer dato que falta o está mal en "Tus datos", o null. */
function problemaDatosPersonales(name, phone, customFields, customFieldValues) {
  if (!nombreValido(name)) return problema('clientName', 'Ingresá el nombre de quien va a atenderse.');
  if (!telefonoValido(phone)) return problema('clientPhone', 'Ingresá el número con código de área, por ejemplo 11 1234-5678.');
  const falta = customFields.find((f) => f.required && !String(customFieldValues[f.key] || '').trim());
  if (falta) return problema(`extra-${falta.key}`, `Completá "${falta.label}".`);
  return null;
}

function PersonalInfoStep({ user, name, phone, onNameChange, onPhoneChange, telefonoRecordado, customFields, customFieldValues, onCustomFieldChange, errorCampo }) {
  // El aviso en vivo (mientras tipea) se calla si ya está el de Siguiente, para no repetirlo.
  const marcado = errorCampo.problema?.campo;
  const nombreTocado = name.length > 0 && marcado !== 'clientName';
  const nombreOk = nombreValido(name);
  const tocado = phone.length > 0 && marcado !== 'clientPhone';
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
            {...errorCampo.campo('clientName')}
            value={name}
            maxLength={LIMITES.nombre}
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
          <ErrorDeCampo error={errorCampo} campo="clientName" />
        </div>

        <div className="form-group">
          <label className="form-label">Teléfono móvil <span className="required">*</span></label>
          <input
            className="form-input"
            type="tel"
            inputMode="tel"
            {...errorCampo.campo('clientPhone')}
            value={phone}
            maxLength={LIMITES.telefono}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="+54 11 1234-5678"
            style={tocado && !valido ? { borderColor: 'var(--danger)' } : undefined}
          />
          {tocado && !valido && (
            <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
              Ingresá el número con código de área, por ejemplo 11 1234-5678.
            </p>
          )}
          <ErrorDeCampo error={errorCampo} campo="clientPhone" />
          <p className="text-xs text-muted" style={{ marginTop: 4 }}>
            {telefonoRecordado
              ? 'Es el que usaste la última vez. Si cambió, tocalo y escribí el nuevo.'
              : 'Es por donde te va a contactar el negocio si hace falta.'}
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
              {...errorCampo.campo(`extra-${field.key}`)}
              value={customFieldValues[field.key] || ''}
              maxLength={150}
              onChange={(e) => onCustomFieldChange(field.key, e.target.value)}
            />
            <ErrorDeCampo error={errorCampo} campo={`extra-${field.key}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- SUMMARY ----
function BookingSummary({ professional, asignadoSolo, service, date, timeSlot, price, originalPrice, currency, promo, sena, onConfirm, confirming, onBack }) {
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
            {asignadoSolo && <p className="text-sm" style={{ opacity: 0.8 }}>Te atiende</p>}
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
            {sena > 0 && (
              <div className="summary-row">
                <span className="summary-label"><Icon name="lock" /> Seña a pagar ahora</span>
                <span className="summary-value">{formatPrice(sena, currency)}</span>
              </div>
            )}
          </div>
        </div>
        {sena > 0 && (
          <p className="text-sm text-secondary" style={{ marginTop: 'var(--space-md)', lineHeight: 1.5 }}>
            Para reservar, este negocio pide una seña. La pagás con <strong>Mercado Pago</strong> y
            tenés <strong>15 minutos</strong>: si no se paga, el horario se libera. El resto se paga en el lugar.
          </p>
        )}
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
            {confirming
              ? (sena > 0 ? 'Yendo a Mercado Pago…' : 'Confirmando…')
              : sena > 0
                ? <><Icon name="lock" /> Pagar seña</>
                : <><Icon name="check-circle" /> Confirmar Reserva</>}
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
  const errorCampo = useErrorDeCampo();
  const [reservando, setReservando] = useState(false);

  // Datos ya filtrados por el negocio del slug de la URL.
  const {
    professionals: todosLosProfesionales, services: todosLosServicios, schedules: todosLosHorarios,
    blockedDays: todosLosBloqueos, business: negocio, branches, branchServicePrices,
    professionalServices, appointments, slug, businessId, promotions,
  } = useTenant();
  const { customerFields } = useBusinessContext();
  const { step, professionalId, serviceId, date, timeSlot, personalInfo, customFieldValues } = booking;

  // Para qué lado entra el paso nuevo: "Siguiente" desde la derecha, "Atrás"
  // desde la izquierda (index.css, .mov-paso-*). Se ajusta durante el render
  // comparando con el paso anterior (patrón de React para derivar de un cambio).
  const [pasoAnterior, setPasoAnterior] = useState(step);
  const [haciaAtras, setHaciaAtras] = useState(false);
  if (step !== pasoAnterior) {
    setPasoAnterior(step);
    setHaciaAtras(step < pasoAnterior);
  }

  // ── Sucursales ──
  // Con más de una, el cliente elige primero dónde (o llega con
  // ?sucursal=<id>, el link directo de una sucursal). A partir de ahí todo lo
  // de abajo trabaja con los datos de ESA sucursal, con los mismos nombres
  // que antes: sus profesionales, sus franjas, su horario, sus precios, sus
  // días bloqueados y su dirección. Con una sola sucursal no se filtra nada:
  // la reserva queda exactamente como era.
  const [params] = useSearchParams();
  const sucursales = useMemo(
    () => sucursalesActivas(branches).filter((b) => profesionalesDeSucursal(todosLosProfesionales, todosLosHorarios, b.id).length > 0),
    [branches, todosLosProfesionales, todosLosHorarios],
  );
  const varias = sucursales.length > 1;
  const sucursal = varias ? sucursales.find((b) => b.id === booking.branchId) || null : null;
  const { professionals, schedules, blockedDays, services, business } = useMemo(() => {
    if (!sucursal) {
      return { professionals: todosLosProfesionales, schedules: todosLosHorarios, blockedDays: todosLosBloqueos, services: todosLosServicios, business: negocio };
    }
    const datos = Object.fromEntries(Object.entries(datosDe(sucursal, negocio)).filter(([, v]) => v));
    return {
      professionals: profesionalesDeSucursal(todosLosProfesionales, todosLosHorarios, sucursal.id),
      schedules: schedulesDeSucursal(todosLosHorarios, sucursal.id),
      blockedDays: todosLosBloqueos.filter((b) => !b.branchId || b.branchId === sucursal.id),
      services: todosLosServicios.map((s) => ({ ...s, price: precioEn(s, sucursal.id, branchServicePrices) })),
      business: { ...negocio, ...datos, businessHours: horarioDe(sucursal, negocio), sucursalId: sucursal.id },
    };
  }, [sucursal, todosLosProfesionales, todosLosHorarios, todosLosBloqueos, todosLosServicios, branchServicePrices, negocio]);

  useEffect(() => {
    const pedida = params.get('sucursal');
    if (pedida && pedida !== booking.branchId && sucursales.some((b) => b.id === pedida)) {
      dispatch({ type: 'SET_BRANCH', payload: pedida });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, sucursales.length]);

  // `?servicio=<id>`: la página exclusiva del negocio (src/paginas-exclusivas)
  // deja tocar un servicio y entrar a reservar con ese ya elegido. Una sola
  // vez, y solo si todavía no hay nada elegido: un borrador que vuelve del
  // login manda.
  const servicioDelLink = useRef(false);
  useEffect(() => {
    const pedido = params.get('servicio');
    if (!pedido || servicioDelLink.current || (varias && !sucursal)) return;
    if (!services.some((s) => s.id === pedido && s.isActive !== false)) return;
    servicioDelLink.current = true;
    if (!serviceId && step === PASO.SERVICIO) elegirServicio(pedido, { sinDemora: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, services, varias, sucursal]);
  // Día de la semana de la fecha elegida, para saber si hay una promo activa
  // en ese día — mismo remapeo que usa availabilityEngine (0=Lunes).
  const dayOfWeek = date ? getLocalDayOfWeek(new Date(date + 'T00:00:00')) : null;

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
  const blockedReason = negocio?.isFrozen
    ? 'frozen'
    : (todosLosProfesionales.length === 0 || todosLosServicios.length === 0)
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
      app.status !== 'cancelada' &&
      // Uno esperando seña no cuenta: es el intento anterior de este mismo
      // cliente (volvió de Mercado Pago sin pagar). El servidor lo descarta
      // al reservar de nuevo.
      app.depositStatus !== 'pendiente'
    );
  }, [user, date, appointments]);

  // ── Quién elige al profesional (Configuración → modo_profesional) ──
  // Con "Cualquier profesional" (o en modo automático, donde el cliente ni ve
  // ese paso) `professionalId` queda en CUALQUIERA hasta elegir horario: la
  // grilla junta a todos los que hacen el servicio y cada horario trae quién
  // lo atendería. A partir de ahí, el que atiende es el del horario elegido.
  const modo = modoProfesional(negocio);
  const asignaElNegocio = modo === 'automatico';
  const esCualquiera = professionalId === CUALQUIERA;
  const candidatos = useMemo(
    () => (serviceId ? candidatosDelServicio(professionals, professionalServices, serviceId) : []),
    [professionals, professionalServices, serviceId],
  );
  // El paso del profesional no se muestra si no hay nada que elegir: lo
  // asigna el negocio, o hay uno solo para ese servicio (antes de elegir el
  // servicio: uno solo en todo el negocio).
  const unSoloProfesional = serviceId
    ? candidatos.length === 1
    : professionals.filter((p) => p.isActive !== false).length === 1;
  const saltearProfesional = asignaElNegocio || unSoloProfesional;
  const idsAMirar = useMemo(
    () => (esCualquiera ? candidatos.map((p) => p.id) : professionalId ? [professionalId] : []),
    [esCualquiera, candidatos, professionalId],
  );
  const profesionalQueAtiende = esCualquiera ? timeSlot?.professionalId || null : professionalId;

  // Sin paso del profesional, igual tiene que quedar uno elegido: "cualquiera"
  // si lo asigna el negocio, o el único que hace ese servicio.
  useEffect(() => {
    if (!serviceId || professionalId) return;
    if (asignaElNegocio) dispatch({ type: 'SET_PROFESSIONAL', payload: CUALQUIERA });
    else if (candidatos.length === 1) dispatch({ type: 'SET_PROFESSIONAL', payload: candidatos[0].id });
  }, [asignaElNegocio, serviceId, professionalId, candidatos, dispatch]);

  const selectedProfessional = professionals.find(p => p.id === profesionalQueAtiende);
  const selectedService = services.find(s => s.id === serviceId);
  const precioDe = (id) => {
    const deEse = professionalServices.find(p => p.professionalId === id && p.serviceId === serviceId);
    return deEse?.customPrice || selectedService?.price || 0;
  };

  // Get customized price
  const ps = professionalServices.find(p => p.professionalId === profesionalQueAtiende && p.serviceId === serviceId);
  const finalPrice = ps?.customPrice || selectedService?.price || 0;
  const finalDuration = ps?.customDuration || selectedService?.durationMinutes || 30;

  // Promo activa para el horario elegido, si hay uno elegido. Es solo para
  // MOSTRAR el precio con descuento antes de confirmar: quien de verdad lo
  // calcula y lo cobra es createAppointment, del lado del servidor.
  const promoAplicada = timeSlot
    ? promoParaSlot(promotions, { serviceId, dayOfWeek, startTime: timeSlot.startTime })
    : null;
  const precioConDescuento = precioConPromo(finalPrice, promoAplicada);

  // Seña que va a pedir el servidor (trigger aplicar_sena_obligatoria), solo
  // para mostrarla antes de confirmar — el monto de verdad lo calcula la base
  // con el precio real. Mismo cálculo: % del precio, o fijo con tope en el precio.
  const senaEstimada = (() => {
    const valor = Number(business?.depositValue) || 0;
    if (!business?.depositEnabled || valor <= 0 || (business.currency || 'ARS') !== 'ARS') return 0;
    if (business.depositType === 'fixed') return precioConDescuento > 0 ? Math.min(valor, precioConDescuento) : valor;
    return Math.round(precioConDescuento * Math.min(valor, 100)) / 100;
  })();

  // Volvió del login: restaura TODO lo elegido — servicio, profesional, día y
  // horario (el nombre lo precarga el efecto de abajo con el de la cuenta) —
  // y salta directo a "Tus datos". No depende de en qué paso arrancó este
  // montaje: después del redirect siempre arranca en 1, sin nada elegido. Si
  // mientras tanto alguien tomó ese horario, lo frena el servidor al
  // confirmar, con "Ese horario ya fue tomado".
  useEffect(() => {
    if (!user) return;
    let draft = null;
    try {
      const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY);
      if (raw) draft = JSON.parse(raw);
      sessionStorage.removeItem(BOOKING_DRAFT_KEY);
    } catch { /* sin sessionStorage, no hay nada que restaurar */ }
    if (!draft?.professionalId || !draft?.serviceId) return;
    if (draft.branchId) dispatch({ type: 'SET_BRANCH', payload: draft.branchId });
    // En este orden: cada uno borra lo que viene después (servicio →
    // profesional → día → horario).
    dispatch({ type: 'SET_SERVICE', payload: draft.serviceId });
    dispatch({ type: 'SET_PROFESSIONAL', payload: draft.professionalId });
    if (draft.date) dispatch({ type: 'SET_DATE', payload: draft.date });
    if (draft.date && draft.timeSlot) {
      dispatch({ type: 'SET_TIMESLOT', payload: draft.timeSlot });
      dispatch({ type: 'SET_STEP', payload: PASO.DATOS });
    } else {
      dispatch({ type: 'SET_STEP', payload: PASO.HORARIO });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Avance automático al tocar una opción ──
  // Un solo temporizador (DEMORA_AVANCE_MS): tocar otra opción antes de que
  // avance reemplaza el anterior. Cuando dispara lee el estado del momento
  // (bookingRef), no el del render en que se tocó: ese todavía no tenía la
  // opción recién elegida.
  const avance = useRef(null);
  const bookingRef = useRef(booking);
  useEffect(() => { bookingRef.current = booking; });
  useEffect(() => () => clearTimeout(avance.current), []);
  // Cada paso nuevo arranca arriba: con el avance solo, el anterior podía
  // haber quedado scrolleado (una lista larga de servicios).
  const primerPaso = useRef(true);
  useEffect(() => {
    if (primerPaso.current) { primerPaso.current = false; return; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);
  // Al tocar un día, la pantalla baja hasta sus horarios.
  const horariosRef = useRef(null);

  // Precarga el nombre con el de la cuenta de Google, editable: el cliente
  // puede estar reservando para otra persona o preferir otra grafía.
  useEffect(() => {
    if (user && !personalInfo.name) {
      dispatch({ type: 'SET_PERSONAL_INFO', payload: { name: user.name } });
    }
  }, [user, personalInfo.name, dispatch]);

  // Precarga el teléfono con el de su última reserva, editable: así no lo
  // escribe cada vez. Una sola vez por cuenta — si lo borra para escribir
  // otro, no se lo vuelve a poner — y solo si el campo sigue vacío cuando
  // llega la respuesta (no pisa lo que ya empezó a escribir).
  const telefonoBuscado = useRef(null);
  const [telefonoRecordado, setTelefonoRecordado] = useState(null);
  useEffect(() => {
    if (!user?.id || telefonoBuscado.current === user.id) return;
    telefonoBuscado.current = user.id;
    if (personalInfo.phone) return;
    getUltimoTelefono(user.id).then((tel) => {
      if (!tel) return;
      dispatch({ type: 'SET_PERSONAL_INFO_SI_VACIO', payload: { phone: tel } });
      setTelefonoRecordado(tel);
    });
  }, [user?.id, personalInfo.phone, dispatch]);

  // Qué está ocupado ese día para ese profesional. No sale de `appointments`
  // del contexto: para un cliente esa lista trae SOLO sus propios turnos (las
  // Rules no le dejan ver los de los demás, y está bien), así que con ella la
  // grilla mostraría como libre lo que ya tomó otro y cada reserva moriría en
  // "ese horario ya fue tomado". Se le pide al servidor solo las horas.
  //
  // La respuesta se guarda junto con la clave que la pidió: si cambia el
  // profesional o el día, la que hay deja de valer sola, sin un setState
  // sincrónico en el efecto (que el compilador de React rechaza).
  //
  // Con "Cualquier profesional" se pide la de cada uno, en paralelo (son
  // pocos por negocio). Si falla la de alguno, ese queda con la grilla
  // optimista y el resto sigue normal.
  const claveOcupados = `${businessId}|${idsAMirar.join(',')}|${date}`;
  const [ocupados, setOcupados] = useState({ clave: '', lista: [] });
  useEffect(() => {
    if (!businessId || idsAMirar.length === 0 || !date) return;
    let vigente = true;
    Promise.all(idsAMirar.map((id) =>
      getBusySlots({ businessId, professionalId: id, appointmentDate: date })
        // Con la forma que espera availabilityEngine.
        .then(({ ocupados }) => ocupados.map((o) => ({ ...o, professionalId: id, appointmentDate: date, status: 'confirmada' })))
        .catch((err) => {
          console.error('[BookingPage] No se pudieron leer los horarios ocupados:', err);
          // Mejor una grilla optimista que ninguna: la transacción del
          // servidor sigue frenando el solapamiento.
          return [];
        })))
      .then((listas) => {
        if (vigente) setOcupados({ clave: claveOcupados, lista: listas.flat() });
      });
    return () => { vigente = false; };
  }, [businessId, idsAMirar, date, claveOcupados]);
  const cargandoOcupados = ocupados.clave !== claveOcupados;

  // Calculate available slots
  const availableSlots = useMemo(() => {
    if (idsAMirar.length === 0 || !serviceId || !date || cargandoOcupados) return [];
    const turnosDe = (id) => ocupados.lista.filter((o) => o.professionalId === id);
    const slotsDe = (id) => calculateAvailableSlots({
      professionalId: id,
      serviceId,
      date,
      schedules,
      // Los rangos bloqueados por el negocio ese día van como horarios
      // ocupados: el motor los saca de la grilla sin saber de bloqueos.
      appointments: [...turnosDe(id), ...rangosComoOcupados(bloqueosQueAplican(blockedDays, { professionalId: id }), date, id)],
      services,
      professionalServices,
      slotInterval: business.slotInterval,
      businessHours: business.businessHours,
    });
    const slots = esCualquiera
      ? juntarGrillas(idsAMirar.map((id) => ({ professionalId: id, slots: slotsDe(id), turnosDelDia: turnosDe(id).length })), date)
      : slotsDe(idsAMirar[0]);
    // Anticipación mínima del negocio (Configuración): con 3 horas, a las
    // 14:00 el turno de las 16:00 ya no se ofrece. Se filtra acá y no en
    // availabilityEngine (que no se toca); la base lo vuelve a frenar con el
    // trigger enforce_min_advance_hours.
    const minimo = Number(business.minAdvanceHours) || 0;
    if (!minimo) return slots;
    const desde = Date.now() + minimo * 3600 * 1000;
    return slots.filter((s) => new Date(`${date}T${s.startTime}:00`).getTime() >= desde);
  }, [idsAMirar, esCualquiera, serviceId, date, schedules, ocupados, cargandoOcupados, services, professionalServices, business, blockedDays]);

  if (blockedReason) {
    return <BookingUnavailable reason={blockedReason} business={business} />;
  }

  if (varias && !sucursal) {
    return (
      <div className="booking-container">
        <BusinessHero business={negocio} />
        <SucursalSelect sucursales={sucursales} negocio={negocio} onSelect={(id) => { setError(''); dispatch({ type: 'SET_BRANCH', payload: id }); }} />
      </div>
    );
  }

  // Un turno de este cliente esperando la seña (cerró Mercado Pago, o
  // volvió a entrar al link después): que no se pierda, se le muestra
  // arriba con el camino al seguimiento del pago.
  const senaPendiente = user && appointments.find((a) =>
    a.userId === user.id && a.depositStatus === 'pendiente'
    && a.depositExpiresAt && new Date(a.depositExpiresAt) > new Date()
  );

  /**
   * Va a un paso. Hasta "Día y hora" se puede todo sin cuenta; para "Tus
   * datos" en adelante hay que entrar con Google: se guarda TODO lo elegido
   * (el login recarga la página entera, ver BOOKING_DRAFT_KEY) y se manda al
   * login, que vuelve directo a "Tus datos".
   */
  const irAPaso = (paso) => {
    setError('');
    if (paso >= PASO.DATOS && !user) {
      const b = bookingRef.current;
      try {
        sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({
          professionalId: b.professionalId, serviceId: b.serviceId, branchId: b.branchId, date: b.date, timeSlot: b.timeSlot,
        }));
      } catch { /* sin storage, hay que re-elegir al volver */ }
      navigate('/login', { state: { from: rutaDeReserva(slug, businessId) } });
      return;
    }
    dispatch({ type: 'SET_STEP', payload: paso });
  };
  const avanzarDespues = (paso) => {
    clearTimeout(avance.current);
    avance.current = setTimeout(() => irAPaso(paso), DEMORA_AVANCE_MS);
  };

  // Pasos de una sola opción: tocarla avanza sola. `sinDemora`: el servicio
  // que llega por el link (?servicio=) no se "tocó", así que no hay nada que
  // mostrar marcado — y un temporizador ahí lo cancela el doble montaje de
  // React en desarrollo.
  const elegirServicio = (id, { sinDemora = false } = {}) => {
    dispatch({ type: 'SET_SERVICE', payload: id });
    // Qué sigue se decide con ESTE servicio (todavía no está en el estado).
    const deEse = candidatosDelServicio(professionals, professionalServices, id);
    if (asignaElNegocio) dispatch({ type: 'SET_PROFESSIONAL', payload: CUALQUIERA });
    else if (deEse.length === 1) dispatch({ type: 'SET_PROFESSIONAL', payload: deEse[0].id });
    const siguiente = asignaElNegocio || deEse.length === 1 ? PASO.HORARIO : PASO.PROFESIONAL;
    if (sinDemora) dispatch({ type: 'SET_STEP', payload: siguiente });
    else avanzarDespues(siguiente);
  };
  const elegirProfesional = (id) => {
    dispatch({ type: 'SET_PROFESSIONAL', payload: id });
    avanzarDespues(PASO.HORARIO);
  };
  const elegirDia = (d) => {
    dispatch({ type: 'SET_DATE', payload: d });
    setTimeout(() => horariosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };
  const elegirHorario = (slot) => {
    dispatch({ type: 'SET_TIMESLOT', payload: slot });
    avanzarDespues(PASO.DATOS);
  };

  const handleBack = () => {
    clearTimeout(avance.current);
    setError('');
    const anterior = step === PASO.HORARIO && saltearProfesional ? PASO.SERVICIO : Math.max(PASO.SERVICIO, step - 1);
    dispatch({ type: 'SET_STEP', payload: anterior });
  };

  // "Siguiente": en "Tus datos" (al tocarlo marca qué falta), y de respaldo
  // en los pasos de una opción cuando volvió atrás y ya la tenía elegida.
  const handleNext = () => {
    if (step === PASO.DATOS) {
      if (errorCampo.marcar(problemaDatosPersonales(personalInfo.name, personalInfo.phone, customerFields, customFieldValues))) return;
      if (hasAppointmentToday) {
        setError('Ya tenés un turno reservado para ese día. Volvé y elegí otro día.');
        return;
      }
      irAPaso(PASO.CONFIRMAR);
    } else if (step === PASO.SERVICIO && serviceId) {
      irAPaso(saltearProfesional ? PASO.HORARIO : PASO.PROFESIONAL);
    } else if (step === PASO.PROFESIONAL && professionalId) {
      irAPaso(PASO.HORARIO);
    } else if (step === PASO.HORARIO && date && timeSlot) {
      irAPaso(PASO.DATOS);
    }
  };
  const yaEligio = (step === PASO.SERVICIO && serviceId)
    || (step === PASO.PROFESIONAL && professionalId)
    || (step === PASO.HORARIO && date && timeSlot);

  const handleConfirm = async () => {
    if (reservando) return;
    setReservando(true);
    setError('');

    // Con seña, Mercado Pago se abre en OTRA pestaña y esta se queda en la
    // pantalla de seguimiento (/:slug/pago), que pasa sola a "confirmado"
    // cuando se acredita el pago. Así el cliente nunca pierde de vista en
    // qué estado está su turno — sobre todo desde la app instalada, donde
    // reemplazar esta pantalla por MP lo dejaba, al volver, en el paso 1.
    // La pestaña se abre ACÁ, antes del await: después de esperar al
    // servidor el navegador ya no la considera un clic y la bloquea.
    let ventanaMp = null;
    if (senaEstimada > 0) {
      ventanaMp = window.open('', '_blank');
      // Que la página de MP no pueda tocar esta pestaña (window.opener).
      if (ventanaMp) ventanaMp.opener = null;
      try { ventanaMp?.document.write('<p style="font-family:sans-serif;padding:24px">Abriendo Mercado Pago…</p>'); } catch { /* pestaña ya en otro origen */ }
    }

    const notes = customFieldsNotes;

    const datos = {
      userId: user.id,
      clientName: personalInfo.name,
      clientEmail: user.email,
      clientPhone: personalInfo.phone,
      professionalId: profesionalQueAtiende,
      serviceId,
      appointmentDate: date,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      price: finalPrice,
      notes,
      adminNotes: '',
    };

    // Asignado solo: si otro se queda con ese profesional en ese horario
    // mientras el cliente confirma, se prueba con los otros libres en el
    // mismo horario — solo los del mismo precio, para no cobrarle algo
    // distinto de lo que vio en el resumen.
    const aProbar = esCualquiera
      ? [profesionalQueAtiende, ...(timeSlot.alternativas || []).map((a) => a.professionalId).filter((id) => precioDe(id) === finalPrice)]
      : [profesionalQueAtiende];

    try {
      // El turno lo revalida enteró el servidor (Edge Function
      // create-appointment): el motor de disponibilidad de acá arriba pinta
      // la grilla, pero cualquiera con la consola abierta lo saltea. El
      // precio sale del servicio, no de este formulario.
      let res = null;
      for (const [i, id] of aProbar.entries()) {
        try {
          res = await createAppointment({
            businessId,
            professionalId: id,
            serviceId,
            appointmentDate: date,
            startTime: timeSlot.startTime,
            clientName: personalInfo.name,
            clientPhone: personalInfo.phone,
            clientEmail: user.email,
            notes,
          });
          datos.professionalId = id;
          break;
        } catch (err) {
          if (i === aProbar.length - 1 || !esHorarioTomado(err)) throw err;
        }
      }
      // El negocio pide seña: el turno queda retenido y se paga en Mercado
      // Pago. Al terminar, MP vuelve a /:slug/pago (PagoSenaPage).
      if (res.status === 'pending_payment' && res.checkoutUrl) {
        dispatch({ type: 'RESET' });
        if (ventanaMp && !ventanaMp.closed) {
          ventanaMp.location.href = res.checkoutUrl;
          navigate(`/${slug}/pago?turno=${res.id}`);
        } else {
          // Bloquearon la pestaña nueva: MP en esta misma, como antes.
          window.location.assign(res.checkoutUrl);
        }
        return;
      }
      ventanaMp?.close();

      const id = res.id;
      datos.price = res.price;
      datos.endTime = res.endTime;

      dispatch({ type: 'RESET' });
      navigate(`/${slug}/confirmacion`, {
        state: { appointment: { ...datos, id, businessId, status: 'confirmada' } },
      });
    } catch (err) {
      ventanaMp?.close();
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
    <div className={`booking-container ${step === PASO.CONFIRMAR ? 'has-confirm-bar' : ''}`}>
      <BusinessHero business={business} compacta={step > PASO.SERVICIO} />
      {sucursal && (
        <div className="sucursal-elegida">
          <span><Icon name="pin" /> <strong>{sucursal.name}</strong>{business.address ? ` · ${business.address}` : ''}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); dispatch({ type: 'SET_BRANCH', payload: null }); }}>Cambiar</button>
        </div>
      )}
      {senaPendiente && (
        <div className="notice notice-warn mb-md" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            <Icon name="clock" /> Tenés un turno el {formatDate(senaPendiente.appointmentDate)} a las {senaPendiente.startTime} esperando el pago de la seña.
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/${slug}/pago?turno=${senaPendiente.id}`)}>
            Ver estado del pago
          </button>
        </div>
      )}
      <Stepper step={step} saltearProfesional={saltearProfesional} />

      {/* Atrás arriba, grande y siempre a mano (el de Confirmar va en su
          barra fija). Con el avance solo, es la salida si tocó sin querer. */}
      {step > PASO.SERVICIO && step < PASO.CONFIRMAR && (
        <button type="button" className="booking-atras" onClick={handleBack}>
          <span aria-hidden="true">←</span> Atrás
        </button>
      )}

      {error && (
        <div className="badge badge-danger mb-md" style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* key: cada paso vuelve a montar el envoltorio y anima su entrada.
          Confirmar solo con fundido: su barra es fija a la pantalla y un
          transform la correría de lugar mientras dura la animación. */}
      <div
        key={step}
        className={step === PASO.CONFIRMAR ? 'mov-fundido' : haciaAtras ? 'mov-paso-atras' : 'mov-paso-adelante'}
      >
      {step === PASO.SERVICIO && (
        <ServiceSelect
          services={services}
          professionals={professionals}
          professionalServices={professionalServices}
          selectedId={serviceId}
          onSelect={elegirServicio}
          currency={business.currency}
          promotions={promotions}
        />
      )}

      {step === PASO.PROFESIONAL && (
        <ProfessionalSelect
          professionals={professionals}
          professionalServices={professionalServices}
          service={selectedService}
          selectedId={professionalId}
          onSelect={elegirProfesional}
          currency={business.currency}
          ofrecerCualquiera={modo === 'elige_o_cualquiera'}
        />
      )}

      {/* Día y horario en la misma pantalla: tocás el día y abajo aparecen
          sus horarios. Si ese día no hay lugar, se elige otro ahí mismo, sin
          volver para atrás. */}
      {step === PASO.HORARIO && (
        <>
          <DatePicker
            selectedDate={date}
            onSelect={elegirDia}
            professionalIds={idsAMirar}
            schedules={schedules}
            businessHours={business.businessHours}
            maxAdvanceDays={business.maxAdvanceDays}
            blockedDays={blockedDays}
          />
          <div ref={horariosRef} className="booking-horarios">
            {date ? (
              <TimeSlotGrid
                slots={availableSlots}
                selectedSlot={timeSlot}
                onSelect={elegirHorario}
                date={date}
                cargando={cargandoOcupados}
                serviceId={serviceId}
                dayOfWeek={dayOfWeek}
                promotions={promotions}
                minAdvanceHours={Number(business.minAdvanceHours) || 0}
              />
            ) : (
              <p className="booking-horarios-vacio">
                <Icon name="calendar" /> Elegí un día en el calendario para ver los horarios.
              </p>
            )}
          </div>
        </>
      )}

      {step === PASO.DATOS && (
        <>
          {hasAppointmentToday && (
            <div className="notice notice-warn mb-md" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <Icon name="warning" /> Ya tenés un turno reservado el {formatDate(date)}. Se puede uno por día.
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => irAPaso(PASO.HORARIO)}>
                Elegir otro día
              </button>
            </div>
          )}
          <PersonalInfoStep
            user={user}
            name={personalInfo.name}
            onNameChange={name => dispatch({ type: 'SET_PERSONAL_INFO', payload: { name } })}
            phone={personalInfo.phone}
            onPhoneChange={phone => dispatch({ type: 'SET_PERSONAL_INFO', payload: { phone } })}
            telefonoRecordado={Boolean(telefonoRecordado) && personalInfo.phone === telefonoRecordado}
            customFields={customerFields}
            customFieldValues={customFieldValues}
            onCustomFieldChange={(key, value) => dispatch({ type: 'SET_CUSTOM_FIELD', payload: { key, value } })}
            errorCampo={errorCampo}
          />
        </>
      )}

      {step === PASO.CONFIRMAR && selectedProfessional && selectedService && (
        <BookingSummary
          professional={selectedProfessional}
          asignadoSolo={esCualquiera}
          service={{ ...selectedService, finalDuration }}
          date={date}
          timeSlot={timeSlot}
          price={precioConDescuento}
          originalPrice={finalPrice}
          currency={business.currency}
          promo={promoAplicada}
          sena={senaEstimada}
          onConfirm={handleConfirm}
          confirming={reservando}
          onBack={handleBack}
        />
      )}
      </div>

      {/* "Siguiente": siempre en Tus datos; en los pasos de una opción solo
          de respaldo, si volvió atrás y ya tenía algo elegido (tocar una
          opción ya avanza sola). */}
      {(step === PASO.DATOS || yaEligio) && step < PASO.CONFIRMAR && (
        <div className="booking-nav">
          <div />
          <button className="btn btn-primary btn-lg" onClick={handleNext}>
            {step === PASO.DATOS ? 'Revisar y confirmar →' : 'Siguiente →'}
          </button>
        </div>
      )}

      {/* Debajo de todo a propósito: está para quien quiere saber dónde
          queda antes de reservar, sin meterse en el medio del flujo. */}
      {step === PASO.SERVICIO && <BusinessMap business={business} />}
    </div>
  );
}
