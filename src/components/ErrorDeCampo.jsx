/**
 * Mensaje debajo del casillero que no deja guardar (ver useErrorDeCampo).
 * `campo` es el nombre exacto; `prefijo` agarra un grupo entero (todas las
 * filas de un horario semanal muestran su mensaje en un solo lugar).
 */
export default function ErrorDeCampo({ error, campo, prefijo }) {
  const p = error?.problema;
  if (!p) return null;
  const esEste = campo ? p.campo === campo : p.campo?.startsWith(prefijo);
  if (!esEste) return null;
  return <div className="form-error" role="alert" style={{ marginTop: 4 }}>{p.mensaje}</div>;
}
