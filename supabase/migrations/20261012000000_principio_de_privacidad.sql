-- ============================================================================
-- Principio de privacidad: la plataforma ve los turnos, no quién los saca
-- ============================================================================
-- El dueño lo activa en Configuración. Con `privacidad_clientes = true`, el
-- equipo de la plataforma (dueño de Slotly y moderadores) ya no puede leer
-- las filas de `appointments` ni los avisos de ese negocio. Para seguir
-- viendo la agenda (cuántos turnos, a qué hora, de qué servicio, con qué
-- profesional) tiene `turnos_sin_cliente()`, que devuelve los mismos turnos
-- SIN lo que identifica al cliente: nombre, teléfono, mail, cuenta, notas,
-- motivo de cancelación y los datos del pago de la seña.
--
-- Viene activado por defecto en los rubros sensibles: salud (healthcare),
-- servicios profesionales y bienestar/terapias (wellness). Solo el dueño del
-- negocio lo puede cambiar.
--
-- Alcance, dicho claro: esto cierra la APP (RLS). El servidor sigue teniendo
-- los datos —hacen falta para mandarle al cliente la confirmación y el
-- recordatorio— y quien entre a la base con la clave de servicio o desde el
-- panel de Supabase los ve igual.

-- De paso, un arreglo que salió probando esto con un moderador: su claim es
-- `platform: 'moderator'` y auth_is_platform() lo convertía a boolean
-- ('moderator'::boolean → error). Cualquier policy que la evaluara le
-- tiraba "invalid input syntax for type boolean" al moderador.
create or replace function auth_is_platform() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform') = 'true', false)
    or (auth.jwt() ->> 'role') = 'service_role'
$$;

alter table businesses add column if not exists privacidad_clientes boolean not null default false;

-- Los que ya existen de esos rubros arrancan con la privacidad activada.
update businesses set privacidad_clientes = true
  where profession_category in ('healthcare', 'professional_services', 'wellness');

-- Al crear un negocio (alta manual o self-service) de esos rubros, activado.
create or replace function privacidad_por_rubro() returns trigger
language plpgsql as $$
begin
  if new.profession_category in ('healthcare', 'professional_services', 'wellness') then
    new.privacidad_clientes := true;
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_privacidad_por_rubro on businesses;
create trigger businesses_privacidad_por_rubro
  before insert on businesses
  for each row execute function privacidad_por_rubro();

-- Solo el dueño lo cambia: la plataforma no se puede "desprivatizar" sola un
-- negocio. Sin sesión (migraciones, funciones con service role) no aplica.
create or replace function proteger_privacidad() returns trigger
language plpgsql as $$
begin
  if new.privacidad_clientes is distinct from old.privacidad_clientes
    and auth.uid() is not null
    -- coalesce: para quien no tiene negocio (la plataforma) is_business_owner
    -- da NULL, no false, y un `not NULL` dejaba pasar el cambio.
    and not coalesce(is_business_owner(new.id), false)
  then
    raise exception 'failed-precondition: Solo el dueño del negocio puede cambiar el principio de privacidad.';
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_proteger_privacidad on businesses;
create trigger businesses_proteger_privacidad
  before update on businesses
  for each row execute function proteger_privacidad();

-- ¿Ese negocio tiene la privacidad activada? security definer para que las
-- policies la puedan usar sin depender de quién consulta.
create or replace function negocio_privado(p_business_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select privacidad_clientes from businesses where id = p_business_id), false)
$$;

-- ── Turnos: la plataforma solo en los negocios sin privacidad ──────────────
drop policy if exists appointments_select on appointments;
create policy appointments_select on appointments
  for select using (
    is_business_owner(business_id)
    or (auth_is_platform_team() and not negocio_privado(business_id))
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

drop policy if exists appointments_insert on appointments;
create policy appointments_insert on appointments
  for insert with check (
    user_id = auth.uid()
    and (
      (auth_is_platform() and not negocio_privado(business_id))
      or is_business_owner(business_id)
      or (is_assigned_staff(business_id) and professional_id = auth_professional_id())
      or is_branch_manager(business_id, branch_id)
    )
  );

drop policy if exists appointments_update on appointments;
create policy appointments_update on appointments
  for update
  using (
    is_business_owner(business_id)
    or (auth_is_platform() and not negocio_privado(business_id))
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
    or (auth.uid() is not null and user_id = auth.uid())
  )
  with check (
    is_business_owner(business_id)
    or (auth_is_platform() and not negocio_privado(business_id))
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

-- ── Avisos: dicen el nombre del cliente ("Nuevo turno de …") ───────────────
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select using (
    is_business_owner(business_id)
    or (auth_is_platform_team() and not negocio_privado(business_id))
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
  );

-- ── La agenda sin datos del cliente, para la plataforma ───────────────────
create or replace function turnos_sin_cliente(p_business_id uuid) returns setof jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(a) - array[
    'user_id', 'client_name', 'client_phone', 'client_email', 'notes', 'admin_notes',
    'cancellation_reason', 'cancelled_by_name', 'mp_payment_id', 'mp_preference_id', 'deposit_checkout_url'
  ]
  from appointments a
  where a.business_id = p_business_id
    and auth_is_platform_team()
$$;
revoke all on function turnos_sin_cliente(uuid) from public, anon;
grant execute on function turnos_sin_cliente(uuid) to authenticated;
