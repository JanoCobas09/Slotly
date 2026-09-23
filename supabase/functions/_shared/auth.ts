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
export const resourceExhausted = (msg: string) => new HttpError(429, 'resource-exhausted', msg);

/**
 * Las funciones SQL como create_appointment tiran sus errores de negocio
 * como RAISE EXCEPTION 'codigo: mensaje' (ver el comentario al principio de
 * esa migración) — mismos códigos que ya usan los HttpError de acá arriba.
 * Esto separa el prefijo del mensaje y arma el mismo HttpError, así una
 * función SQL "narra" su propio error sin que la Edge Function tenga que
 * adivinar de memoria qué código le corresponde a cada RAISE.
 */
const CODIGOS_SQL: Record<string, (msg: string) => HttpError> = {
  'invalid-argument': invalidArgument,
  'not-found': notFound,
  'failed-precondition': failedPrecondition,
  'already-exists': alreadyExists,
  'resource-exhausted': resourceExhausted,
};

export function errorDeFuncionSql(pgError: { message?: string } | null | undefined): HttpError {
  const texto = pgError?.message || '';
  const separador = texto.indexOf(': ');
  if (separador > 0) {
    const codigo = texto.slice(0, separador);
    const mensaje = texto.slice(separador + 2);
    if (CODIGOS_SQL[codigo]) return CODIGOS_SQL[codigo](mensaje);
  }
  console.error('[edge-function] Error SQL sin código reconocido:', texto);
  return new HttpError(500, 'internal', 'No se pudo completar la operación.');
}

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
 * alcance — y sobre todo, a la plataforma misma. En Firebase esto importaba
 * porque `setCustomUserClaims` REEMPLAZA los claims enteros; acá la razón es
 * la contraria (ver `clearClaims` más abajo: la Admin API de Supabase
 * MERGEA `app_metadata`, nunca reemplaza sola), pero el chequeo sigue siendo
 * necesario igual — nunca confiar en que "ya se filtró antes".
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

// Sin caracteres ambiguos (l/I/1, O/0): una contraseña que se lee por
// teléfono o se tipea desde una foto de WhatsApp no puede depender de
// distinguir una ele minúscula de una I mayúscula.
const ALFABETO = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Contraseña aleatoria de 12 caracteres, con crypto.getRandomValues (no Math.random). */
export function generarPassword(largo = 12): string {
  const bytes = new Uint8Array(largo);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

/**
 * Vacía TODOS los claims de un usuario (revocar acceso, borrar su negocio,
 * sacarle el rol de moderador). A diferencia de `admin.auth.setCustomUserClaims`
 * de Firebase, la Admin API de Supabase (`updateUserById`) MERGEA
 * `app_metadata` con lo que ya había — pasar `{ app_metadata: {} }` es un
 * no-op, no un borrado (verificado directo contra el stack local: los claims
 * viejos quedan intactos). Por eso acá se pisa cada clave conocida con
 * `null` explícito en vez de confiar en un objeto vacío.
 */
export async function clearClaims(admin: SupabaseClient, userId: string) {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { business_id: null, role: null, professional_id: null, platform: null },
  });
  if (error) throw error;
}

export function jsonResponse(body: unknown, corsHeaders: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
