import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { updateBusiness, uploadBusinessLogo, removeBusinessLogo } from '../../lib/repository';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { applyTheme } from '../../config/theme';
import Icon from '../../components/Icon';
import SenaMercadoPagoCard from '../../components/admin/SenaMercadoPagoCard';
import GoogleCalendarCard from '../../components/admin/GoogleCalendarCard';
import VistaPreviaReserva from '../../components/admin/VistaPreviaReserva';
import { useTenant } from '../../hooks/useTenantData';
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

// ── Secciones de Configuración ──────────────────────────────────────────────
// Antes era una sola página larga (9 tarjetas, una con 10 campos de cosas
// distintas) y había que scrollear mucho para encontrar algo. Ahora se ve una
// sección a la vez. En la compu, con un menú al costado. En el celular, como
// los Ajustes del teléfono: primero la LISTA de secciones (todas a la vista,
// con lo que tiene cada una), y al tocar una se abre con "← Volver" — pedido
// del usuario: lo usa gente con poco manejo del celular, y una fila de
// pestañas que se desliza escondía secciones. `resumen`: la línea de la
// lista. `campos`: qué claves del negocio se editan en cada una — para
// marcar "sin guardar" y para abrir la sección del campo que falló.
const SECCIONES = [
  {
    id: 'negocio', titulo: 'Tu negocio', icono: 'building',
    resumen: 'Foto, nombre, mensaje de bienvenida y colores',
    descripcion: (t) => `Foto, nombre, mensaje y colores: cómo te ve el ${t.customerNoun} en tu link de reserva.`,
    campos: ['name', 'welcomeMessage', 'primaryColor', 'secondaryColor', 'accentColor', 'logoUrl'],
  },
  {
    id: 'contacto', titulo: 'Contacto y ubicación', icono: 'pin',
    resumen: 'Teléfono, dirección, Instagram y mapa',
    descripcion: (t) => `Cómo te encuentra y te escribe el ${t.customerNoun}. Con un dato alcanza; con el link de Maps aparece el mapa.`,
    campos: ['phone', 'address', 'socialLinks', 'instagram', 'mapsUrl'],
  },
  {
    id: 'horarios', titulo: 'Horarios', icono: 'clock',
    resumen: 'Qué días y a qué hora está abierto, y los feriados',
    descripcion: () => 'Qué días y en qué horario está abierto el local, y si abrís los feriados.',
    campos: ['businessHours', 'feriados'],
  },
  {
    id: 'reservas', titulo: 'Reservas', icono: 'calendar',
    resumen: 'Cómo y con cuánta anticipación te reservan',
    descripcion: (t) => `Las reglas para reservar: quién elige al profesional, cada cuánto hay un ${t.appointmentNoun}, con cuánta anticipación se reserva y se cancela.`,
    campos: ['modoProfesional', 'slotInterval', 'maxAdvanceDays', 'minAdvanceHours', 'minCancelHours'],
  },
  {
    id: 'cobros', titulo: 'Cobros', icono: 'money',
    resumen: 'Moneda y seña con Mercado Pago',
    descripcion: (t) => `La moneda de tus precios y la seña con Mercado Pago para asegurar el ${t.appointmentNoun}.`,
    campos: ['currency', 'depositEnabled', 'depositType', 'depositValue'],
  },
  {
    id: 'integraciones', titulo: 'Google Calendar', icono: 'link',
    resumen: 'Los turnos en el calendario del celular',
    descripcion: () => 'Los turnos de cada profesional en el calendario de su celular, y sus actividades fuera de la agenda. Se guarda al toque.',
    campos: [],
  },
  {
    id: 'privacidad', titulo: 'Privacidad', icono: 'lock',
    resumen: 'Qué ve Slotly de tus clientes',
    descripcion: () => 'Qué puede ver el equipo de Slotly de tus clientes.',
    campos: ['privacidadClientes'],
  },
];

/** La sección donde está un campo del formulario (para mostrar el error ahí). */
function seccionDeCampo(campo) {
  if (!campo) return null;
  if (campo.startsWith('horario-')) return 'horarios';
  return SECCIONES.find((s) => s.campos.includes(campo))?.id || null;
}

/** Ids de las secciones que tienen algo cambiado sin guardar. */
function seccionesConCambios(cambios) {
  return new Set(Object.keys(cambios).map(seccionDeCampo).filter(Boolean));
}

const esSeccion = (id) => SECCIONES.some((s) => s.id === id);

/**
 * Sección pedida al llegar a la pantalla: la del link (?seccion=), o la que
 * corresponde al volver de Mercado Pago (?mp=) o de Google (?gcal=). null =
 * ninguna (en el celular se ve la lista; en la compu, la primera).
 */
function seccionInicial(params) {
  const pedida = params.get('seccion');
  if (esSeccion(pedida)) return pedida;
  if (params.get('mp')) return 'cobros';
  if (params.get('gcal')) return 'integraciones';
  return null;
}

const CONSULTA_CELULAR = '(max-width: 900px)';
/** ¿Pantalla de celular? Mismo corte que el CSS de .config-*. */
function useEsCelular() {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(CONSULTA_CELULAR);
      m.addEventListener('change', avisar);
      return () => m.removeEventListener('change', avisar);
    },
    () => window.matchMedia(CONSULTA_CELULAR).matches,
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { business, businessId } = useCurrentBusiness();
  const { terminology, theme: resolvedTheme } = useBusinessContext();
  const { dispatch } = useBusiness();
  const { professionals, services, professionalServices } = useTenant();
  const errorCampo = useErrorDeCampo();
  const [params, setParams] = useSearchParams();
  const esCelular = useEsCelular();
  // La sección abierta vive en la URL (?seccion=): en el celular, abrir una
  // es una pantalla nueva, así el botón "atrás" del teléfono vuelve a la
  // lista (también en la app instalada: useSalidaDeLaApp lleva la pila por
  // URL). Sin ?seccion=, el celular muestra la lista y la compu la primera.
  const inicial = useRef(seccionInicial(params));
  const seccion = esSeccion(params.get('seccion'))
    ? params.get('seccion')
    : esCelular ? null : (inicial.current || 'negocio');
  // Al volver de Mercado Pago / Google: deja anotada la sección en la URL
  // (las tarjetas borran su ?mp= / ?gcal= al mostrarse). Se lee la URL del
  // momento, no la del render, por si una tarjeta ya la cambió.
  useEffect(() => {
    if (!inicial.current || params.get('seccion')) return;
    const p = new URLSearchParams(window.location.search);
    p.set('seccion', inicial.current);
    setParams(p, { replace: true });
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Abre una sección. `nuevaPantalla`: suma una entrada al historial (celular). */
  const abrirSeccion = (id, { nuevaPantalla = false } = {}) => {
    const p = new URLSearchParams(window.location.search);
    if (id) p.set('seccion', id); else p.delete('seccion');
    setParams(p, { replace: !nuevaPantalla });
    window.scrollTo({ top: 0 });
  };
  // Marca el campo con error y abre su sección: si no, el error quedaba en
  // una sección que no se está viendo y "Guardar" parecía no hacer nada.
  const marcar = (p) => {
    const donde = seccionDeCampo(p?.campo);
    if (donde && donde !== seccion) {
      abrirSeccion(donde, { nuevaPantalla: esCelular });
      // Recién cuando la sección ya está en pantalla: useErrorDeCampo busca
      // el casillero para llevar la vista hasta él y soltar el error cuando
      // lo corrigen; marcado antes, todavía no existía.
      setTimeout(() => errorCampo.marcar(p), 60);
      return Boolean(p);
    }
    return errorCampo.marcar(p);
  };
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
    if (marcar(validarNegocio(final))) return;
    if (final.depositEnabled) {
      const valor = Number(final.depositValue);
      if (!valor || valor <= 0) return marcar(problema('depositValue', 'Poné de cuánto es la seña, o desactivala.'));
      if (final.depositType !== 'fixed' && valor > 100) return marcar(problema('depositValue', 'La seña no puede ser más del 100% del precio.'));
    }
    errorCampo.limpiar();

    // Todo es opcional para guardar, pero sin ningún dato de contacto el paso
    // 4 de Primeros pasos no se termina: se marca el teléfono (el primero de
    // esos casilleros) diciendo qué falta, en vez de guardar y no avanzar.
    const faltaContacto = user?.role === 'owner' && !guiaOculta(businessId) && !tieneDatosDeContacto(final);
    const avisarContacto = () => marcar(problema('phone', FALTA_CONTACTO));

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

  const hayCambios = Object.keys(cambios).length > 0;
  const conCambios = seccionesConCambios(cambios);
  const actual = SECCIONES.find((s) => s.id === seccion) || null;
  const elegirSeccion = (id) => abrirSeccion(id, { nuevaPantalla: esCelular });
  // Celular sin sección abierta: la lista.
  const enLista = !actual;

  // ── Cada sección ─────────────────────────────────────────────────────────
  // La página de reserva real (cabecera + servicios) con lo que se está
  // editando, antes de guardar. Ver VistaPreviaReserva.
  const vistaPrevia = (
    <div className="card" id="vista-previa">
      <h3 className="mb-sm">Así te ve tu {terminology.customerNoun}</h3>
      <VistaPreviaReserva
        negocio={form}
        services={services}
        professionals={professionals}
        professionalServices={professionalServices}
      />
    </div>
  );

  const contenido = {
    negocio: (
      <div className="config-dos-columnas">
        <div>
          {/* En el celular la vista previa queda abajo de los campos: este
              botón baja hasta ella, así no hay que saber que está ahí. */}
          {esCelular && (
            <button
              type="button"
              className="config-ir-vista-previa"
              onClick={() => document.getElementById('vista-previa')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <Icon name="search" /> Ver cómo te ve tu {terminology.customerNoun} <span aria-hidden="true">↓</span>
            </button>
          )}
          <div className="card">
            <h3 className="mb-lg">Identidad</h3>
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
                      Es lo primero que ve quien entra a tu link a reservar. JPG o PNG, hasta 5 MB. Se guarda al toque.
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
        </div>
        <div>{vistaPrevia}</div>
      </div>
    ),

    contacto: (
      <div className="card">
        <div className="flex flex-col gap-md">
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
              Abrí tu negocio en Google Maps, tocá "Compartir" y pegá el link acá. Con eso, en tu link de reserva aparece el mapa y el botón "Cómo llegar".
            </p>
          </div>
        </div>
      </div>
    ),

    horarios: (
      <div className="card">
        {/* El mismo editor que Sucursales: al prender un día le pone
            horas, en vez de dejarlo vacío y que Guardar lo rechace. */}
        <HorarioAtencion
          dias={form.businessHours}
          onChange={(businessHours) => editar({ businessHours })}
          errorCampo={errorCampo}
        />
        <ErrorDeCampo error={errorCampo} prefijo="horario-" />
        <p className="text-xs text-muted" style={{ marginTop: 'var(--space-md)' }}>
          Es el horario del local. El de cada profesional se carga en Profesionales, y las vacaciones en Días bloqueados.
        </p>

        <div className="form-group" style={{ marginTop: 'var(--space-lg)' }}>
          <label className="form-label">Feriados nacionales</label>
          {/* businesses.feriados (20261027000000_turnos_fijos_y_feriados.sql):
              con 'cierra' la base los vuelve días bloqueados solos. */}
          <select className="form-input" value={form.feriados || 'atiende'} onChange={e => editar({ feriados: e.target.value })}>
            <option value="atiende">Atiendo los feriados</option>
            <option value="cierra">Cierro los feriados</option>
          </select>
          <p className="text-sm text-muted" style={{ marginTop: 6 }}>
            {(form.feriados || 'atiende') === 'cierra'
              ? 'Cada feriado se bloquea solo: nadie puede reservar y los turnos fijos se saltean. Si alguno querés abrir, lo abrís en Días bloqueados.'
              : 'Se atiende como un día normal; los feriados solo se marcan en el calendario de Días bloqueados. Si alguno no abrís, lo cerrás ahí.'}
          </p>
        </div>
      </div>
    ),

    reservas: (
      <div className="card">
        <div className="flex flex-col gap-md">
          <div className="form-group">
            <label className="form-label">Quién elige al profesional</label>
            {/* modo_profesional (utils/asignacionProfesional.js). Cuando no
                elige el cliente, se asigna el que tiene menos turnos ese
                día entre los libres en el horario elegido. */}
            <select
              className="form-input"
              value={form.modoProfesional || 'elige'}
              onChange={e => editar({ modoProfesional: e.target.value })}
            >
              <option value="elige">El {terminology.customerNoun} lo elige</option>
              <option value="elige_o_cualquiera">El {terminology.customerNoun} lo elige, o pone &quot;Cualquiera&quot;</option>
              <option value="automatico">Se asigna solo (el {terminology.customerNoun} elige solo el servicio)</option>
            </select>
            <p className="text-sm text-muted" style={{ marginTop: 6 }}>
              {(form.modoProfesional || 'elige') === 'elige'
                ? `El ${terminology.customerNoun} ve la lista de profesionales y elige con quién atenderse.`
                : `Cuando no elige el ${terminology.customerNoun}, ve todos los horarios libres de quienes hacen ese servicio y le asignamos al que tenga menos ${terminology.appointmentNoun}s ese día, para repartir el trabajo. Antes de confirmar ve quién lo va a atender.`}
            </p>
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
        </div>
      </div>
    ),

    cobros: (
      <>
        <div className="card">
          <div className="form-group">
            <label className="form-label">Moneda</label>
            <select className="form-input" value={form.currency} onChange={e => editar({ currency: e.target.value })} style={{ maxWidth: 320 }}>
              <option value="ARS">ARS - Peso Argentino</option>
              <option value="USD">USD - Dólar</option>
              <option value="CLP">CLP - Peso Chileno</option>
              <option value="MXN">MXN - Peso Mexicano</option>
              <option value="COP">COP - Peso Colombiano</option>
            </select>
            <p className="text-sm text-muted" style={{ marginTop: 6 }}>En la que se muestran los precios de tus servicios.</p>
          </div>
        </div>
        <SenaMercadoPagoCard form={form} editar={editar} businessId={businessId} terminology={terminology} errorCampo={errorCampo} />
      </>
    ),

    integraciones: (
      <GoogleCalendarCard businessId={businessId} profesionales={professionals} terminology={terminology} />
    ),

    /* Principio de privacidad: la plataforma ve la agenda, no quién
       reserva. La base lo hace cumplir (RLS + turnos_sin_cliente) y
       solo el dueño lo puede cambiar (trigger proteger_privacidad). */
    privacidad: (
      <div className="card">
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
    ),
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Configuración</h1>
      </div>

      <PrimerosPasos variante="pagina" />

      {enLista ? (
        /* Celular: la lista de secciones, todas a la vista, como los Ajustes
           del teléfono. Botones grandes y con lo que hay adentro. */
        <nav className="config-lista" aria-label="Secciones de Configuración">
          {SECCIONES.map((s) => (
            <button key={s.id} type="button" className="config-lista-item" onClick={() => elegirSeccion(s.id)}>
              <span className="config-lista-icono"><Icon name={s.icono} /></span>
              <span className="config-lista-texto">
                <strong>{s.titulo}</strong>
                <span>{s.resumen}</span>
              </span>
              {conCambios.has(s.id) && <span className="badge badge-warning">Sin guardar</span>}
              <Icon name="chevron-right" className="config-lista-flecha" />
            </button>
          ))}
        </nav>
      ) : (
        <div className="config-layout">
          {/* Compu: menú al costado. El punto marca las secciones con
              cambios sin guardar. En el celular no se muestra (está la lista). */}
          <nav className="config-nav" aria-label="Secciones de Configuración">
            {SECCIONES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`config-nav-item ${s.id === actual.id ? 'activo' : ''}`}
                aria-current={s.id === actual.id ? 'page' : undefined}
                onClick={() => elegirSeccion(s.id)}
              >
                <Icon name={s.icono} />
                <span>{s.titulo}</span>
                {conCambios.has(s.id) && <span className="config-nav-punto" title="Cambios sin guardar" />}
              </button>
            ))}
          </nav>

          <section className="config-seccion" key={actual.id}>
            {esCelular && (
              <button type="button" className="config-volver" onClick={() => abrirSeccion(null, { nuevaPantalla: true })}>
                <span aria-hidden="true">←</span> Volver a Configuración
              </button>
            )}
            <div className="config-seccion-cabecera">
              <h2>{actual.titulo}</h2>
              <p className="text-secondary text-sm">{actual.descripcion(terminology)}</p>
            </div>
            {contenido[actual.id]}
          </section>
        </div>
      )}

      {/* Fija abajo mientras se scrollea (sticky, no fixed: el envoltorio
          animado del panel no la corre de lugar). Una sola para todas las
          secciones: los cambios se guardan juntos aunque estén en varias. */}
      {(!enLista || hayCambios || saved || error) && (
      <div className={`config-guardar ${hayCambios ? 'con-cambios' : ''}`}>
        <div className="config-guardar-texto">
          {error
            ? <span style={{ color: 'var(--danger)' }}>{error}</span>
            : saved
              ? <span className="badge badge-success"><Icon name="check-circle" /> Guardado</span>
              : hayCambios
                ? <span><strong>Tenés cambios sin guardar</strong>{conCambios.size > 1 ? ` en ${conCambios.size} secciones` : ''}</span>
                : <span className="text-muted">Todo guardado</span>}
        </div>
        <button className={`btn ${hayCambios ? 'btn-primary' : 'btn-outline'}`} onClick={handleSave} disabled={guardando}>
          {guardando ? 'Guardando…' : <><Icon name="save" /> Guardar cambios</>}
        </button>
      </div>
      )}
    </div>
  );
}
