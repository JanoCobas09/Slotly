import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformOwner, PLATFORM_OWNERS } from '../../config/platform';
import Icon from '../../components/Icon';
import GoogleLogo from '../../components/GoogleLogo';
import { leerUltimaCuenta, olvidarUltimaCuenta } from '../../lib/ultimaCuenta';
// El login con Google de Supabase es un redirect de página completa (a
// diferencia del popup de Firebase): `location.state` (de dónde venía) no
// sobrevive el viaje, así que se guarda en sessionStorage (ver el módulo).
import {
  borrarDestinoLogin, esDestinoDeTurnos, esMisCitasDeNegocio, guardarDestinoLogin, leerDestinoLogin,
} from '../../lib/destinoLogin';

/**
 * Cuentas del emulador local (ver scripts/seed-local-demo.mjs). Son sesiones
 * REALES de Firebase Auth con custom claims de verdad — a diferencia de
 * `loginBypass`, acá las Rules y Firestore responden normal, así que se puede
 * probar cualquier pantalla con datos reales.
 *
 * Solo tiene efecto en desarrollo Y apuntando al emulador local
 * (VITE_USE_EMULATORS=true): con Firebase de producción estas cuentas no
 * existen y el login simplemente falla, no hay riesgo de tocar datos reales.
 */
const DEMO_ACCOUNTS = [
  { icon: 'crown', label: 'Dueño de plataforma', email: 'audit-owner@example.com', password: 'AuditPass123!' },
  { icon: 'car', label: 'Dueño — Taller Don Ricardo (automotor)', email: 'taller-owner@example.com', password: 'DemoPass123!' },
  { icon: 'stethoscope', label: 'Dueño — Consultorio Dra. Pérez (salud)', email: 'salud-owner@example.com', password: 'DemoPass123!' },
  { icon: 'building', label: 'Dueño — Barbería Clásica (sin context, legado)', email: 'barberia-owner@example.com', password: 'DemoPass123!' },
  { icon: 'user', label: 'Cliente de prueba', email: 'cliente-demo@example.com', password: 'ClienteDemo123!' },
];
const USANDO_EMULADORES = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

export default function LoginPage() {
  const [error, setError] = useState('');
  // false, o qué botón abrió Google ('login' | 'registro' | 'continuar' |
  // 'otra'), para mostrar "Abriendo Google…" solo en ese.
  const [entrando, setEntrando] = useState(false);
  const [bypassEmail, setBypassEmail] = useState('');
  // La última cuenta que entró desde este navegador (lib/ultimaCuenta.js).
  const [recordada, setRecordada] = useState(leerUltimaCuenta);
  const { loginWithGoogle, loginWithPassword, loginBypass, logout, user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Evita redirigir dos veces si el efecto de "volví de Google" corre más
  // de una vez (StrictMode monta los effects dos veces en dev).
  const yaRedirigido = useRef(false);

  // Si el usuario venía de un link de negocio (`/mi-negocio`) y lo mandamos
  // a loguearse, después lo devolvemos ahí en vez de tirarlo a la raíz.
  // '/' y '/login' no sirven como destino: volver ahí es justo lo que dejaba
  // al curioso sin entender qué pasó.
  const origen = location.state?.from;
  const from = origen && origen !== '/' && origen !== '/login' ? origen : null;
  // "Reservar turno" solo si venía del link de un negocio. Si venía del
  // panel (cerró sesión, o le venció el token), es alguien del staff y el
  // título de reserva lo confunde.
  // Llegó por "¿Reservaste un turno? Verificalo" (landing) o "Ya tengo turno"
  // (link de un negocio): entra con Google y va a ver sus turnos.
  const verificandoTurno = esDestinoDeTurnos(from);
  const vieneDeReserva = Boolean(from) && !verificandoTurno
    && !/^\/(admin|super-admin|cuenta)(\/|$)/.test(from);

  const redirectAfterLogin = (user, destino = from) => {
    const esStaff = user.isPlatformTeam || isPlatformOwner(user.email)
      || ['owner', 'admin', 'manager'].includes(user.role);
    if (destino === '/mis-turnos' || (esStaff && esMisCitasDeNegocio(destino))) {
      // Quiere ver los turnos que reservó, aunque sea dueño o staff de un
      // comercio (también se reserva en otros negocios). Al staff, el "Mis
      // Citas" de un negocio ajeno no le sirve (para el staff la app
      // resuelve siempre su propio negocio): va a los de todos los negocios.
      navigate('/mis-turnos');
    } else if (user.isPlatformTeam || isPlatformOwner(user.email)) {
      navigate('/super-admin');
    } else if (['owner', 'admin', 'manager'].includes(user.role)) {
      navigate('/admin');
    } else if (destino) {
      // Venía del link de un negocio: se lo devuelve ahí a terminar de reservar.
      navigate(destino);
    } else {
      // Entró por "Iniciar Sesión" desde la landing y no tiene negocio. Antes
      // se lo mandaba a /cuenta (solo la opción de WhatsApp) o, más atrás
      // todavía, de vuelta a la landing sin decirle nada. Ahora arranca el
      // alta self-service — /cuenta sigue existiendo como salida para quien
      // prefiere que se lo armen a mano (link dentro de OnboardingPage).
      navigate('/onboarding');
    }
  };

  // El login con Google es un redirect de página completa: esta pantalla se
  // recarga de cero al volver de accounts.google.com. Cuando eso pasa, el
  // AuthProvider ya detectó la sesión sola (ver AuthContext) y acá solo hace
  // falta leer a dónde había que ir (guardado antes de salir) y navegar.
  useEffect(() => {
    if (!isAuthenticated || !user || yaRedirigido.current) return;
    const destino = leerDestinoLogin();
    borrarDestinoLogin();
    // Solo si esta pantalla fue la que disparó el login (dejó la marca). Si
    // alguien ya logueado navega directo a /login por error, no hace nada acá
    // — otras rutas ya lo redirigen por su cuenta.
    if (destino === null) return;
    yaRedirigido.current = true;
    redirectAfterLogin(user, destino || from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  // Fue a Google y volvió con "atrás": el navegador restaura esta página tal
  // cual quedó (bfcache), con los botones en "Abriendo…" y deshabilitados.
  useEffect(() => {
    const alVolver = (e) => { if (e.persisted) setEntrando(false); };
    window.addEventListener('pageshow', alVolver);
    return () => window.removeEventListener('pageshow', alVolver);
  }, []);

  /**
   * Dispara el redirect a Google (supabase.auth.signInWithOAuth). A
   * diferencia del popup de Firebase, esta función no devuelve el usuario
   * logueado: la pestaña entera navega a accounts.google.com y vuelve. Por
   * eso se guarda `from` en sessionStorage antes de salir — es lo único que
   * sobrevive el viaje — y el redirect final lo hace el useEffect de arriba.
   *
   * "Iniciar sesión" y "Registrarme" hacen exactamente lo mismo: Google no
   * distingue cuenta nueva de cuenta existente, y el destino lo decide
   * redirectAfterLogin según lo que tenga esa cuenta (panel si ya tiene
   * comercio, alta de comercio si no). Son dos botones para que quien llega
   * por primera vez encuentre por dónde registrarse.
   */
  const handleGoogle = async (boton, opciones) => {
    setError('');
    setEntrando(boton);
    guardarDestinoLogin(from);
    const result = await loginWithGoogle(opciones);
    if (!result.success) {
      setEntrando(false);
      setError(result.error);
      borrarDestinoLogin();
    }
    // Si tuvo éxito, la página está a punto de navegar a Google — no hay
    // nada más para hacer acá.
  };

  // "Continuar como": con la sesión todavía abierta (un cliente; al staff
  // PublicOnlyRoute ya lo mandó a su panel) no hace falta ni pasar por
  // Google. Si no, abre Google directo en esa cuenta.
  const sesionAbierta = isAuthenticated && user && !user.isBypass;
  const perfil = sesionAbierta
    ? { name: user.name, email: user.email, avatarUrl: user.avatarUrl }
    : recordada;

  const handleContinuar = () => {
    if (sesionAbierta) redirectAfterLogin(user);
    else handleGoogle('continuar', { cuenta: perfil.email });
  };

  const handleOtraCuenta = async () => {
    if (sesionAbierta) await logout();
    handleGoogle('otra', { elegirCuenta: true });
  };

  const handleOlvidar = async () => {
    if (sesionAbierta) await logout();
    olvidarUltimaCuenta();
    setRecordada(null);
  };

  const handleDemoLogin = async (email, password) => {
    setError('');
    setEntrando(true);
    const result = await loginWithPassword(email, password);
    setEntrando(false);
    if (result.success) redirectAfterLogin(result.user);
    else setError(result.error);
  };

  const handleBypass = (email) => {
    const result = loginBypass(email);
    if (result.success) redirectAfterLogin(result.user);
    else setError(result.error);
  };

  const handleDevBypass = () => {
    const email = bypassEmail.trim().toLowerCase();
    if (email) handleBypass(email);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{verificandoTurno ? 'Verificá tu turno' : vieneDeReserva ? 'Reservar turno' : 'Entrá a Slotly'}</h1>
        <p className="auth-subtitle">
          {verificandoTurno
            ? `Entrá con la cuenta de Google con la que reservaste y te mostramos tus turnos${esMisCitasDeNegocio(from) ? '' : ' en todos los negocios'}.`
            : vieneDeReserva
              ? 'Entrá con tu cuenta de Google para confirmar el turno'
              : 'Con tu cuenta de Google. Si todavía no tenés tu comercio en Slotly, registrate y lo creás en un par de minutos.'}
        </p>

        {error && (
          <div
            className="badge badge-danger mb-md"
            style={{ display: 'block', textAlign: 'center', padding: '8px 16px', borderRadius: '8px' }}
          >
            {error}
          </div>
        )}

        {perfil ? (
          // Como el selector de cuentas de Google: la cuenta conocida es una
          // fila que se toca para entrar, y abajo "Usar otra cuenta". La G va
          // una sola vez.
          <div style={{ marginTop: 'var(--space-lg)' }}>
            <div className="selector-cuentas">
              <button
                type="button"
                className="selector-cuentas-fila"
                onClick={handleContinuar}
                disabled={Boolean(entrando)}
              >
                <AvatarCuenta perfil={perfil} />
                <span className="selector-cuentas-texto">
                  <span className="selector-cuentas-titulo">
                    {`Continuar como ${(perfil.name || perfil.email).split(/[\s@]/)[0]}`}
                  </span>
                  <span className="selector-cuentas-detalle">{perfil.email}</span>
                </span>
                <span className="selector-cuentas-accion" aria-hidden="true">
                  {entrando === 'continuar' ? 'Abriendo…' : <Icon name="chevron-right" size={18} />}
                </span>
              </button>
              <button
                type="button"
                className="selector-cuentas-fila"
                onClick={handleOtraCuenta}
                disabled={Boolean(entrando)}
              >
                <span className="selector-cuentas-icono"><GoogleLogo size={18} /></span>
                <span className="selector-cuentas-texto">
                  <span className="selector-cuentas-otra">Usar otra cuenta</span>
                </span>
                <span className="selector-cuentas-accion" aria-hidden="true">
                  {entrando === 'otra' ? 'Abriendo…' : <Icon name="chevron-right" size={18} />}
                </span>
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
              <button type="button" className="cuenta-recordada-olvidar" onClick={handleOlvidar} disabled={Boolean(entrando)}>
                No soy {(perfil.name || perfil.email).split(/[\s@]/)[0]}
              </button>
            </div>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => handleGoogle('login')}
            disabled={Boolean(entrando)}
            style={{ width: '100%', gap: 10 }}
          >
            <GoogleLogo conFondo />
            {entrando === 'login' ? 'Abriendo Google…' : verificandoTurno ? 'Entrar con Google' : 'Iniciar sesión'}
          </button>
          {!verificandoTurno && (
          <button
            type="button"
            className="btn btn-secondary btn-lg"
            onClick={() => handleGoogle('registro')}
            disabled={Boolean(entrando)}
            style={{ width: '100%', gap: 10 }}
          >
            {entrando === 'registro' ? 'Abriendo Google…' : 'Registrarme'}
          </button>
          )}
        </div>
        )}

        {/*
          ACCESO RÁPIDO — SOLO DESARROLLO.
          `loginBypass` entra sin verificar nada contra Google: con un botón se
          obtiene sesión como dueño de la plataforma. Por eso está detrás de
          `import.meta.env.DEV`, que Vite reemplaza por `false` en `npm run build`
          y elimina el bloque entero del bundle de producción.
          NO sacar este guard.

          Ojo: esta sesión NO es de Firebase. Sirve para probar la UI mientras
          los datos sigan en localStorage; cuando estén en Firestore, las Rules
          la van a rechazar y no va a poder leer nada.
        */}
        {import.meta.env.DEV && (
          <div
            style={{
              marginTop: 'var(--space-xl)',
              borderTop: '1px dashed var(--border-color)',
              paddingTop: 'var(--space-md)',
            }}
          >
            <p
              style={{
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              <Icon name="tool" /> ACCESO RÁPIDO (SOLO EN DESARROLLO)
            </p>

            {USANDO_EMULADORES && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <p className="text-xs text-muted" style={{ textAlign: 'center', marginBottom: 4 }}>
                  Sesión real contra el emulador local — datos de verdad, cada rol por separado
                </p>
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    className="btn btn-outline"
                    disabled={entrando}
                    onClick={() => handleDemoLogin(acc.email, acc.password)}
                    style={{ fontSize: 13, justifyContent: 'center', width: '100%', padding: '10px' }}
                  >
                    <Icon name={acc.icon} /> {acc.label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PLATFORM_OWNERS.map((email) => (
                <button
                  key={email}
                  className="btn btn-outline"
                  onClick={() => handleBypass(email)}
                  style={{ fontSize: 13, justifyContent: 'center', width: '100%', padding: '10px' }}
                >
                  <Icon name="crown" /> Entrar como dueño de plataforma
                </button>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="form-input"
                  placeholder="otro mail (dueño de negocio, cliente...)"
                  style={{ fontSize: 13, margin: 0 }}
                  value={bypassEmail}
                  onChange={(e) => setBypassEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDevBypass();
                  }}
                />
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleDevBypass}
                  disabled={!bypassEmail.trim()}
                  style={{ fontSize: 13, whiteSpace: 'nowrap' }}
                >
                  Entrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Foto de Google de la cuenta, o sus iniciales si no hay (o no carga). */
function AvatarCuenta({ perfil }) {
  const [sinFoto, setSinFoto] = useState(false);
  const iniciales = (perfil.name || perfil.email)
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  return (
    <div className="avatar avatar-md">
      {perfil.avatarUrl && !sinFoto
        ? <img src={perfil.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setSinFoto(true)} />
        : iniciales}
    </div>
  );
}
