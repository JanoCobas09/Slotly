// ============================================================================
// Helpers compartidos por las Edge Functions de Slotly
// ============================================================================
// Equivalente a la cabecera de functions/index.js del lado de Firebase: acá
// vive todo lo que necesita el Admin SDK / la service role key, porque los
// permisos (custom claims) SOLO los puede escribir el servidor. Si el
// permiso saliera de una fila que el propio usuario puede editar, cualquiera
// escalaría privilegios.
//
// Claims esperados en auth.users.raw_app_meta_data (llegan en el JWT como
// app_metadata) — mismo esquema que los custom claims de Firebase:
//   { platform: true }                                  → dueño de la plataforma
//   { platform: 'moderator' }                            → moderador
//   { business_id, role: 'owner' }                       → dueño de un negocio
//   { business_id, role: 'admin', professional_id }       → staff asignado
//   ({})                                                  → cliente

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const unauthenticated = (msg = 'Tenés que iniciar sesión.') =>
  new HttpError(401, 'unauthenticated', msg);
export const permissionDenied = (msg = 'No tenés permiso para esto.') =>
  new HttpError(403, 'permission-denied', msg);
export const invalidArgument = (msg: string) => new HttpError(400, 'invalid-argument', msg);
export const notFound = (msg: string) => new HttpError(404, 'not-found', msg);
export const alreadyExists = (msg: string) => new HttpError(409, 'already-exists', msg);
export const failedPrecondition = (msg: string) => new HttpError(412, 'failed-precondition', msg);

/** Cliente con la service role key: bypassa RLS, igual que el Admin SDK de Firebase. */
export function supabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export interface Caller {
  id: string;
  email: string | null;
  emailVerified: boolean;
  businessId: string | null;
  role: string | null;
  professionalId: string | null;
  platform: boolean | 'moderator' | null;
}

/**
 * Valida el JWT de quien llama (header Authorization) y devuelve sus claims
 * ya parseados. Tira `unauthenticated` si no hay sesión válida — equivalente
 * a chequear `request.auth` en un callable de Firebase.
 */
export async function getCaller(req: Request): Promise<Caller> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw unauthenticated();

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw unauthenticated();

  const meta = data.user.app_metadata ?? {};
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailVerified: Boolean(data.user.email_confirmed_at),
    businessId: meta.business_id ?? null,
    role: meta.role ?? null,
    professionalId: meta.professional_id ?? null,
    platform: meta.platform ?? null,
  };
}

export const isPlatformOwner = (c: Caller) => c.platform === true;
export const isModerator = (c: Caller) => c.platform === 'moderator';
export const isPlatformTeam = (c: Caller) => isPlatformOwner(c) || isModerator(c);

function assertPlatformOwner(c: Caller) {
  if (!isPlatformOwner(c)) throw permissionDenied('Solo el dueño de la plataforma.');
}

/**
 * Quién puede tocar los permisos de un negocio. Devuelve 'platform' | 'owner'
 * — mismo criterio que assertCanManageAdmins en functions/index.js.
 */
function assertCanManageAdmins(c: Caller, businessId: string): 'platform' | 'owner' {
  if (isPlatformOwner(c)) return 'platform';
  if (c.role === 'owner' && c.businessId === businessId) return 'owner';
  throw permissionDenied('No podés gestionar los permisos de este negocio.');
}

/**
 * Impide que un llamador que no es la plataforma toque a alguien fuera de su
 * alcance — y sobre todo, a la plataforma misma. Mismo motivo que en
 * Firebase: actualizar app_metadata REEMPLAZA los claims salvo que se haga
 * merge a mano, así que hay que revalidar esto siempre, no confiar en que
 * "ya se filtró antes".
 */
function assertTargetEnAlcance(
  caller: 'platform' | 'owner',
  targetMeta: Record<string, unknown> | null,
  businessId: string,
) {
  if (caller === 'platform') return;
  if (targetMeta?.platform === true) {
    throw permissionDenied('No podés modificar a la plataforma.');
  }
  if (targetMeta?.role === 'owner') {
    throw permissionDenied('Solo la plataforma puede modificar a un dueño.');
  }
  if (targetMeta?.business_id && targetMeta.business_id !== businessId) {
    throw permissionDenied('Esa cuenta pertenece a otro negocio.');
  }
}

export const guards = { assertPlatformOwner, assertCanManageAdmins, assertTargetEnAlcance };

/** Arma la Response de error en el mismo formato que espera el cliente. */
export function errorResponse(err: unknown, corsHeaders: Record<string, string>): Response {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ error: { code: err.code, message: err.message } }), {
      status: err.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  console.error('[edge-function] Error inesperado:', err);
  return new Response(
    JSON.stringify({ error: { code: 'internal', message: 'Error interno.' } }),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

export function jsonResponse(body: unknown, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
