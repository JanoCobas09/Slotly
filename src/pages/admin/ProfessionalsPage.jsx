import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import {
  addToSubcollection,
  updateInSubcollection,
  removeFromSubcollection,
  replaceMatching,
  getStaffContacts,
  saveStaffContact,
  removeStaffContact,
  uploadProfessionalPhoto,
  removeProfessionalPhoto,
} from '../../lib/repository';
import { getDayName } from '../../utils/dateUtils';
import { getPlan } from '../../config/plans';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { capitalize } from '../../utils/text';
import Icon from '../../components/Icon';
import { validarProfesional, validarFranjas, LIMITES } from '../../utils/validaciones';
import HorarioSemanal from '../../components/admin/HorarioSemanal';
import { diasDesdeSchedules, schedulesDesdeDias } from '../../utils/horarioSemanal';
import PrimerosPasos from '../../components/admin/PrimerosPasos';
import { sucursalesActivas, sucursalPrincipal, hayVariasSucursales, sucursalesDeProfesional } from '../../utils/sucursales';

// Mismo número que la landing y el resto del panel.
const LINK_AMPLIAR = 'https://wa.me/5492257660073?text=' +
  encodeURIComponent('Hola! Necesito sumar más profesionales a mi cuenta.');

export default function ProfessionalsPage() {
  const { professionals, schedules, professionalServices, services, businessId, business, branches } = useTenant();
  const { terminology } = useBusinessContext();
  const profesionalPlural = `${terminology.professionalNoun}s`;

  // Límite de profesionales del plan contratado. `maxProfessionals: null` = sin
  // tope. `plan` sale de la tabla estática PLANS (plans.js) por `planId`, no
  // de un documento de Firestore, así que no hace falta un fallback a un
  // nombre de campo viejo acá: alcanza con que PLANS use el nombre nuevo.
  //
  // Se cuentan solo los activos: uno que se fue no debería ocuparle un lugar
  // al que entra. Y se compara al AGREGAR, no al editar, para que un negocio
  // que ya está por encima del límite —porque le bajaron el plan— pueda
  // seguir administrando a los que tiene en vez de quedar trabado.
  //
  // Esto es un límite comercial, no una barrera de seguridad: vive en la
  // interfaz. Alguien con la consola abierta podría saltearlo, igual que
  // cualquier tope de plan en una app de browser. Lo que protege los datos son
  // las Rules, y este número no es un dato a proteger.
  const plan = getPlan(business?.planId);
  const topeProfesionales = plan?.maxProfessionals ?? null;
  const activos = professionals.filter((p) => p.isActive !== false).length;
  const llegoAlTope = topeProfesionales !== null && activos >= topeProfesionales;

  const [guardando, setGuardando]     = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState({ name: '', specialty: '', phone: '', email: '', bio: '' });
  const [editSchedules, setEditSchedules] = useState([]);
  const [editServices, setEditServices]   = useState([]); // serviceIds seleccionados

  // Foto de perfil. Se elige en el modal pero se sube recién al Guardar: un
  // profesional nuevo todavía no tiene id (y el path del archivo lo usa), y
  // así "Cancelar" no deja una foto subida a medias. `preview` es lo que se
  // ve en el modal: la URL guardada, o la del archivo recién elegido.
  const FOTO_VACIA = { archivo: null, preview: null, quitar: false };
  const [foto, setFoto] = useState(FOTO_VACIA);
  const [errorFoto, setErrorFoto] = useState('');
  const inputFotoRef = useRef(null);

  const elegirFoto = (ev) => {
    const file = ev.target.files?.[0];
    if (inputFotoRef.current) inputFotoRef.current.value = '';
    if (!file) return;
    setErrorFoto('');
    if (!file.type.startsWith('image/')) { setErrorFoto('Tiene que ser una imagen.'); return; }
    if (file.size > 5 * 1024 * 1024) { setErrorFoto('La imagen no puede pesar más de 5 MB.'); return; }
    setFoto({ archivo: file, preview: URL.createObjectURL(file), quitar: false });
  };
  const quitarFoto = () => setFoto({ archivo: null, preview: null, quitar: true });

  // El teléfono y el mail del staff NO viven en el documento del profesional:
  // ese es de lectura pública. Se traen aparte, del documento privado.
  const [contactos, setContactos] = useState({});
  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    getStaffContacts(businessId)
      .then((c) => { if (vigente) setContactos(c); })
      .catch((err) => console.error('[ProfessionalsPage] No se pudo leer el contacto del staff:', err));
    return () => { vigente = false; };
  }, [businessId]);

  const activeServices = services.filter(s => s.isActive);

  // ── Abrir modal NUEVO ──────────────────────────────────────────────────────
  // Cada día tiene una lista de "franjas" (bloques de trabajo), no un único
  // horario con un descanso: un franja de 9 a 13 y otra de 14 a 19 ES el
  // horario cortado, sin un concepto de "descanso" aparte. Ver handleSave y
  // openEdit para cómo esto convive con horarios viejos (un solo bloque con
  // breakStart/breakEnd) que ya estaban guardados así.
  // Sin al menos un servicio activo, el paso "Servicios que ofrece" del
  // formulario queda vacío y el profesional termina sin nada asignado — hay
  // que crear el servicio antes, no dejar que alguien arranque a cargar
  // nombre/horarios para descubrir esto recién al final.
  const sinServicios = activeServices.length === 0;

  const openAdd = () => {
    if (llegoAlTope || sinServicios) return;
    setEditing(null);
    setForm({ name: '', specialty: '', phone: '', email: '', bio: '' });
    setFoto(FOTO_VACIA);
    setErrorFoto('');
    setEditSchedules(Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i,
      isActive: i < 6,
      franjas: i < 5
        ? [{ startTime: '09:00', endTime: '13:00' }, { startTime: '14:00', endTime: '19:00' }]
        : i === 5
          ? [{ startTime: '09:00', endTime: '14:00' }]
          : [{ startTime: '', endTime: '' }],
    })));
    // Por defecto seleccionar TODOS los servicios activos
    setEditServices(activeServices.map(s => s.id));
    setShowModal(true);
  };

  // Llegó desde "Primeros pasos" (?nuevo=1): el alta abierta, apenas estén
  // los servicios (el alta los necesita para "Servicios que ofrece").
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('nuevo') !== '1' || sinServicios) return;
    setParams({}, { replace: true });
    openAdd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinServicios]);

  // ── Abrir modal EDITAR ─────────────────────────────────────────────────────
  const openEdit = (prof) => {
    setEditing(prof);
    setFoto({ archivo: null, preview: prof.avatarUrl || null, quitar: false });
    setErrorFoto('');
    const contacto = contactos[prof.id] || {};
    setForm({ name: prof.name, specialty: prof.specialty || '', phone: contacto.phone || '', email: contacto.email || '', bio: prof.bio || '' });
    setEditSchedules(diasDesdeSchedules(schedules.filter(s => s.professionalId === prof.id)));
    // Servicios ya asignados a este profesional
    const assigned = professionalServices
      .filter(ps => ps.professionalId === prof.id)
      .map(ps => ps.serviceId);
    setEditServices(assigned);
    setShowModal(true);
  };

  // ── Toggle servicio ────────────────────────────────────────────────────────
  const toggleService = (srvId) => {
    setEditServices(prev =>
      prev.includes(srvId) ? prev.filter(id => id !== srvId) : [...prev, srvId]
    );
  };

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim() || !businessId) return;
    // Se valida TODO antes de escribir nada: el guardado son varios pasos
    // (ficha, contacto, horarios, servicios) y un rechazo de la base a mitad
    // de camino dejaba al profesional guardado a medias.
    const errorDatos = validarProfesional(form)
      || editSchedules.filter((d) => d.isActive).map((d) => validarFranjas(d.franjas, getDayName(d.dayOfWeek))).find(Boolean);
    if (errorDatos) {
      alert(errorDatos);
      return;
    }

    setGuardando(true);
    try {
      // Se parte en dos a propósito: el documento del profesional es de lectura
      // pública (lo necesita la página de reservas), así que el teléfono y el
      // mail personales van al documento privado del negocio.
      const { phone, email, ...publico } = form;

      const profId = editing
        ? editing.id
        : await addToSubcollection(businessId, 'professionals', {
            ...publico,
            avatarUrl: null,
            isActive: true,
          });

      if (editing) {
        await updateInSubcollection(businessId, 'professionals', profId, { ...publico });
      }

      // Foto: se sube una nueva, o se borra la que había si la quitaron.
      if (foto.archivo) {
        const url = await uploadProfessionalPhoto(businessId, profId, foto.archivo);
        await updateInSubcollection(businessId, 'professionals', profId, { avatarUrl: url });
      } else if (foto.quitar && editing?.avatarUrl) {
        await removeProfessionalPhoto(businessId, profId);
        await updateInSubcollection(businessId, 'professionals', profId, { avatarUrl: null });
      }

      await saveStaffContact(businessId, profId, { phone, email });
      setContactos((prev) => ({ ...prev, [profId]: { phone, email } }));

      // Horarios y servicios asignados se reemplazan enteros: lo natural acá es
      // "estos son los que quedan", no ir agregando y borrando de a uno.
      // Un día inactivo no deja ningún documento (nada que buscar ahí);  un
      // día activo deja un documento simple POR FRANJA — nunca breakStart/
      // breakEnd, eso solo puede venir de datos viejos sin resguardar.
      const schedulesAGuardar = schedulesDesdeDias(editSchedules, profId);

      await replaceMatching(
        businessId,
        'schedules',
        'professionalId',
        profId,
        schedulesAGuardar
      );

      await replaceMatching(
        businessId,
        'professionalServices',
        'professionalId',
        profId,
        editServices.map((serviceId) => ({
          professionalId: profId,
          serviceId,
          customPrice: null,
          customDuration: null,
        }))
      );

      setShowModal(false);
    } catch (err) {
      console.error('[ProfessionalsPage] No se pudo guardar:', err);
      alert('No se pudo guardar el profesional: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  // ── Eliminar ───────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este profesional? También se eliminarán sus horarios y servicios asignados.')) return;
    try {
      // Firestore no borra en cascada: hay que limpiar lo que cuelga del profesional.
      await replaceMatching(businessId, 'schedules', 'professionalId', id, []);
      await replaceMatching(businessId, 'professionalServices', 'professionalId', id, []);
      await removeStaffContact(businessId, id);
      await removeFromSubcollection(businessId, 'professionals', id);
      // La foto, si tenía. Un fallo acá no deshace el borrado: queda un
      // archivo huérfano en el bucket, nada que el usuario tenga que ver.
      removeProfessionalPhoto(businessId, id).catch((err) =>
        console.error('[ProfessionalsPage] No se pudo borrar la foto:', err));
      setContactos((prev) => { const { [id]: _, ...resto } = prev; return resto; });
    } catch (err) {
      console.error('[ProfessionalsPage] No se pudo eliminar:', err);
      alert('No se pudo eliminar: ' + err.message);
    }
  };

  // ── Horario helpers ────────────────────────────────────────────────────────

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Profesionales</h1>
          {topeProfesionales !== null && (
            <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
              {activos} de {topeProfesionales} {topeProfesionales === 1 ? 'lugar usado' : 'lugares usados'} en tu plan
            </p>
          )}
        </div>
        <button className="btn btn-primary" onClick={openAdd} disabled={llegoAlTope || sinServicios}>
          + Agregar Profesional
        </button>
      </div>

      <PrimerosPasos variante="pagina" />

      {llegoAlTope && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          <strong>Llegaste al tope de tu plan.</strong> Incluye{' '}
          {topeProfesionales === 1 ? `1 ${terminology.professionalNoun}` : `${topeProfesionales} ${profesionalPlural}`} y ya los
          tenés cargados. Para sumar más,{' '}
          <a href={LINK_AMPLIAR} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
            escribinos y ampliamos tu cuenta
          </a>
          . Si alguien dejó de trabajar con vos, desactivalo y se libera el lugar.
        </div>
      )}

      {!llegoAlTope && sinServicios && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          <strong>Primero cargá al menos un servicio.</strong> El paso
          "Servicios que ofrece" del alta de profesional necesita algo para
          ofrecer — andá a <strong>Servicios</strong> y creá el primero antes
          de seguir.
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Profesional</th>
              <th className="oculta-mobile">Especialidad</th>
              <th>Servicios</th>
              <th className="oculta-mobile">Días</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {professionals.map(prof => {
              const profPS      = professionalServices.filter(ps => ps.professionalId === prof.id);
              const profSched   = schedules.filter(s => s.professionalId === prof.id && s.isActive);
              const srvNames    = profPS.map(ps => services.find(s => s.id === ps.serviceId)?.name).filter(Boolean);
              // Un día puede tener más de una franja (horario cortado): se
              // cuenta una sola vez cada uno, no una por franja.
              const diasTrabajados = [...new Set(profSched.map(s => s.dayOfWeek))].sort((a, b) => a - b);
              const days        = diasTrabajados.map(d => getDayName(d).substring(0, 3)).join(', ');
              return (
                <tr key={prof.id}>
                  <td>
                    <div className="flex items-center gap-sm">
                      <div className="avatar avatar-sm">
                        {prof.avatarUrl ? <img src={prof.avatarUrl} alt={prof.name} /> : prof.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <strong>{prof.name}</strong>
                    </div>
                  </td>
                  <td className="oculta-mobile">{prof.specialty}</td>
                  <td>
                    <span className="text-sm text-secondary">
                      {srvNames.length > 0 ? `${srvNames.length} servicio${srvNames.length !== 1 ? 's' : ''}` : (
                        <span style={{ color: 'var(--danger)', fontWeight: 600 }}><Icon name="warning" /> Sin servicios</span>
                      )}
                    </span>
                  </td>
                  <td className="oculta-mobile">
                    <span className="text-sm">{days}</span>
                    {hayVariasSucursales(branches) && (
                      <div className="text-xs text-muted">
                        {sucursalesDeProfesional(branches, schedules, prof.id).map((b) => b.name).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${prof.isActive ? 'badge-success' : 'badge-neutral'}`}>
                      {prof.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(prof)}><Icon name="edit" /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(prof.id)}><Icon name="trash" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {professionals.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Icon name="users" /></div>
            <p style={{ marginBottom: 'var(--space-md)' }}>
              {sinServicios
                ? 'Antes de cargar un profesional, creá al menos un servicio en la sección Servicios — sin eso no hay nada para asignarle.'
                : 'Todavía no hay profesionales. Sin al menos uno cargado, el link público no puede mostrar horarios disponibles.'}
            </p>
            <button className="btn btn-primary" onClick={openAdd} disabled={llegoAlTope || sinServicios}>
              + Agregar el primero
            </button>
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'Editar Profesional' : 'Agregar Profesional'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}><Icon name="x" /></button>
            </div>

            <div className="modal-body">
              <div className="flex flex-col gap-md">

                {/* ─ Foto de perfil ─ */}
                <div className="form-group">
                  <label className="form-label">Foto de perfil</label>
                  <div className="flex items-center gap-md">
                    <div className="avatar avatar-lg" style={{ flexShrink: 0 }}>
                      {foto.preview
                        ? <img src={foto.preview} alt={form.name || 'Foto'} />
                        : (form.name.trim() ? form.name.trim().split(/s+/).map(n => n[0]).join('').slice(0, 2) : <Icon name="user" />)}
                    </div>
                    <div className="flex flex-col gap-sm">
                      <div className="flex gap-sm">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => inputFotoRef.current?.click()} disabled={guardando}>
                          {foto.preview ? 'Cambiar foto' : 'Subir foto'}
                        </button>
                        {foto.preview && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={quitarFoto} disabled={guardando}>
                            Quitar
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted">
                        La ven tus clientes al elegir con quién atenderse. JPG o PNG, hasta 5 MB.
                      </p>
                      {errorFoto && <p className="text-xs" style={{ color: 'var(--danger)' }}>{errorFoto}</p>}
                    </div>
                    <input ref={inputFotoRef} type="file" accept="image/*" onChange={elegirFoto} style={{ display: 'none' }} />
                  </div>
                </div>

                {/* ─ Datos básicos ─ */}
                <div className="form-group">
                  <label className="form-label">Nombre <span className="required">*</span></label>
                  <input
                    className="form-input"
                    value={form.name}
                    maxLength={LIMITES.nombre}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Nombre completo"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Especialidad</label>
                  <input
                    className="form-input"
                    value={form.specialty}
                    maxLength={LIMITES.especialidad}
                    onChange={e => setForm({ ...form, specialty: e.target.value })}
                    placeholder={`Ej: ${capitalize(terminology.professionalNoun)} Senior`}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input className="form-input" type="tel" value={form.phone} maxLength={LIMITES.telefono} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email} maxLength={LIMITES.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                  </div>
                </div>

                {/* ─ Servicios ─ */}
                <div>
                  <h3 style={{ marginBottom: 'var(--space-sm)' }}>Servicios que ofrece</h3>
                  {activeServices.length === 0 ? (
                    <p className="text-sm text-muted">No hay servicios activos configurados.</p>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 'var(--space-sm)',
                    }}>
                      {activeServices.map(srv => {
                        const checked = editServices.includes(srv.id);
                        return (
                          <label
                            key={srv.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-md)',
                              border: `1.5px solid ${checked ? 'var(--primary)' : 'var(--border-color)'}`,
                              background: checked ? 'var(--primary-light)' : 'var(--bg-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                              userSelect: 'none',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleService(srv.id)}
                              style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: checked ? 600 : 400, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {srv.name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                <Icon name="clock" /> {srv.durationMinutes} min
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {editServices.length === 0 && (
                    <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
                      <Icon name="warning" /> Sin servicios asignados — el profesional no aparecerá como disponible para reservas.
                    </p>
                  )}
                </div>

                {/* ─ Horario ─ */}
                <div>
                  <h3 style={{ marginBottom: 4 }}>Horario de Trabajo</h3>
                  <p className="text-xs text-muted" style={{ marginBottom: 'var(--space-sm)' }}>
                    Para horario cortado, agregá más de una franja el mismo día — ej. de 9 a 13 y de nuevo de 17 a 21.
                  </p>
                  <HorarioSemanal
                    dias={editSchedules}
                    onChange={setEditSchedules}
                    diaCorto
                    sucursales={sucursalesActivas(branches)}
                    sucursalPorDefecto={sucursalPrincipal(branches)?.id || null}
                  />
                </div>

              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancelar</button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.name.trim() || guardando}
              >
                {guardando ? 'Guardando…' : <><Icon name="save" /> Guardar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
