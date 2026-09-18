/** Primera letra en mayúscula. `null`/`undefined`/'' pasan sin tocar. */
export function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
