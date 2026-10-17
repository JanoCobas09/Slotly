import { useEffect, useState } from 'react';
import { resolveMapsLink } from '../lib/functions';

/** Coordenadas escritas directo en un link largo de Maps (`!3d..!4d..` o `@lat,lng`). */
function coordsDelLink(url) {
  const texto = (() => { try { return decodeURIComponent(url || ''); } catch { return url || ''; } })();
  const m = texto.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || texto.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? `${m[1]},${m[2]}` : null;
}

/**
 * Dónde centrar el mapa: el lugar REAL del link que cargó el dueño. Si el
 * link es largo, las coordenadas salen de él mismo; si es corto
 * (maps.app.goo.gl/...), las resuelve el servidor (resolve-maps-link),
 * porque el navegador no puede seguir esa redirección. Mientras resuelve, no
 * se pinta nada (sin mapa "de mentira" que después salta). Solo si el
 * link no se pudo resolver, se busca por el texto de la dirección.
 */
export function useUbicacionDelMapa(business) {
  const link = business.mapsUrl?.trim() || '';
  const directas = coordsDelLink(link);
  const hayQueResolver = Boolean(link) && !directas;
  const [resuelta, setResuelta] = useState({ link: '', coords: null });

  useEffect(() => {
    if (!hayQueResolver) return;
    let vigente = true;
    resolveMapsLink({ businessId: business.id, branchId: business.sucursalId || null })
      .then(({ ubicacion: u }) => {
        if (!vigente) return;
        // Coordenadas, o (links viejos de "compartir") el lugar por nombre
        // tal como lo puso Google + su id `ftid`.
        const coords = u?.lat != null ? `${u.lat},${u.lng}` : u?.query || null;
        setResuelta({ link, coords, ftid: u?.ftid || null });
      })
      .catch((err) => {
        console.error('[useUbicacionDelMapa] No se pudo resolver el link de Maps:', err);
        if (vigente) setResuelta({ link, coords: null });
      });
    return () => { vigente = false; };
  }, [hayQueResolver, link, business.id, business.sucursalId]);

  const direccion = business.address?.trim() || null;
  if (directas) return { consulta: directas, cargando: false };
  if (hayQueResolver && resuelta.link !== link) return { consulta: null, cargando: true };
  if (resuelta.coords) return { consulta: resuelta.coords, ftid: resuelta.ftid, cargando: false };
  return { consulta: direccion, cargando: false };
}
