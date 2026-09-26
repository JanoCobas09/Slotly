import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useBusiness } from './BusinessContext';
import { isPlatformOwner } from '../config/platform';

const AuthContext = createContext();

/**
 * ============================================================================
 * De dónde salen los permisos
 * ============================================================================
 * De `app_metadata` del usuario de Supabase Auth (viaja en el JWT como
 * `auth.jwt() -> 'app_metadata'`), y de ningún otro lado. Solo lo escriben
 * las Edge Functions con la service role key (supabase/functions/_shared/
 * auth.ts → supabaseAdmin()) — mismo rol que cumplía el Admin SDK de
 * Firebase con los custom claims.
 *
 * Reemplaza el `getIdTokenResult()` de Firebase: acá `app_metadata` ya viene
 * incluido en el objeto `user` de cada evento de `onAuthStateChange`, sin un
 * paso aparte de decodificar el token.
 * ============================================================================
 */

function authReducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { user: action.payload, isAuthenticated: true, loading: false };
    case 'LOGOUT':
      return { user: null, isAuthenticated: false, loading: false };
    case 'UPDATE_USER':
      return { ...state, user: { ...state.user, ...action.payload } };
    case 'READY':
      return { ...state, loading: false };
    default:
      return state;
  }
}

// Las sesiones reales las persiste Supabase solo (localStorage, con su
// propia clave). Esta es únicamente para que la sesión falsa de desarrollo
// sobreviva a un F5.
const DEV_BYPASS_KEY = 'slotly_dev_bypass';

function loadDevBypass() {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = localStorage.getItem(DEV_BYPASS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Reclama un permiso que quedó anotado en pending_admins antes del primer
 * login, llamando a la Edge Function apply-pending-claims (equivalente a
 * applyPendingClaims de Firebase). Devuelve el usuario de Supabase ya
 * actualizado (con `app_metadata` fresco) si se aplicó algo, o el mismo que
 * recibió si no había nada pendiente.
 *
 * Solo se llama cuando el usuario viene SIN claims: alguien que ya los tiene
 * no puede tener nada pendiente (set-business-admin los aplica en el acto
 * cuando el uid ya existe), así que llamar siempre sería una invocación de
 * más en cada login.
 */
async function reclamarPendientes(supabaseUser) {
  try {
    const { data, error } = await supabase.functions.invoke('apply-pending-claims');
    if (error || data?.status !== 'applied') return supabaseUser;
    // Los claims recién escritos no están en la sesión que ya teníamos: sin
    // refrescarla, el permiso nuevo no se ve hasta que expire el token.
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed?.user) return supabaseUser;
    return refreshed.user;
  } catch (err) {
    console.error('[auth] No se pudieron aplicar los permisos pendientes:', err);
    return supabaseUser;
  }
}

/**
 * ¿Corresponde reintentar el reclamo para este uid? Marca y responde.
 *
 * Una vez por sesión del navegador, no por carga de página: casi todos los
 * usuarios sin claims son clientes reservando un turno, y llamar en cada
 * navegación sería pagar una invocación por pantalla.
 */
function tocaReintentar(uid) {
  const clave = `slotly_claims_check_${uid}`;
  try {
    if (sessionStorage.getItem(clave)) return false;
    sessionStorage.setItem(clave, '1');
  } catch { /* sin sessionStorage se reintenta igual; no es crítico */ }
  return true;
}

function initialState() {
  const bypass = loadDevBypass();
  return bypass
    ? { user: bypass, isAuthenticated: true, loading: false }
    : { user: null, isAuthenticated: false, loading: true };
}

export function AuthProvider({ children }) {
  // AuthProvider es hijo de BusinessProvider → puede usar useBusiness()
  const { state: bizState } = useBusiness();
  const [state, dispatch] = useReducer(authReducer, undefined, initialState);

  // En un ref y no en el state: el callback de onAuthStateChange se suscribe
  // una sola vez y capturaría un `state` viejo, borrando la sesión de
  // desarrollo cuando Supabase reporta "sin usuario".
  const bypassActivo = useRef(Boolean(state.user?.isBypass));

  const authorizedAdmins = bizState.authorizedAdmins || [];

  /**
   * Arma el objeto de usuario de la app a partir de la cuenta de Supabase.
   * Prioridad de permisos: app_metadata > fallback local.
   */
  const buildUser = (supabaseUser, meta = supabaseUser.app_metadata || {}) => {
    const email = (supabaseUser.email || '').toLowerCase();
    const userMeta = supabaseUser.user_metadata || {};

    // Única fuente: app_metadata escrito por las Edge Functions.
    const hasClaims = Boolean(meta.platform || meta.business_id);
    const platformOwner = meta.platform === true;

    // Moderador: equipo de soporte de la plataforma. Entra al panel global, ve
    // todo y atiende tickets, pero no toca plata, cuentas ni suspensiones. Va
    // como `platform: 'moderator'` y no como `true`, así todo lo que exige
    // `platform === true` lo deja afuera por defecto.
    const moderator = meta.platform === 'moderator';

    return {
      id: supabaseUser.id,
      email: supabaseUser.email,
      name: userMeta.full_name || userMeta.name || email.split('@')[0],
      avatarUrl: userMeta.avatar_url || userMeta.picture || null,
      role: platformOwner
        ? 'owner'
        : moderator
          ? 'moderator'
          : (hasClaims ? meta.role : null) || 'client',
      businessId: platformOwner || moderator ? null : (meta.business_id || null),
      professionalId: platformOwner || moderator ? null : (meta.professional_id || null),
      // Administrador de sucursal (role 'manager'): la sucursal que administra.
      branchId: platformOwner || moderator ? null : (meta.branch_id || null),
      isPlatformOwner: platformOwner,
      isModerator: moderator,
      // Dueño o moderador: quien puede entrar al panel global.
      isPlatformTeam: platformOwner || moderator,
      permissionSource: hasClaims ? 'claims' : 'none',
      isActive: true,
    };
  };

  // Supabase mantiene la sesión entre recargas (localStorage) y detecta sola
  // el callback de OAuth en la URL al volver de Google. Este único listener
  // cubre la rehidratación al recargar Y el regreso del redirect de Google
  // (evento SIGNED_IN en los dos casos) — a diferencia del popup de Firebase,
  // acá no hay un valor de retorno sincrónico de loginWithGoogle: el login
  // real pasa por acá.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // Las sesiones de desarrollo (loginBypass) no son de Supabase: no las pisa.
      if (!session?.user) {
        if (bypassActivo.current) dispatch({ type: 'READY' });
        else dispatch({ type: 'LOGOUT' });
        return;
      }
      bypassActivo.current = false;
      let supabaseUser = session.user;
      const meta = supabaseUser.app_metadata || {};

      // Red de seguridad: si el reclamo del login se cortó a mitad (se cerró
      // la pestaña, falló la red), sin esto la persona queda como cliente
      // para siempre y solo se arregla cerrando y abriendo sesión.
      if (!meta.platform && !meta.business_id && tocaReintentar(supabaseUser.id)) {
        supabaseUser = await reclamarPendientes(supabaseUser);
      }

      dispatch({ type: 'LOGIN', payload: buildUser(supabaseUser) });
    });
    // Se suscribe una sola vez.
    return () => subscription.unsubscribe();
  }, []);

  /**
   * Dispara el redirect a Google. A diferencia de Firebase (popup,
   * `signInWithPopup` resuelve con el usuario ya logueado), Supabase hace
   * un redirect de página completa: esta función no devuelve un usuario,
   * solo confirma que el redirect arrancó (o el error si ni eso). El login
   * de verdad se completa en el listener de arriba, cuando la página vuelve
   * de Google y Supabase detecta la sesión sola en la URL.
   *
   * `redirectTo` apunta de nuevo a /login: quien llama (LoginPage) guarda
   * antes en sessionStorage a dónde ir después, porque el estado de React
   * Router (`location.state`) no sobrevive el ida-y-vuelta a accounts.google.com.
   */
  const loginWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/login` },
      });
      if (error) throw error;
      return { success: true, redirecting: true };
    } catch (error) {
      console.error('[auth] Error de login con Google:', error);
      return { success: false, error: 'No se pudo abrir el login con Google. Probá de nuevo.' };
    }
  };

  /**
   * Login con email y contraseña, para las cuentas que crea la plataforma desde
   * `/super-admin`. El resto del modelo no cambia: los permisos siguen siendo
   * `app_metadata`, que no sabe ni le importa con qué proveedor entró la persona.
   */
  const loginWithPassword = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      let supabaseUser = data.user;
      const meta = supabaseUser.app_metadata || {};
      if (!meta.platform && !meta.business_id) {
        supabaseUser = await reclamarPendientes(supabaseUser);
      }
      const user = buildUser(supabaseUser);
      dispatch({ type: 'LOGIN', payload: user });
      return { success: true, user };
    } catch (error) {
      console.error('[auth] Error de login con contraseña:', error);
      const mensajes = {
        invalid_credentials: 'El mail o la contraseña no coinciden.',
        email_not_confirmed: 'Esta cuenta todavía no confirmó el mail.',
        user_banned: 'Esta cuenta está deshabilitada.',
        over_request_rate_limit: 'Demasiados intentos. Esperá unos minutos.',
      };
      return {
        success: false,
        error: mensajes[error.code] || error.message || 'No se pudo iniciar sesión.',
      };
    }
  };

  /**
   * Login sin verificar nada, para probar roles en local.
   * Ojo: NO crea una sesión de Supabase, así que en cuanto los datos estén en
   * Postgres este usuario no va a poder leer nada (las RLS lo van a
   * rechazar). Sirve solo para la UI mientras la base siga en localStorage.
   */
  const loginBypass = (email) => {
    if (!import.meta.env.DEV) {
      return { success: false, error: 'Iniciá sesión con Google.' };
    }
    const platformOwner = isPlatformOwner(email);
    const match = authorizedAdmins.find((a) => a.email.toLowerCase() === email.toLowerCase());

    const user = {
      id: 'bypass-' + Date.now(),
      email,
      name: match ? match.name : email.split('@')[0],
      avatarUrl: null,
      role: platformOwner ? 'owner' : (match?.role || 'client'),
      professionalId: platformOwner ? null : (match?.professionalId || null),
      businessId: platformOwner ? null : (match?.businessId || null),
      isPlatformOwner: platformOwner,
      permissionSource: 'local',
      isBypass: true,
      isActive: true,
    };

    bypassActivo.current = true;
    try {
      localStorage.setItem(DEV_BYPASS_KEY, JSON.stringify(user));
    } catch { /* sin persistencia, se pierde al recargar; no es crítico */ }

    dispatch({ type: 'LOGIN', payload: user });
    return { success: true, user };
  };

  const logout = async () => {
    bypassActivo.current = false;
    try {
      localStorage.removeItem(DEV_BYPASS_KEY);
    } catch { /* ignorar */ }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[auth] Error al cerrar sesión:', err);
    }
    dispatch({ type: 'LOGOUT' });
  };

  /**
   * Vuelve a pedir la sesión para traer claims recién asignados.
   * Sin esto, un permiso nuevo no se ve hasta que el token expire solo.
   */
  const refreshClaims = async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.user) return null;
    const user = buildUser(data.user);
    dispatch({ type: 'LOGIN', payload: user });
    return data.user.app_metadata;
  };

  return (
    <AuthContext.Provider
      value={{ ...state, loginWithGoogle, loginWithPassword, loginBypass, logout, refreshClaims, dispatch }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
