import { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment, updateAppointment, crearTurnoFijo } from '../../lib/repository';
import { horariosLibresPorSucursal, profesionalesDeSucursal, hayVariasSucursales, nombreSucursal, precioEn } from '../../utils/sucursales';
import { formatPrice, toDateString } from '../../utils/dateUtils';
import Icon from '../Icon';
import { esReservaDelCliente } from '../../utils/turnos';
import { esTelefono, esEmail, problema } from '../../utils/validaciones';
import { opcionesFrecuencia, describirTurnoFijo, finEnMeses, ddmm } from '../../utils/turnosFijos';
import ErrorDeCampo from '../ErrorDeCampo';
import { useErrorDeCampo } from '../../hooks/useErrorDeCampo';
import { turnoBloqueado, diaEnteroBloqueado, bloqueosQueAplican } from '../../utils/bloqueos';
import { useOcupadoGoogle, chocaCon } from '../../hooks/useOcupadoGoogle';

/**
 * El staff agenda un turno a mano.
 *
 * Por qué existe: al principio la mayoría de los clientes va a seguir pidiendo
 * turno por WhatsApp, y el barbero necesita cargarlo igual para que el horario
 * quede bloqueado y la agenda sea una sola. También sirve para el que no quiere
 * abrir la reserva al público y usa Slotly solo para ordenarse.
 *
 * Escribe directo a Firestore, no por la Cloud Function `createAppointment`:
 * la función cuenta los turnos del uid que llama (uno por día, tres a futuro),
 * que es una regla para clientes y frenaría al barbero en el cuarto turno que
 * cargue. Las Rules ya permiten al staff crear en su propia agenda. El
 * solapamiento lo evita la grilla, que se arma con la agenda que el staff sí
 * puede ver (el dueño toda, el barbero la suya).
 *
 * Nace confirmado (createAppointment): si el barbero lo cargó es porque ya
 * lo acordó con el cliente.
 *
 * Con `turno`, el mismo formulario EDITA ese turno en vez de crear otro. El
 * dueño puede editar cualquiera; si lo reservó el cliente se le recomienda
 * hablar con él antes: moverlo sin avisarle lo deja yendo a un horario que
 * ya no es el suyo.
 */
export default function NuevoTurnoModal({ onClose, turno = null }) {
  const editando = Boolean(turno);
  const { user } = useAuth();
  const { appointments, professionals: todosLosProfesionales, services, professionalServices, schedules, business, businessId, blockedDays, branches, branchServicePrices } = useTenant();

  const esStaffAsignado = user?.role === 'admin' && Boolean(user?.professionalId);
  // Administrador de sucursal: solo su equipo y los horarios de su sucursal.
  const soloSucursal = user?.role === 'manager' ? user.branchId : null;
  const professionals = soloSucursal ? profesionalesDeSucursal(todosLosProfesionales, schedules, soloSucursal) : todosLosProfesionales;
  const varias = hayVariasSucursales(branches);
  const hoy = toDateString(new Date());

  const [form, setForm] = useState(() => editando
    ? {
        professionalId: turno.professionalId || '',
        serviceId: turno.serviceId || '',
        date: turno.appointmentDate,
        startTime: turno.startTime,
        clientName: turno.clientName || '',
        clientPhone: turno.clientPhone || '',
        clientEmail: turno.clientEmail || '',
        notes: turno.notes || '',
      }
    : {
        professionalId: esStaffAsignado ? user.professionalId : (professionals[0]?.id || ''),
        serviceId: '',
        date: hoy,
        startTime: '',
        clientName: '',
        clientPhone: '',
        clientEmail: '',
        notes: '',
      });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const errorCampo = useErrorDeCampo();
  // Turno fijo (solo al crear): '' = no se repite. Ver utils/turnosFijos.js
  // y crear_turno_fijo en la base.
  const [repetir, setRepetir] = useState('');
  const [hasta, setHasta] = useState('siempre'); // siempre | meses | fecha
  const [meses, setMeses] = useState(3);
  const [fechaFin, setFechaFin] = useState('');
  const [resultadoFijo, setResultadoFijo] = useState(null); // { creados, saltados, descripcion }

  const set = (campo) => (ev) => {
    const valor = ev.target.value;
    setForm((f) => {
      const nuevo = { ...f, [campo]: valor };
      // Cambiar de profesional, servicio o día invalida el horario elegido.
      if (!['startTime', 'clientName', 'clientPhone', 'clientEmail', 'notes'].includes(campo)) {
        nuevo.startTime = '';
      }
      if (campo === 'professionalId') nuevo.serviceId = '';
      return nuevo;
    });
  };

  // Solo los servicios que hace ese profesional, igual que en la reserva pública.
  const serviciosDelProfesional = useMemo(() => {
    const ids = new Set(
      professionalServices.filter((ps) => ps.professionalId === form.professionalId).map((ps) => ps.serviceId)
    );
    return services.filter((s) => s.isActive !== false && ids.has(s.id));
  }, [services, professionalServices, form.professionalId]);

  const servicio = services.find((s) => s.id === form.serviceId);
  const ps = professionalServices.find((p) => p.professionalId === form.professionalId && p.serviceId === form.serviceId);
  const precio = ps?.customPrice || servicio?.price || 0;
  const duracion = ps?.customDuration || servicio?.durationMinutes || 30;

  const slots = useMemo(() => {
    if (!form.professionalId || !form.serviceId || !form.date) return [];
    // Cada franja con el horario de SU sucursal; cada horario libre sale con su branchId.
    const libres = horariosLibresPorSucursal({
      branches,
      business,
      soloSucursal,
      professionalId: form.professionalId,
      serviceId: form.serviceId,
      date: form.date,
      schedules,
      // Al editar, el propio turno no cuenta como ocupado: si no, su
      // horario actual (y cualquiera que se le pise) aparecería tomado.
      appointments: editando ? appointments.filter((a) => a.id !== turno.id) : appointments,
      services,
      professionalServices,
      slotInterval: business.slotInterval,
    });
    // Mismo profesional, servicio y día que ya tenía: su horario original
    // se ofrece siempre, aunque el negocio haya cambiado el horario de
    // atención después — cambiar solo el nombre o la nota no tiene por qué
    // obligar a mover el turno.
    const mismoLugar = editando
      && form.professionalId === turno.professionalId
      && form.serviceId === turno.serviceId
      && form.date === turno.appointmentDate;
    if (mismoLugar && !libres.some((s) => s.startTime === turno.startTime)) {
      return [{ startTime: turno.startTime, endTime: turno.endTime, branchId: turno.branchId }, ...libres]
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return libres;
  }, [form.professionalId, form.serviceId, form.date, schedules, appointments, services, professionalServices, business, branches, soloSucursal, editando, turno]);

  const slot = slots.find((s) => s.startTime === form.startTime);
  // Precio: el de la sucursal donde cae el horario, si tiene uno propio.
  const precioFinal = slot?.branchId && servicio && !ps?.customPrice ? precioEn(servicio, slot.branchId, branchServicePrices) : precio;
  // Los del negocio, los de la sucursal del horario y los del profesional elegido.
  const bloqueosDelTurno = bloqueosQueAplican(blockedDays, { professionalId: form.professionalId, branchId: slot?.branchId || null });
  // Se permite igual (el dueño decide), pero se avisa: ese día lo marcó como
  // no laborable y online nadie puede reservar.
  const diaBloqueado = slot
    ? turnoBloqueado(bloqueosDelTurno, form.date, slot.startTime, slot.endTime)
    : diaEnteroBloqueado(bloqueosDelTurno, form.date);
  // Lo que el profesional tiene en su Google Calendar ese día. Él elige
  // (tarjeta de Google Calendar) si sus actividades BLOQUEAN turnos: entonces
  // esos horarios no se pueden elegir acá tampoco — que no haya solapamiento.
  // Si no bloquean, se avisa y se deja cargar.
  const google = useOcupadoGoogle(businessId, [form.professionalId], form.date);
  const ocupadoGoogle = google.ocupados[form.professionalId] || [];
  const googleBloquea = google.bloquea[form.professionalId] === true;
  // Al editar, el horario que el turno ya tenía se puede mantener aunque
  // después le hayan anotado algo encima en Google (si no, no se podría ni
  // corregirle el nombre).
  const esSuHorarioOriginal = (s) => editando && form.professionalId === turno.professionalId
    && form.date === turno.appointmentDate && s.startTime === turno.startTime;
  const bloqueadoPorGoogle = (s) => googleBloquea && !esSuHorarioOriginal(s) && chocaCon(ocupadoGoogle, s.startTime, s.endTime);
  const chocaGoogle = Boolean(slot) && chocaCon(ocupadoGoogle, slot.startTime, slot.endTime);
  const nombreDelProfesional = professionals.find((p) => p.id === form.professionalId)?.name;
  const digitos = form.clientPhone.replace(/\D/g, '');
  const telefonoOk = digitos.length === 0 || (digitos.length >= 10 && digitos.length <= 13 && esTelefono(form.clientPhone));

  // El botón no se apaga cuando falta algo: al tocarlo se marca qué falta.
  const guardar = async () => {
    if (guardando) return;
    const falla = (!form.serviceId && problema('serviceId', 'Elegí un servicio.'))
      || (!slot && problema('startTime', slots.length === 0 ? 'Ese día no hay horarios libres: probá con otro.' : 'Elegí un horario.'))
      || (!form.clientName.trim() && problema('clientName', 'Poné el nombre del cliente.'))
      || (!telefonoOk && problema('clientPhone', 'Tiene que tener entre 10 y 13 dígitos, o dejalo vacío.'))
      || (form.clientEmail.trim() && !esEmail(form.clientEmail.trim()) && problema('clientEmail', 'Ese mail no parece válido, o dejalo vacío.'))
      || (repetir && hasta === 'fecha' && (!fechaFin || fechaFin < form.date) && problema('fechaFin', 'Elegí hasta cuándo (después del primer turno).'));
    if (errorCampo.marcar(falla)) return;
    if (bloqueadoPorGoogle(slot)) {
      errorCampo.marcar(problema('startTime', 'Ese horario está ocupado en su Google Calendar. Elegí otro.'));
      return;
    }
    if (chocaGoogle && !googleBloquea && !window.confirm(`${nombreDelProfesional || 'El profesional'} tiene algo anotado en su Google Calendar en ese horario. ¿Agendar el turno igual?`)) return;
    setGuardando(true);
    setError('');
    try {
      if (editando) {
        const cambioHorario = form.date !== turno.appointmentDate || slot.startTime !== turno.startTime;
        await updateAppointment(businessId, turno.id, {
          professionalId: form.professionalId,
          serviceId: form.serviceId,
          appointmentDate: form.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          price: precioFinal,
          branchId: slot.branchId || undefined,
          durationMinutes: duracion,
          serviceName: servicio?.name || '',
          clientName: form.clientName.trim().slice(0, 120),
          clientPhone: form.clientPhone.trim().slice(0, 40),
          clientEmail: form.clientEmail.trim(),
          notes: form.notes.trim().slice(0, 500),
          // Si se movió de día u hora, el recordatorio tiene que volver a
          // salir para el horario nuevo.
          ...(cambioHorario ? { reminderSentAt: null } : {}),
        });
        onClose();
        return;
      }
      // Turno fijo: lo agenda la base (este primero y las próximas 8
      // semanas), con las mismas reglas que un turno a mano, y devuelve las
      // fechas que tuvo que saltear.
      if (repetir) {
        const res = await crearTurnoFijo({
          businessId,
          professionalId: form.professionalId,
          serviceId: form.serviceId,
          fechaInicio: form.date,
          hora: slot.startTime,
          frecuencia: repetir,
          fechaFin: hasta === 'meses' ? finEnMeses(form.date, meses) : hasta === 'fecha' ? fechaFin : null,
          clientName: form.clientName.trim().slice(0, 120),
          clientPhone: form.clientPhone.trim().slice(0, 40),
          clientEmail: form.clientEmail.trim(),
          notes: form.notes.trim().slice(0, 500),
        });
        setResultadoFijo({ ...res, descripcion: describirTurnoFijo({ frecuencia: repetir, fechaInicio: form.date, hora: slot.startTime }) });
        setGuardando(false);
        return;
      }
      await createAppointment(businessId, {
        professionalId: form.professionalId,
        serviceId: form.serviceId,
        appointmentDate: form.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        price: precioFinal,
        branchId: slot.branchId || undefined,
        durationMinutes: duracion,
        serviceName: servicio?.name || '',
        clientName: form.clientName.trim().slice(0, 120),
        clientPhone: form.clientPhone.trim().slice(0, 40),
        clientEmail: form.clientEmail.trim(),
        notes: form.notes.trim().slice(0, 500),
        // Quién lo cargó. No es el cliente: el turno no le aparece a nadie en
        // "Mis citas", vive solo en la agenda del negocio.
        userId: user.id,
        type: 'manual',
      });
      onClose();
    } catch (err) {
      console.error('[NuevoTurnoModal] No se pudo guardar:', err);
      setError((editando ? 'No se pudieron guardar los cambios: ' : 'No se pudo agendar el turno: ') + err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3><Icon name={editando ? 'edit' : 'calendar'} /> {editando ? 'Editar turno' : 'Agendar turno'}</h3>
          <button className="modal-close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {resultadoFijo ? (
          <>
            <div className="modal-body">
              <div className="notice doc-guardado" role="status">
                <Icon name="check-circle" /> <strong>Turno fijo agendado:</strong> {form.clientName.trim()}, {resultadoFijo.descripcion}.
              </div>
              <p className="text-secondary" style={{ marginTop: 'var(--space-md)', fontSize: 14 }}>
                Ya quedaron {resultadoFijo.creados === 1 ? '1 turno' : `${resultadoFijo.creados} turnos`} en la agenda (las próximas 8 semanas).
                Los que siguen se van agendando solos.
              </p>
              {resultadoFijo.saltados?.length > 0 && (
                <div className="notice notice-warn" style={{ marginTop: 'var(--space-md)', fontSize: 14 }}>
                  <strong>No se pudieron agendar:</strong>
                  <ul className="turno-fijo-saltados">
                    {resultadoFijo.saltados.map((x) => <li key={x.fecha}>{ddmm(x.fecha)} — {x.motivo}</li>)}
                  </ul>
                  Hablalo con el cliente y, si quieren, cargá esos días a mano en otro horario.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={onClose}>Listo</button>
            </div>
          </>
        ) : (
        <>
        <div className="modal-body">
          <p className="text-secondary" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
            {editando
              ? 'Cambiá lo que necesites. Si lo movés de día u hora, el horario viejo queda libre para las reservas online.'
              : 'Para el cliente que te pidió turno por WhatsApp o en persona. Queda confirmado y bloquea el horario para las reservas online.'}
          </p>

          {editando && esReservaDelCliente(turno) && (
            <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
              <Icon name="warning" /> <strong>Este turno lo reservó el cliente{turno.clientName ? ` (${turno.clientName})` : ''}.</strong>{' '}
              Te recomendamos hablar con él antes de modificarlo, así no llega a un horario que ya no es el suyo.
            </div>
          )}

          {error && (
            <div className="badge badge-danger" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
              {error}
            </div>
          )}

          {!esStaffAsignado && (
            <div className="form-group">
              <label className="form-label">Profesional</label>
              <select className="form-input" value={form.professionalId} onChange={set('professionalId')}>
                {professionals.filter((p) => p.isActive !== false).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Servicio</label>
            <select className="form-input" {...errorCampo.campo('serviceId')} value={form.serviceId} onChange={set('serviceId')}>
              <option value="">Elegí un servicio</option>
              {serviciosDelProfesional.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatPrice(s.price, business?.currency)} · {s.durationMinutes} min
                </option>
              ))}
            </select>
            <ErrorDeCampo error={errorCampo} campo="serviceId" />
            {form.professionalId && serviciosDelProfesional.length === 0 && (
              <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                Este profesional no tiene servicios asignados. Se asignan desde Profesionales.
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Día</label>
              <input type="date" className="form-input" min={hoy} value={form.date} onChange={set('date')} />
            </div>
            <div className="form-group">
              <label className="form-label">Horario</label>
              <select
                className="form-input"
                {...errorCampo.campo('startTime')}
                value={form.startTime}
                onChange={set('startTime')}
                disabled={!form.serviceId || slots.length === 0}
              >
                <option value="">{!form.serviceId ? 'Primero el servicio' : slots.length === 0 ? 'Sin horarios libres' : 'Elegí un horario'}</option>
                {slots.map((s) => (
                  <option key={s.startTime} value={s.startTime} disabled={bloqueadoPorGoogle(s)}>
                    {s.startTime} — {s.endTime}{varias && s.branchId ? ` · ${nombreSucursal(branches, s.branchId)}` : ''}
                    {chocaCon(ocupadoGoogle, s.startTime, s.endTime) ? ' · ocupado en Google' : ''}
                  </option>
                ))}
              </select>
              <ErrorDeCampo error={errorCampo} campo="startTime" />
            </div>
          </div>

          {diaBloqueado && (
            <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
              <Icon name="lock" /> Bloqueaste {slot ? 'este horario' : 'este día'}. Podés agendar igual, pero online nadie puede reservar ahí.
            </div>
          )}

          {googleBloquea && ocupadoGoogle.length > 0 && !chocaGoogle && (
            <p className="text-sm text-muted" style={{ marginTop: -6, marginBottom: 'var(--space-md)' }}>
              <Icon name="calendar" /> Los horarios ocupados en el Google Calendar de {nombreDelProfesional || 'este profesional'} no
              se pueden elegir: así lo configuró en su tarjeta de Google Calendar.
            </p>
          )}

          {chocaGoogle && !googleBloquea && (
            <div className="notice notice-warn" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
              <Icon name="calendar" /> {nombreDelProfesional || 'El profesional'} tiene algo anotado en su <strong>Google Calendar</strong> en
              este horario. Eligió que sus actividades no bloqueen turnos, así que podés agendar igual.
            </div>
          )}

          {chocaGoogle && googleBloquea && (
            <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
              <Icon name="calendar" /> Este turno quedó encima de algo que {nombreDelProfesional || 'el profesional'} anotó
              después en su <strong>Google Calendar</strong>. Podés dejarlo en este horario o moverlo a otro libre.
            </div>
          )}

          {!editando && (
            <div className="form-group turno-fijo-opciones">
              <label className="form-label"><Icon name="calendar" /> Repetir</label>
              <select className="form-input" value={repetir} onChange={(e) => setRepetir(e.target.value)}>
                <option value="">No se repite (un solo turno)</option>
                {opcionesFrecuencia(form.date).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {repetir && (
                <>
                  <div className="turno-fijo-hasta">
                    <select className="form-input" value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta cuándo">
                      <option value="siempre">Sin fecha de fin</option>
                      <option value="meses">Durante un tiempo…</option>
                      <option value="fecha">Hasta una fecha…</option>
                    </select>
                    {hasta === 'meses' && (
                      <select className="form-input" value={meses} onChange={(e) => setMeses(Number(e.target.value))} aria-label="Cuántos meses">
                        {[1, 2, 3, 4, 6, 9, 12].map((m) => <option key={m} value={m}>{m === 1 ? '1 mes' : `${m} meses`}</option>)}
                      </select>
                    )}
                    {hasta === 'fecha' && (
                      <input type="date" className="form-input" {...errorCampo.campo('fechaFin')} min={form.date} value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} aria-label="Hasta qué fecha" />
                    )}
                  </div>
                  <ErrorDeCampo error={errorCampo} campo="fechaFin" />
                  <p className="text-xs text-muted" style={{ marginTop: 6 }}>
                    {slot
                      ? <>Queda <strong>{describirTurnoFijo({ frecuencia: repetir, fechaInicio: form.date, hora: slot.startTime })}</strong>. </>
                      : null}
                    Se agendan las próximas 8 semanas y el resto se va sumando solo. Si una fecha cae en un día bloqueado,
                    un feriado que cerrás o un horario ocupado, se saltea y te avisamos.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Nombre del cliente</label>
            <input className="form-input" {...errorCampo.campo('clientName')} value={form.clientName} onChange={set('clientName')} placeholder="Juan Pérez" maxLength={120} />
            <ErrorDeCampo error={errorCampo} campo="clientName" />
          </div>

          <div className="form-group">
            <label className="form-label">Teléfono (opcional)</label>
            <input
              className="form-input"
              type="tel"
              {...errorCampo.campo('clientPhone')}
              value={form.clientPhone}
              onChange={set('clientPhone')}
              placeholder="11 1234-5678"
              style={!telefonoOk ? { borderColor: 'var(--danger)' } : undefined}
            />
            {!telefonoOk && errorCampo.problema?.campo !== 'clientPhone' && (
              <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
                Tiene que tener entre 10 y 13 dígitos, o dejalo vacío.
              </p>
            )}
            <ErrorDeCampo error={errorCampo} campo="clientPhone" />
          </div>

          <div className="form-group">
            <label className="form-label">Mail (opcional)</label>
            <input
              className="form-input"
              type="email"
              inputMode="email"
              {...errorCampo.campo('clientEmail')}
              value={form.clientEmail}
              onChange={set('clientEmail')}
              placeholder="cliente@gmail.com"
              maxLength={120}
            />
            <ErrorDeCampo error={errorCampo} campo="clientEmail" />
            <p className="text-xs text-muted" style={{ marginTop: 4 }}>Si lo cargás, le llega un recordatorio por mail unas horas antes del turno.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Nota (opcional)</label>
            <input className="form-input" value={form.notes} onChange={set('notes')} placeholder="Viene con el hijo" maxLength={500} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
            {editando
              ? (guardando ? 'Guardando…' : 'Guardar cambios')
              : guardando
                ? 'Agendando…'
                : repetir ? 'Agendar turno fijo' : slot ? `Agendar ${slot.startTime}` : 'Agendar'}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
