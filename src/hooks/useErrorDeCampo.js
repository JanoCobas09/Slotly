import { useCallback, useEffect, useState } from 'react';

/**
 * Qué casillero de un formulario no deja guardar.
 *
 * Los validar*() de utils/validaciones.js devuelven `{ campo, mensaje }`;
 * con `marcar(problema)` el casillero queda en rojo, con el mensaje abajo, y
 * la pantalla va hasta él. Antes el aviso era un alert() o un cartel al pie
 * del formulario, y en un formulario largo no había forma de saber cuál era.
 *
 * Cada casillero se engancha con `{...campo('phone')}` (pone data-campo y
 * aria-invalid, que es lo que pinta el borde rojo en index.css) y el mensaje
 * con <ErrorDeCampo error={...} campo="phone" />. El mismo nombre en varios
 * elementos (las dos horas de un día) los marca a todos juntos.
 *
 * El error se va solo cuando la persona toca el casillero marcado.
 */
export function useErrorDeCampo() {
  const [problema, setProblema] = useState(null);

  useEffect(() => {
    if (!problema?.campo) return undefined;
    const elementos = [...document.querySelectorAll(`[data-campo="${CSS.escape(problema.campo)}"]`)];
    if (!elementos.length) return undefined;
    const [primero] = elementos;
    primero.scrollIntoView({ behavior: 'smooth', block: 'center' });
    primero.focus?.({ preventScroll: true });

    const soltar = () => setProblema(null);
    for (const el of elementos) {
      el.addEventListener('input', soltar);
      el.addEventListener('change', soltar);
    }
    return () => {
      for (const el of elementos) {
        el.removeEventListener('input', soltar);
        el.removeEventListener('change', soltar);
      }
    };
  }, [problema]);

  const campo = useCallback((nombre) => ({
    'data-campo': nombre,
    'aria-invalid': problema?.campo === nombre || undefined,
  }), [problema]);

  return {
    problema,
    /** Recibe lo que devuelve un validar*(); con null/'' no hace nada. Devuelve si marcó. */
    marcar: (p) => { if (p) setProblema({ ...p }); return Boolean(p); },
    limpiar: () => setProblema(null),
    campo,
  };
}
