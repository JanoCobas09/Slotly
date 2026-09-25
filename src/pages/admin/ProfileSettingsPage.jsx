import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  updateInSubcollection,
  replaceMatching,
  getStaffContacts,
  saveStaffContact,
} from '../../lib/repository';
import { useTenant } from '../../hooks/useTenantData';
import { getDayName } from '../../utils/dateUtils';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { capitalize } from '../../utils/text';
import Icon from '../../components/Icon';
import { validarProfesional, validarFranjas, LIMITES } from '../../utils/validaciones';
import HorarioSemanal from '../../components/admin/HorarioSemanal';
import { diasDesdeSchedules, schedulesDesdeDias } from '../../utils/horarioSemanal';

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const { professionals, schedules, businessId } = useTenant();
  const { terminology } = useBusinessContext();
  const [guardando, setGuardando] = useState(false);
  const [saved, setSaved] = useState(false);

  const profId = user?.professionalId;
  const professional = professionals.find(p => p.id === profId);

  // Mismo criterio que SettingsPage: no se guarda una copia del profesional en
  // el estado, solo LOS CAMBIOS superpuestos sobre el dato vivo. Con una copia,
  // si el dueño editaba el perfil mientras el barbero lo tenía abierto, Guardar
  // revertía el cambio del dueño sin avisar.
  const [cambios, setCambios] = useState({});
  // El teléfono y el mail no están en el documento del profesional (ese es de
  // lectura pública): se traen del privado.
  const [contacto, setContacto] = useState({ phone: '', email: '' });

  const form = {
    name: professional?.name || '',
    specialty: professional?.specialty || '',
    bio: professional?.bio || '',
    ...contacto,
    ...cambios,
  };
  const editar = (patch) => setCambios((c) => ({ ...c, ...patch }));

  useEffect(() => {
    if (!businessId || !profId) return;
    let vigente = true;
    getStaffContacts(businessId)
      .then((c) => {
        if (!vigente) return;
        const mio = c[profId] || {};
        setContacto({ phone: mio.phone || '', email: mio.email || '' });
      })
      .catch((err) => console.error('[ProfileSettings] No se pudo leer el contacto:', err));
    return () => { vigente = false; };
  }, [businessId, profId]);

  // Horario: mismo criterio que los datos de arriba — sigue al dato vivo
  // hasta que el profesional toca algo. Antes se copiaba una sola vez al
  // montar: si `schedules` todavía no había llegado (entrar directo a esta
  // URL, recargar), el formulario arrancaba con todos los días apagados y
  // Guardar le borraba el horario entero. Y era de una franja por día: la
  // segunda franja de un horario cortado se perdía al guardar.
  const [horarioEditado, setHorarioEditado] = useState(null);
  const dias = horarioEditado ?? diasDesdeSchedules(schedules.filter(s => s.professionalId === profId));

  if (!profId || !professional) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}><Icon name="warning" /></div>
        <h3>Perfil No Vinculado</h3>
        <p className="text-secondary mt-sm">
          Esta cuenta de administrador no está vinculada a ningún perfil de profesional.
          Contacta al dueño del negocio para asociar tu correo de Google a tu perfil.
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    if (!businessId || !profId) return;
    // Todo antes de escribir: se guarda en tres pasos (ficha, contacto,
    // horarios) y un rechazo a mitad de camino dejaba cambios a medias.
    const errorDatos = validarProfesional(form)
      || dias.filter((d) => d.isActive).map((d) => validarFranjas(d.franjas, getDayName(d.dayOfWeek))).find(Boolean);
    if (errorDatos) {
      alert(errorDatos);
      return;
    }
    setGuardando(true);
    try {
      // El contacto va aparte: el documento del profesional es público.
      const { phone, email, ...publico } = form;
      await updateInSubcollection(businessId, 'professionals', profId, { ...publico });
      await saveStaffContact(businessId, profId, { phone, email });
      // El contacto ya está guardado: pasa a ser el valor de base, y el overlay
      // de cambios se vacía para que el formulario siga el dato vivo otra vez.
      setContacto({ phone, email });
      setCambios({});
      // Los horarios se reemplazan enteros: lo natural es "estos son los que
      // quedan", no ir agregando y borrando día por día.
      await replaceMatching(
        businessId,
        'schedules',
        'professionalId',
        profId,
        schedulesDesdeDias(dias, profId)
      );
      setHorarioEditado(null);
    } catch (err) {
      console.error('[ProfileSettings] No se pudo guardar:', err);
      alert('No se pudieron guardar los cambios: ' + err.message);
      setGuardando(false);
      return;
    }
    setGuardando(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Mi Configuración</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Tus datos personales y tus horarios de trabajo.
          </p>
        </div>
        {saved && <span className="badge badge-success"><Icon name="check-circle" /> Cambios Guardados</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
        {/* Columna Izquierda: Información de Perfil */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Datos Personales</h3>
            <div className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Nombre Completo <span className="required">*</span></label>
                <input
                  className="form-input"
                  value={form.name}
                  maxLength={LIMITES.nombre}
                  onChange={e => editar({ name: e.target.value })}
                  placeholder="Tu nombre"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Especialidad</label>
                <input
                  className="form-input"
                  value={form.specialty}
                  maxLength={LIMITES.especialidad}
                  onChange={e => editar({ specialty: e.target.value })}
                  placeholder={`Ej: ${capitalize(terminology.professionalNoun)} Senior`}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input
                    className="form-input"
                    type="tel"
                    value={form.phone}
                    maxLength={LIMITES.telefono}
                    onChange={e => editar({ phone: e.target.value })}
                    placeholder="+54 11 ..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email de Contacto</label>
                  <input
                    className="form-input"
                    type="email"
                    value={form.email}
                    maxLength={LIMITES.email}
                    onChange={e => editar({ email: e.target.value })}
                    placeholder="email@correo.com"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Biografía / Presentación</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: 100, resize: 'vertical' }}
                  value={form.bio}
                  maxLength={LIMITES.textoLargo}
                  onChange={e => editar({ bio: e.target.value })}
                  placeholder="Contales a tus clientes sobre tu experiencia…"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Mi Agenda Semanal */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Mi Horario de Trabajo</h3>
            <p className="text-secondary text-sm mb-md">
              Los días de la semana y las horas en las que atendés. Para horario cortado, agregá más de una franja el mismo día — ej. de 9 a 13 y de 17 a 20.
            </p>
            <HorarioSemanal dias={dias} onChange={setHorarioEditado} />
          </div>

          <div className="flex gap-sm mt-lg justify-end">
            <button 
              className="btn btn-primary btn-lg" 
              onClick={handleSave}
              disabled={!form.name.trim() || guardando}
            >
              <Icon name="save" /> Guardar Mi Configuración
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
