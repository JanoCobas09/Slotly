// ============================================================================
// La última cuenta de Google que entró desde este navegador
// ============================================================================
// Para el "Continuar como Juan" de /login: nombre, correo y foto, nada más
// (ni tokens ni permisos — la sesión la sigue manejando Supabase). Se guarda
// al entrar y NO se borra al cerrar sesión: justamente sirve para volver a
// entrar con un toque. "Usar otra cuenta" / "No soy yo" la olvida.
//
// Es una comodidad, no seguridad: tocar "Continuar como" igual pasa por
// Google, que es quien decide si deja entrar.
// ============================================================================

const CLAVE = 'slotly:ultimaCuenta';

export function leerUltimaCuenta() {
  try {
    const raw = localStorage.getItem(CLAVE);
    const cuenta = raw ? JSON.parse(raw) : null;
    return cuenta?.email ? cuenta : null;
  } catch {
    return null;
  }
}

export function guardarUltimaCuenta({ name, email, avatarUrl }) {
  if (!email) return;
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ name: name || '', email, avatarUrl: avatarUrl || null }));
  } catch { /* sin localStorage no se recuerda; no es crítico */ }
}

export function olvidarUltimaCuenta() {
  try {
    localStorage.removeItem(CLAVE);
  } catch { /* nada */ }
}
