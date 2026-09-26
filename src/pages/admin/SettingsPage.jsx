import { useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { updateBusiness, uploadBusinessLogo, removeBusinessLogo } from '../../lib/repository';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { applyTheme } from '../../config/theme';
import Icon from '../../components/Icon';
import SenaMercadoPagoCard from '../../components/admin/SenaMercadoPagoCard';
import { validarNegocio, normalizarInstagram, problema, LIMITES } from '../../utils/validaciones';
import PrimerosPasos from '../../components/admin/PrimerosPasos';
import HorarioAtencion from '../../components/admin/HorarioAtencion';
import ErrorDeCampo from '../../components/ErrorDeCampo';
import { useErrorDeCampo } from '../../hooks/useErrorDeCampo';
import { useBusiness } from '../../contexts/BusinessContext';
import { tieneDatosDeContacto, guiaOculta, FALTA_CONTACTO } from '../../utils/primerosPasos';

const defaultHours = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '', endTime: '', isActive: false },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { business, businessId } = useCurrentBusiness();
  const { terminology, theme: resolvedTheme } = useBusinessContext();
  const { dispatch } = useBusiness();
  const errorCampo = useErrorDeCampo();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [errorFoto, setErrorFoto] = useState('');
  const inputFotoRef = useRef(null);

  // No se guarda una copia del negocio en el estado, solo LOS CAMBIOS del
  // usuario superpuestos sobre el dato vivo.
  //
  // Con una copia (`useState({...business})`) el formulario quedaba clavado en
  // el valor del primer render: si el negocio cambiaba por snapshot mientras
  // estaba abierto —lo edita otro admin, o vos desde el panel global—, Guardar
  // mandaba el estado viejo y revertía el cambio del otro sin que nadie se
  // entere. Así, los campos que el usuario no tocó se actualizan solos y los
  // que tocó ganan.
  const [cambios, setCambios] = useState({});
  const form = {
    ...business,
    businessHours: business?.businessHours || defaultHours,
    ...cambios,
  };
  const editar = (patch) => setCambios((c) => ({ ...c, ...patch }));

  const handleSave = async () => {
    if (!businessId) return;
    setError('');
    // Solo se manda lo que la persona cambió (ver el comentario de `cambios`).
    // Mandar el formulario entero pisaba lo que otro había cambiado mientras
    // tanto y, desde el panel global, arrastraba la facturación que viene
    // pegada al negocio (columnas que `businesses` no tiene).
    const aGuardar = { ...cambios };
    if (aGuardar.socialLinks) {
      aGuardar.socialLinks = { ...aGuardar.socialLinks, instagram: normalizarInstagram(aGuardar.socialLinks.instagram) };
    }
    // Sin horario guardado todavía, el de pantalla es el de por defecto.
    if (!business?.businessHours) aGuardar.businessHours = form.businessHours;

    const final = { ...form, ...aGuardar };
    if (errorCampo.marcar(validarNegocio(final))) return;
    if (final.depositEnabled) {
      const valor = Number(final.depositValue);
      if (!valor || valor <= 0) return errorCampo.marcar(problema('depositValue', 'Poné de cuánto es la seña, o desactivala.'));
      if (final.depositType !== 'fixed' && valor > 100) return errorCampo.marcar(problema('depositValue', 'La seña no puede ser más del 100% del precio.'));
    }
    errorCampo.limpiar();

    // Todo es opcional para guardar, pero sin ningún dato de contacto el paso
    // 4 de Primeros pasos no se termina: se marca el teléfono (el primero de
    // esos casilleros) diciendo qué falta, en vez de guardar y no avanzar.
    const faltaContacto = user?.role === 'owner' && !guiaOculta(businessId) && !tieneDatosDeContacto(final);
    const avisarContacto = () => errorCampo.marcar(problema('phone', FALTA_CONTACTO));

    // Sin cambios no hay nada que mandar (un UPDATE vacío no toca ninguna fila).
    if (Object.keys(aGuardar).length === 0) {
      if (faltaContacto) return avisarContacto();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      return;
    }

    setGuardando(true);
    try {
      // Las Rules no dejan que el dueño toque su facturación ni se descongele
      // solo; el repositorio filtra esos campos antes de mandar.
      const guardado = await updateBusiness(businessId, aGuardar, { esPlataforma: user?.isPlatformOwner });
      // Al estado ya, sin esperar a Realtime: sin esto, si el canal estaba
      // caído el formulario volvía a mostrar lo viejo y la guía de Primeros
      // pasos no avanzaba hasta recargar.
      if (guardado) dispatch({ type: 'PATCH_BUSINESS', payload: { id: businessId, cambios: guardado } });
    } catch (err) {
      console.error('[SettingsPage] No se pudo guardar:', err);
      setError('No se pudieron guardar los cambios: ' + err.message);
      setGuardando(false);
      return;
    }
    setGuardando(false);
    // Guardado: los cambios ya son parte del negocio, así que el overlay se
    // vacía y el formulario vuelve a seguir el dato vivo.
    setCambios({});
    // Mismo camino que useBusinessContext(): un solo lugar que sabe pintar el
    // tema, en vez de reescribir las custom properties acá también.
    //
    // OJO: no se le pasa `form` directo. `form` es el documento de negocio
    // (solo primaryColor/secondaryColor/accentColor), nunca tuvo
    // primaryHover/primaryLight — esos viven únicamente en el preset de la
    // categoría (professionPresets.js). Pasarle `form` pisaba esos dos con el
    // default de `theme.js` (naranja SACIA) para CUALQUIER categoría hasta el
    // próximo re-render de useBusinessContext. Se mergea sobre el tema ya
    // resuelto (preset + overrides previos) para conservar hover/light/accent
    // correctos y solo actualizar lo que el formulario realmente edita.
    applyTheme({
      ...resolvedTheme,
      primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor,
      accentColor: form.accentColor,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    if (faltaContacto) avisarContacto();
  };

  // La foto se sube y se guarda al toque, aparte del resto del formulario:
  // es una operación propia (habla con Storage, no solo con Firestore) y no
  // tiene sentido dejarla "a medio subir" esperando que aprieten Guardar
  // Cambios — con eso el archivo ya estaría en el bucket pero `logoUrl`
  // podría quedar desincronizado si la persona navega sin guardar.
  const handleFotoChange = async (ev) => {
    const file = ev.target.files?.[0];
    if (inputFotoRef.current) inputFotoRef.current.value = '';
    if (!file || !businessId) return;

    setErrorFoto('');
    if (!file.type.startsWith('image/')) {
      setErrorFoto('Tiene que ser una imagen.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorFoto('La imagen no puede pesar más de 5 MB.');
      return;
    }

    setSubiendoFoto(true);
    try {
      const url = await uploadBusinessLogo(businessId, file);
      await updateBusiness(businessId, { logoUrl: url }, { esPlataforma: user?.isPlatformOwner });
    } catch (err) {
      console.error('[SettingsPage] No se pudo subir la foto:', err);
      setErrorFoto('No se pudo subir la foto: ' + err.message);
    } finally {
      setSubiendoFoto(false);
    }
  };

  const handleQuitarFoto = async () => {
    if (!businessId || !form.logoUrl) return;
    setSubiendoFoto(true);
    setErrorFoto('');
    try {
      await removeBusinessLogo(businessId);
      await updateBusiness(businessId, { logoUrl: null }, { esPlataforma: user?.isPlatformOwner });
    } catch (err) {
      console.error('[SettingsPage] No se pudo quitar la foto:', err);
      setErrorFoto('No se pudo quitar la foto: ' + err.message);
    } finally {
      setSubiendoFoto(false);
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Configuración</h1>
        {saved && <span className="badge badge-success"><Icon name="check-circle" /> Guardado</span>}
      </div>

      <PrimerosPasos variante="pagina" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
        {/* Left: Form */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Identidad del Negocio</h3>
            <div className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Foto del negocio</label>
                <div className="flex items-center gap-md">
                  <div
                    style={{
                      width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
                      background: form.logoUrl ? `center/cover url(${form.logoUrl})` : 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text-muted)', fontSize: 24,
                    }}
                  >
                    {!form.logoUrl && <Icon name="building" />}
                  </div>
                  <div className="flex flex-col gap-sm">
                    <div className="flex gap-sm">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => inputFotoRef.current?.click()}
                        disabled={subiendoFoto}
                      >
                        {subiendoFoto ? 'Subiendo…' : form.logoUrl ? 'Cambiar foto' : 'Subir foto'}
                      </button>
                      {form.logoUrl && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={handleQuitarFoto}
                          disabled={subiendoFoto}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted">
                      Es lo primero que ve quien entra a tu link a reservar. JPG o PNG, hasta 5 MB.
                    </p>
                  </div>
                  <input
                    ref={inputFotoRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFotoChange}
                    style={{ display: 'none' }}
                  />
                </div>
                {errorFoto && <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>{errorFoto}</p>}
              </div>
              <div className="form-group">
                <label className="form-label">Nombre del negocio</label>
                <input className="form-input" {...errorCampo.campo('name')} value={form.name} maxLength={LIMITES.nombre} onChange={e => editar({ name: e.target.value })} />
                <ErrorDeCampo error={errorCampo} campo="name" />
              </div>
              {/*
                El slug NO es editable desde acá. `updateBusiness` lo filtra para
                quien no es plataforma, así que el campo se veía editable, decía
                "guardado" y no cambiaba nada. Y cambiarlo de verdad tampoco es
                un `update`: hay que mover /slugs/{viejo} a /slugs/{nuevo} en un
                batch, o el link público queda roto. Se muestra como dato.
              */}
              <div className="form-group">
                <label className="form-label">Link público</label>
                <div
                  className="form-input"
                  style={{ background: 'var(--bg-secondary)', fontFamily: 'monospace', fontSize: 13 }}
                >
                  /{form.slug}
                </div>
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Para cambiar tu dirección escribinos: hay que redirigir el link
                  viejo para no dejar afuera a quien ya lo tenga guardado.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Mensaje de bienvenida</label>
                <textarea className="form-input" {...errorCampo.campo('welcomeMessage')} value={form.welcomeMessage || ''} maxLength={LIMITES.textoLargo} onChange={e => editar({ welcomeMessage: e.target.value })} />
                <ErrorDeCampo error={errorCampo} campo="welcomeMessage" />
              </div>
            </div>
          </div>

          <div className="card mt-md">
            <h3 className="mb-lg">Colores</h3>
            <div className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Color primario</label>
                <div className="flex items-center gap-sm">
                  <input type="color" value={form.primaryColor} onChange={e => editar({ primaryColor: e.target.value })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="form-input" {...errorCampo.campo('primaryColor')} value={form.primaryColor || ''} onChange={e => editar({ primaryColor: e.target.value })} style={{ maxWidth: 140 }} />
                </div>
                <ErrorDeCampo error={errorCampo} campo="primaryColor" />
              </div>
              <div className="form-group">
                <label className="form-label">Color secundario</label>
                <div className="flex items-center gap-sm">
                  <input type="color" value={form.secondaryColor} onChange={e => editar({ secondaryColor: e.target.value })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="form-input" {...errorCampo.campo('secondaryColor')} value={form.secondaryColor || ''} onChange={e => editar({ secondaryColor: e.target.value })} style={{ maxWidth: 140 }} />
                </div>
                <ErrorDeCampo error={errorCampo} campo="secondaryColor" />
              </div>
            </div>
          </div>

          <div className="card mt-md">
            <h3 className="mb-lg">Configuración operativa</h3>
            <div className="flex flex-col gap-md">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Moneda</label>
                  <select className="form-input" value={form.currency} onChange={e => editar({ currency: e.target.value })}>
                    <option value="ARS">ARS - Peso Argentino</option>
                    <option value="USD">USD - Dólar</option>
                    <option value="CLP">CLP - Peso Chileno</option>
                    <option value="MXN">MXN - Peso Mexicano</option>
                    <option value="COP">COP - Peso Colombiano</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Cada cuánto se ofrece un{' '}{terminology.appointmentNoun}</label>
                  <select className="form-input" value={form.slotInterval} onChange={e => editar({ slotInterval: parseInt(e.target.value) })}>
                    <option value={15}>Cada 15 minutos</option>
                    <option value={30}>Cada 30 minutos</option>
                    <option value={45}>Cada 45 minutos</option>
                    <option value={60}>Cada 1 hora</option>
                  </select>
                  <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                    Es el paso de la grilla que ve el {terminology.customerNoun}. Con 30, ve 09:00, 09:30, 10:00…
                    La duración de cada {terminology.appointmentNoun} la define el servicio.
                  </p>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Con cuánta anticipación puede cancelar el {terminology.customerNoun}</label>
                <select className="form-input" value={form.minCancelHours || 2} onChange={e => editar({ minCancelHours: parseInt(e.target.value) })}>
                  <option value={1}>1 hora</option>
                  <option value={2}>2 horas</option>
                  <option value={4}>4 horas</option>
                  <option value={12}>12 horas</option>
                  <option value={24}>24 horas</option>
                </select>
                <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                  Más cerca del {terminology.appointmentNoun}, el {terminology.customerNoun} ya no puede cancelarlo solo: te tiene que escribir.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Hasta cuándo pueden reservar</label>
                {/* Vacío = sin límite (lo de siempre). Sirve para no abrir
                    días cuyos horarios todavía no definiste. Lo hace cumplir
                    también la base (trigger), no solo este calendario. */}
                <select
                  className="form-input"
                  value={form.maxAdvanceDays ?? ''}
                  onChange={e => editar({ maxAdvanceDays: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">Sin límite</option>
                  <option value={3}>3 días</option>
                  <option value={7}>1 semana</option>
                  <option value={10}>10 días</option>
                  <option value={14}>2 semanas</option>
                  <option value={21}>3 semanas</option>
                  <option value={30}>1 mes</option>
                  <option value={60}>2 meses</option>
                  <option value={90}>3 meses</option>
                </select>
                <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                  El {terminology.customerNoun} solo ve disponibles los días dentro de ese plazo. Útil si todavía no definiste tus horarios de las semanas que vienen. Los {terminology.appointmentNoun}s que cargás vos desde el panel no tienen límite.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Con cuánta anticipación mínima pueden reservar</label>
                {/* Vacío = sin mínimo (lo de siempre). Lo hace cumplir también
                    la base (trigger enforce_min_advance_hours), no solo la grilla. */}
                <select
                  className="form-input"
                  value={form.minAdvanceHours ?? ''}
                  onChange={e => editar({ minAdvanceHours: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">Sin mínimo</option>
                  <option value={1}>1 hora antes</option>
                  <option value={2}>2 horas antes</option>
                  <option value={3}>3 horas antes</option>
                  <option value={4}>4 horas antes</option>
                  <option value={6}>6 horas antes</option>
                  <option value={12}>12 horas antes</option>
                  <option value={24}>1 día antes</option>
                  <option value={48}>2 días antes</option>
                </select>
                <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                  Con 3 horas, a las 14:00 el {terminology.customerNoun} ya no ve disponible el {terminology.appointmentNoun} de las 16:00. Los {terminology.appointmentNoun}s que cargás vos desde el panel no tienen mínimo.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input className="form-input" type="tel" {...errorCampo.campo('phone')} value={form.phone || ''} maxLength={LIMITES.telefono} onChange={e => editar({ phone: e.target.value })} />
                <ErrorDeCampo error={errorCampo} campo="phone" />
              </div>
              <div className="form-group">
                <label className="form-label">Dirección</label>
                <input className="form-input" {...errorCampo.campo('address')} value={form.address || ''} maxLength={LIMITES.direccion} onChange={e => editar({ address: e.target.value })} />
                <ErrorDeCampo error={errorCampo} campo="address" />
              </div>
              <div className="form-group">
                <label className="form-label">Instagram</label>
                <input
                  className="form-input"
                  placeholder="@mi_negocio"
                  {...errorCampo.campo('instagram')}
                  value={form.socialLinks?.instagram || ''}
                  maxLength={LIMITES.instagram}
                  onChange={e => editar({ socialLinks: { ...form.socialLinks, instagram: e.target.value } })}
                />
                <ErrorDeCampo error={errorCampo} campo="instagram" />
              </div>
              <div className="form-group">
                <label className="form-label">Link de Google Maps</label>
                <input
                  className="form-input"
                  placeholder="https://maps.app.goo.gl/..."
                  {...errorCampo.campo('mapsUrl')}
                  value={form.mapsUrl || ''}
                  maxLength={LIMITES.url}
                  onChange={e => editar({ mapsUrl: e.target.value })}
                />
                <ErrorDeCampo error={errorCampo} campo="mapsUrl" />
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Abrí tu negocio en Google Maps, tocá "Compartir" y pegá el link acá.
                </p>
              </div>
            </div>
          </div>

          {/* Principio de privacidad: la plataforma ve la agenda, no quién
              reserva. La base lo hace cumplir (RLS + turnos_sin_cliente) y
              solo el dueño lo puede cambiar (trigger proteger_privacidad). */}
          <div className="card mt-md">
            <h3 className="mb-sm"><Icon name="lock" /> Principio de privacidad</h3>
            <label className="flex items-center gap-sm" style={{ cursor: user?.role === 'owner' ? 'pointer' : 'default' }}>
              <input
                type="checkbox"
                checked={Boolean(form.privacidadClientes)}
                disabled={user?.role !== 'owner'}
                onChange={(e) => editar({ privacidadClientes: e.target.checked })}
              />
              <span><strong>Activar el principio de privacidad</strong></span>
            </label>
            <p className="text-sm text-secondary" style={{ marginTop: 8 }}>
              Con esto activado, el equipo de Slotly puede ver tu agenda (qué {terminology.appointmentNoun}s hay, a qué hora y de qué servicio)
              pero <strong>no quién los reserva</strong>: ni el nombre, ni el teléfono, ni el mail, ni las notas de tus {terminology.customerNoun}s.
              Tu equipo y vos los siguen viendo igual que siempre.
            </p>
            {user?.role !== 'owner' && (
              <p className="text-xs text-muted" style={{ marginTop: 6 }}>Solo el dueño del negocio lo puede cambiar.</p>
            )}
          </div>

        </div>

        {/* Right: Preview */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Vista Previa</h3>
            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-sm mb-lg" style={{ padding: 'var(--space-sm)' }}>
                {form.logoUrl ? (
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: `center/cover url(${form.logoUrl})`, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                    {form.name?.charAt(0).toUpperCase() || 'S'}
                  </div>
                )}
                <strong>{form.name}</strong>
              </div>
              <p className="text-secondary text-sm mb-md">{form.welcomeMessage}</p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button className="btn btn-sm" style={{ background: form.primaryColor, color: 'white', borderColor: form.primaryColor }}>Reservar</button>
                <button className="btn btn-outline btn-sm">Ver Más</button>
              </div>
              <div className="mt-md">
                <div className="badge" style={{ background: form.primaryColor + '20', color: form.primaryColor }}>Activo</div>
              </div>
            </div>
          </div>
          {/* Abajo de la vista previa y no al final de la columna de la
              izquierda: es de lo más importante de la página y ahí quedaba
              después de todo lo demás. */}
          <div className="card mt-md">
            <h3 className="mb-lg">Horarios de atención</h3>
            <p className="text-secondary text-sm mb-md">Configurá los días y horarios en los que tu negocio se encuentra abierto al público.</p>
            {/* El mismo editor que Sucursales: al prender un día le pone
                horas, en vez de dejarlo vacío y que Guardar lo rechace. */}
            <HorarioAtencion
              dias={form.businessHours}
              onChange={(businessHours) => editar({ businessHours })}
              errorCampo={errorCampo}
            />
            <ErrorDeCampo error={errorCampo} prefijo="horario-" />
          </div>

          <SenaMercadoPagoCard form={form} editar={editar} businessId={businessId} terminology={terminology} errorCampo={errorCampo} />
        </div>
      </div>

      {/* Fuera de las dos columnas: con los horarios a la derecha, en el
          celular (una sola columna) el botón quedaba ARRIBA de ellos. */}
      {error && (
        <div className="notice notice-danger mt-md">{error}</div>
      )}
      <div className="flex items-center gap-sm mt-lg">
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={guardando}>
          {guardando ? 'Guardando…' : <><Icon name="save" /> Guardar Cambios</>}
        </button>
        {/* También acá: el de arriba de todo no se ve desde el botón. */}
        {saved && <span className="badge badge-success"><Icon name="check-circle" /> Guardado</span>}
      </div>
    </div>
  );
}
