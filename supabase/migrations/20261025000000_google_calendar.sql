-- ============================================================================
-- Google Calendar de cada profesional: los turnos van solos a su calendario
-- y lo ocupado en su calendario se saca de la grilla de reserva
-- ============================================================================
-- Pedido del usuario (14/10/2026): usar el calendario del teléfono. Desde una
-- web no hay acceso al calendario del dispositivo, así que se hace con la API
-- de Google Calendar (que se sincroniza sola con el celular):
--   · ESCRITURA / MODIFICACIÓN / BORRADO: cada turno nuevo, movido o
--     cancelado crea, cambia o borra su evento (Edge Function
--     sincronizar-google, por la cola de avisos — si Google falla, reintenta).
--   · LECTURA: get-busy-slots suma lo ocupado en su calendario a lo ocupado
--     en Slotly, y create-appointment lo vuelve a mirar al confirmar.
--
-- La conexión es por PROFESIONAL (su agenda), no por negocio. La conecta el
-- propio profesional desde "Mi configuración" o el dueño desde Configuración.
-- Detalle técnico en _shared/google.ts.

-- ── Conexión con la cuenta de Google de cada profesional ─────────────────────
-- 🔒 Nadie la lee desde el browser: el refresh_token da acceso al calendario.
create table if not exists google_calendar_conexiones (
  professional_id uuid primary key references professionals(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  -- Access token vigente (dura 1 hora): se guarda para no pedir uno nuevo en
  -- cada consulta de la grilla.
  access_token text,
  access_expires_at timestamptz,
  calendar_id text not null default 'primary',
  conectado_por uuid,
  conectado_at timestamptz not null default now(),
  -- Último problema con Google (permiso revocado, etc.). NULL = anda bien.
  -- Se muestra en el panel para que la persona la vuelva a conectar.
  error text,
  error_at timestamptz
);
create index if not exists google_calendar_conexiones_negocio_idx on google_calendar_conexiones (business_id);

alter table google_calendar_conexiones enable row level security;
revoke all on google_calendar_conexiones from public, anon, authenticated;
grant select, insert, update, delete on google_calendar_conexiones to service_role;

-- `state` del OAuth (mismo esquema que mp_oauth_states): lo crea gcal-conexion
-- y lo consume gcal-oauth-callback, una sola vez y por 15 minutos. Es lo que
-- impide conectarle una cuenta de Google a un profesional ajeno.
create table if not exists google_oauth_states (
  state text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  user_id uuid not null,
  volver_a text not null,
  created_at timestamptz not null default now()
);
alter table google_oauth_states enable row level security;
revoke all on google_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on google_oauth_states to service_role;

-- Lo único que el panel necesita: qué profesional está conectado, con qué
-- cuenta y si hay algún problema. Nunca los tokens. El dueño (y la
-- plataforma) ve a todo su equipo; un profesional, solo el suyo.
create or replace function google_calendar_estado(p_business_id uuid)
returns table (professional_id uuid, google_email text, conectado_at timestamptz, error text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if is_business_owner(p_business_id) or auth_is_platform() then
    return query
      select c.professional_id, c.google_email, c.conectado_at, c.error
      from google_calendar_conexiones c where c.business_id = p_business_id;
  elsif is_assigned_staff(p_business_id) and auth_professional_id() is not null then
    return query
      select c.professional_id, c.google_email, c.conectado_at, c.error
      from google_calendar_conexiones c
      where c.business_id = p_business_id and c.professional_id = auth_professional_id();
  else
    raise exception 'No tenés permiso para ver esto.';
  end if;
end;
$$;
revoke all on function google_calendar_estado(uuid) from public, anon;
grant execute on function google_calendar_estado(uuid) to authenticated, service_role;

-- ── Cola de avisos: una función más ─────────────────────────────────────────
alter table envios_pendientes drop constraint if exists envios_pendientes_funcion_check;
alter table envios_pendientes add constraint envios_pendientes_funcion_check
  check (funcion in ('send-push', 'notify-cancellation', 'mandar-confirmacion', 'sincronizar-google'));

-- ── Cada cambio de un turno de un profesional conectado se sincroniza ───────
-- sincronizar-google no confía en el payload: relee el turno y deja el
-- calendario como corresponde AHORA (evento vivo, movido o borrado). Por eso
-- alcanza con mandarle el id y los profesionales involucrados (si cambió de
-- profesional, hay que sacarlo del calendario del anterior; si se borró la
-- fila, ya no hay de dónde leerlo).
create or replace function sincronizar_turno_con_google() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t appointments;
  profesionales uuid[];
begin
  if tg_op = 'DELETE' then
    t := old;
    profesionales := array[old.professional_id];
  elsif tg_op = 'INSERT' then
    t := new;
    profesionales := array[new.professional_id];
  else
    t := new;
    if new.status is not distinct from old.status
      and new.appointment_date is not distinct from old.appointment_date
      and new.start_time is not distinct from old.start_time
      and new.end_time is not distinct from old.end_time
      and new.professional_id is not distinct from old.professional_id
      and new.deposit_status is not distinct from old.deposit_status
      and new.client_name is not distinct from old.client_name
      and new.client_phone is not distinct from old.client_phone
      and new.service_name is not distinct from old.service_name
      and new.notes is not distinct from old.notes then
      return null;
    end if;
    profesionales := array[old.professional_id, new.professional_id];
  end if;

  if not exists (
    select 1 from google_calendar_conexiones
    where professional_id = any(profesionales) and error is null
  ) then
    return null;
  end if;

  perform encolar_envio('sincronizar-google', jsonb_build_object(
    'appointmentId', t.id,
    'profesionales', (select jsonb_agg(distinct p) from unnest(profesionales) p where p is not null)
  ));
  return null;
end;
$$;
revoke all on function sincronizar_turno_con_google() from public, anon, authenticated;

drop trigger if exists appointments_sincronizar_google on appointments;
create trigger appointments_sincronizar_google
  after insert or update or delete on appointments
  for each row execute function sincronizar_turno_con_google();

-- Al conectar (o reconectar) un calendario: todos sus turnos que vienen, en
-- UNA sola tarea (sincronizar-google con `completo`), así no salen cien
-- llamadas a Google en paralelo.
create or replace function google_sincronizar_profesional(p_professional_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform encolar_envio('sincronizar-google', jsonb_build_object(
    'professionalId', p_professional_id, 'completo', true
  ));
end;
$$;
revoke all on function google_sincronizar_profesional(uuid) from public, anon, authenticated;
grant execute on function google_sincronizar_profesional(uuid) to service_role;
