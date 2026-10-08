// ============================================================================
// A dónde ir después del login con Google
// ============================================================================
// El login con Google es un redirect de página completa: la pestaña se va a
// accounts.google.com y vuelve a /login cargando de cero, así que el estado
// de React Router (`location.state.from`) no sobrevive el viaje. LoginPage
// guarda el destino acá antes de salir y lo lee al volver.
//
// Lo lee también PublicOnlyRoute (App.jsx): al volver con sesión, al dueño o
// staff lo manda a su panel ANTES de que LoginPage llegue a leerlo. Si iba a
// "Verificá tu turno" (/mis-turnos), tiene que ir ahí aunque tenga comercio.
// ============================================================================

export const DESTINO_TRAS_GOOGLE = 'slotly:loginRedirectFrom';

/** El destino guardado ('' = el de siempre), o null si no hay marca. */
export function leerDestinoLogin() {
  try {
    return sessionStorage.getItem(DESTINO_TRAS_GOOGLE);
  } catch {
    return null;
  }
}

export function guardarDestinoLogin(destino) {
  try {
    sessionStorage.setItem(DESTINO_TRAS_GOOGLE, destino || '');
  } catch { /* sin sessionStorage, el destino cae al default post-login */ }
}

export function borrarDestinoLogin() {
  try {
    sessionStorage.removeItem(DESTINO_TRAS_GOOGLE);
  } catch { /* nada */ }
}
