/**
 * Mensaje para una persona a partir de un error. Los cortes de red llegan
 * como "TypeError: Failed to fetch" (o parecido): eso no le dice nada a
 * quien usa el panel.
 */
export function mensajeDeError(error, porDefecto = 'Algo salió mal. Probá de nuevo.') {
  const texto = String(error?.message || '');
  if (!navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(texto)) {
    return 'No hay conexión. Revisá internet y probá de nuevo.';
  }
  return texto || porDefecto;
}
