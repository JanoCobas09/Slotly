import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformOwner, PLATFORM_OWNERS } from '../../config/platform';
import Icon from '../../components/Icon';

// El login con Google de Supabase es un redirect de página completa (a
// diferencia del popup de Firebase): esta pestaña se destruye y vuelve a
// cargar de cero al volver de accounts.google.com, así que `location.state`
// (de dónde venía, para saber a dónde mandarlo después) no sobrevive el
// viaje. Se guarda acá para leerlo de nuevo cuando la sesión aparezca.
const REDIRECT_TRAS_GOOGLE = 'slotly:loginRedirectFrom';

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
  const [entrando, setEntrando] = useState(false);
  const [bypassEmail, setBypassEmail] = useState('');
  // Las cuentas que crea la plataforma entran con mail y contraseña; el resto,
  // con Google. El formulario aparece solo si lo piden, para no complicarle la
  // pantalla al cliente que viene a reservar un turno.
  const [verFormulario, setVerFormulario] = useState(false);
  const [cred, setCred] = useState({ email: '', password: '' });
  const { loginWithGoogle, loginWithPassword, loginBypass, user, isAuthenticated } = useAuth();
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
  const vieneDeReserva = Boolean(from) && !/^\/(admin|super-admin|cuenta)(\/|$)/.test(from);

  const redirectAfterLogin = (user, destino = from) => {
    if (user.isPlatformTeam || isPlatformOwner(user.email)) {
      navigate('/super-admin');
    } else if (user.role === 'owner' || user.role === 'admin') {
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
    let destino = null;
    try {
      destino = sessionStorage.getItem(REDIRECT_TRAS_GOOGLE);
      sessionStorage.removeItem(REDIRECT_TRAS_GOOGLE);
    } catch { /* sin sessionStorage, se pierde el destino — vuelve al default */ }
    // Solo si esta pantalla fue la que disparó el login (dejó la marca). Si
    // alguien ya logueado navega directo a /login por error, no hace nada acá
    // — otras rutas ya lo redirigen por su cuenta.
    if (destino === null) return;
    yaRedirigido.current = true;
    redirectAfterLogin(user, destino || from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  /**
   * Dispara el redirect a Google (supabase.auth.signInWithOAuth). A
   * diferencia del popup de Firebase, esta función no devuelve el usuario
   * logueado: la pestaña entera navega a accounts.google.com y vuelve. Por
   * eso se guarda `from` en sessionStorage antes de salir — es lo único que
   * sobrevive el viaje — y el redirect final lo hace el useEffect de arriba.
   */
  const handleGoogle = async () => {
    setError('');
    setEntrando(true);
    try {
      sessionStorage.setItem(REDIRECT_TRAS_GOOGLE, from || '');
    } catch { /* sin sessionStorage, el destino cae al default post-login */ }
    const result = await loginWithGoogle();
    if (!result.success) {
      setEntrando(false);
      setError(result.error);
      try { sessionStorage.removeItem(REDIRECT_TRAS_GOOGLE); } catch { /* nada */ }
    }
    // Si tuvo éxito, la página está a punto de navegar a Google — no hay
    // nada más para hacer acá.
  };

  const handlePassword = async (ev) => {
    ev.preventDefault();
    if (!cred.email.trim() || !cred.password) return;
    setError('');
    setEntrando(true);
    const result = await loginWithPassword(cred.email, cred.password);
    setEntrando(false);
    if (result.success) redirectAfterLogin(result.user);
    else setError(result.error);
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
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
          <img src="/img/slotly-logo-full.svg" alt="Slotly" width="200" height="48" style={{ margin: '0 auto' }} />
        </div>
        <h1>{vieneDeReserva ? 'Reservar turno' : 'Iniciar sesión'}</h1>
        <p className="auth-subtitle">
          {vieneDeReserva
            ? 'Entrá con tu cuenta para confirmar el turno'
            : 'Entrá a tu panel, o al link de tu negocio para reservar'}
        </p>

        {error && (
          <div
            className="badge badge-danger mb-md"
            style={{ display: 'block', textAlign: 'center', padding: '8px 16px', borderRadius: '8px' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-lg)' }}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleGoogle}
            disabled={entrando}
            style={{ width: '100%', gap: 10 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 11v3.2h5.3c-.2 1.4-1.6 4-5.3 4a5.7 5.7 0 0 1 0-11.4c1.7 0 2.9.7 3.6 1.4l2.4-2.4A9.1 9.1 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.6-3.6 8.6-8.7 0-.6 0-1-.1-1.4H12z"
              />
            </svg>
            {entrando ? 'Abriendo Google…' : 'Continuar con Google'}
          </button>
        </div>

        {!verFormulario ? (
          <div style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setVerFormulario(true); setError(''); }}
            >
              Tengo un usuario y contraseña
            </button>
          </div>
        ) : (
          <form onSubmit={handlePassword} style={{ marginTop: 'var(--space-lg)' }}>
            <div
              style={{
                borderTop: '1px solid var(--border-color)',
                paddingTop: 'var(--space-md)',
                marginBottom: 'var(--space-md)',
                textAlign: 'center',
              }}
            >
              <span className="text-xs text-muted">O CON TU USUARIO</span>
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                autoComplete="username"
                value={cred.email}
                onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contraseña</label>
              <input
                className="form-input"
                type="password"
                autoComplete="current-password"
                value={cred.password}
                onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))}
              />
            </div>

            <button
              type="submit"
              className="btn btn-outline"
              disabled={entrando}
              style={{ width: '100%' }}
            >
              {entrando ? 'Entrando…' : 'Entrar'}
            </button>

            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-sm)', textAlign: 'center' }}>
              ¿Te olvidaste la contraseña? Escribinos y te pasamos una nueva.
            </p>
          </form>
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
