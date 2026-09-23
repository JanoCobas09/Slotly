-- ============================================================================
-- Helpers de auth.users para las Edge Functions
-- ============================================================================
-- La API Admin de supabase-js no trae un getUserByEmail directo (a
-- diferencia de getAuth().getUserByEmail() de Firebase), y tampoco un
-- "cortale todas las sesiones abiertas a este uid" (Firebase:
-- revokeRefreshTokens). Estas dos funciones cubren eso.
--
-- SECURITY DEFINER + revoke/grant explícito: solo `service_role` (las Edge
-- Functions con la service role key) las puede llamar. Nunca `anon` ni
-- `authenticated` — leer o cortar sesiones de cualquier cuenta por mail es
-- exactamente el tipo de cosa que un cliente normal no puede tener.

create or replace function get_user_by_email(lookup_email text)
returns table (
  id uuid,
  email text,
  email_confirmed boolean,
  app_metadata jsonb
)
language sql
security definer
set search_path = auth, pg_temp
as $$
  select id, email, (email_confirmed_at is not null) as email_confirmed, raw_app_meta_data
  from auth.users
  where lower(email) = lower(lookup_email)
  limit 1;
$$;

revoke all on function get_user_by_email(text) from public, anon, authenticated;
grant execute on function get_user_by_email(text) to service_role;

-- Invalida todas las sesiones/refresh tokens activos de un usuario. Mismo
-- motivo que revokeRefreshTokens en Firebase: al revocar un permiso o
-- resetear una contraseña, el token viejo no puede seguir sirviendo.
create or replace function revoke_user_sessions(target_id uuid)
returns void
language plpgsql
security definer
set search_path = auth, pg_temp
as $$
begin
  delete from auth.refresh_tokens where user_id = target_id::text;
  delete from auth.sessions where user_id = target_id;
end;
$$;

revoke all on function revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_user_sessions(uuid) to service_role;
