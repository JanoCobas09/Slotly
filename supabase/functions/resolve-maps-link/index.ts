// ============================================================================
// resolve-maps-link
// ============================================================================
// Devuelve la ubicación real (lat/lng) del link de Google Maps que cargó un
// negocio, para centrar el mapa de su página de reserva.
//
// Por qué del lado del servidor: lo que pega el dueño casi siempre es un link
// corto de la app (maps.app.goo.gl/...), que no trae nada adentro — hay que
// seguir la redirección para ver adónde apunta, y el navegador no puede
// (CORS). Sin esto, el mapa buscaba por el texto de la dirección ("La cancha
// de las tonas") y Google centraba en cualquier lado.
//
// Recibe el `businessId`, NO una URL: el link sale de la base. Así la función
// no sirve de proxy abierto para pedirle cualquier cosa a cualquier host. Y
// cada salto de la redirección tiene que seguir siendo un dominio de Google.
//
// Sin sesión, a propósito: la página de reserva se mira sin loguearse, y la
// respuesta es la misma ubicación que el negocio ya publica.
import { corsHeaders } from '../_shared/cors.ts';
import { supabaseAdmin, errorResponse, jsonResponse, invalidArgument } from '../_shared/auth.ts';

const HOSTS_GOOGLE = /(^|\.)(google\.[a-z.]+|goo\.gl|app\.goo\.gl|maps\.app\.goo\.gl|googleusercontent\.com)$/i;
const MAX_SALTOS = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// Coordenadas si el link las trae (lo normal: maps.app.goo.gl redirige a
// /maps/place/NOMBRE/@lat,lng/...!3d..!4d..). Si no — links viejos de
// "compartir" que terminan en ?q=NOMBRE&ftid=... — el nombre del lugar tal
// como lo puso Google y su id, que igual es mucho más preciso que la
// dirección tipeada a mano por el dueño.
type Ubicacion = { lat: number; lng: number } | { query: string; ftid: string | null };

function coordsValidas(lat: number, lng: number): Ubicacion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Coordenadas dentro de una URL de Maps, de la más precisa a la menos:
 * `!3d..!4d..` es el lugar marcado; `@lat,lng` es el centro de la vista;
 * `q=`/`ll=`/`query=` con números es una búsqueda por coordenadas.
 */
function coordsDeUrl(url: string): Ubicacion | null {
  const texto = decodeURIComponent(url);
  const lugar = texto.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (lugar) return coordsValidas(+lugar[1], +lugar[2]);
  const vista = texto.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (vista) return coordsValidas(+vista[1], +vista[2]);
  const param = texto.match(/[?&](?:q|ll|query|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (param) return coordsValidas(+param[1], +param[2]);
  return null;
}

/**
 * Sin coordenadas: el lugar por nombre (`q=`/`query=`, o el segmento de
 * `/place/NOMBRE/`). OJO: no se lee el HTML de la página — su `center=` es la
 * ubicación de quien hace el pedido (acá, el servidor), no la del lugar.
 */
function lugarDeUrl(url: string): Ubicacion | null {
  try {
    const u = new URL(url);
    const q = u.searchParams.get('q') || u.searchParams.get('query');
    const place = u.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
    const query = (q || (place ? decodeURIComponent(place).replace(/\+/g, ' ') : '')).trim();
    return query ? { query, ftid: u.searchParams.get('ftid') } : null;
  } catch {
    return null;
  }
}

function esGoogle(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS_GOOGLE.test(u.hostname);
  } catch {
    return false;
  }
}

async function resolver(linkInicial: string): Promise<Ubicacion | null> {
  let url = linkInicial.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/^http:/i, 'https:');

  for (let salto = 0; salto < MAX_SALTOS; salto++) {
    if (!esGoogle(url)) return null;

    const directas = coordsDeUrl(url);
    if (directas) return directas;

    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es;q=0.9' },
      signal: AbortSignal.timeout(6000),
    });

    const destino = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && destino) {
      await res.body?.cancel();
      url = new URL(destino, url).toString();
      continue;
    }

    await res.body?.cancel();
    // Última parada, sin coordenadas en la URL: el lugar por nombre.
    return lugarDeUrl(url);
  }
  return lugarDeUrl(url);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { businessId, branchId = null } = await req.json();
    if (!businessId || typeof businessId !== 'string') throw invalidArgument('Falta el negocio.');

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from('businesses')
      .select('maps_url')
      .eq('id', businessId)
      .maybeSingle();
    if (error) throw error;

    // Una sucursal con link propio usa el suyo; si no, el del negocio.
    // Igual que con el negocio, el link sale de la base (nunca del pedido).
    let linkSucursal: string | null = null;
    if (branchId && typeof branchId === 'string') {
      const { data: suc } = await admin
        .from('branches').select('maps_url').eq('id', branchId).eq('business_id', businessId).maybeSingle();
      linkSucursal = suc?.maps_url?.trim() || null;
    }

    const link = linkSucursal || data?.maps_url?.trim();
    let ubicacion: Ubicacion | null = null;
    if (link) {
      try {
        ubicacion = await resolver(link);
      } catch (err) {
        // Google caído, timeout, link roto: no es un error del cliente. El
        // front cae a buscar por la dirección.
        console.error('[resolve-maps-link] No se pudo resolver', link, err);
      }
    }

    return jsonResponse({ ubicacion }, corsHeaders);
  } catch (err) {
    return errorResponse(err, corsHeaders);
  }
});
