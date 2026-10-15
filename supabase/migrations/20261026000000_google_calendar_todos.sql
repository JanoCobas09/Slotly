-- ============================================================================
-- Google Calendar: lo ocupado en TODOS los calendarios del profesional, y
-- cada profesional decide si sus actividades bloquean turnos
-- ============================================================================
-- Pedido del usuario (14/10/2026): si el profesional tiene una actividad en
-- su Google, ese horario no se ofrece. Hasta acá solo se miraba el calendario
-- PRINCIPAL: lo anotado en otro calendario suyo ("Personal", "Familia",
-- "Gimnasio") no bloqueaba. Ahora se pide además el permiso de solo lectura
-- de la lista de calendarios (calendar.calendarlist.readonly) y se leen
-- todos los calendarios de los que es DUEÑO (no los de otros que solo tiene
-- compartidos, ni los de feriados) que no tenga ocultos.
--
-- Las conexiones hechas antes de este permiso siguen andando con el
-- principal (lee_todos = false) y el panel les ofrece volver a conectar.
--
-- `bloquea` (pedido del usuario): el profesional elige si sus actividades
-- de Google BLOQUEAN turnos (por defecto sí: que no haya solapamiento) — no
-- se ofrecen online, create-appointment las frena y el panel no deja
-- elegirlas al cargar uno a mano — o si solo se MUESTRAN (no frenan nada; el
-- panel avisa). Lo cambia el propio profesional o el dueño, por gcal-conexion
-- ('preferencias').
--
-- Encapsulamiento entre profesionales: cada uno tiene SU conexión y su Google
-- solo afecta SU agenda. gcal-oauth-callback además no deja conectar la
-- misma cuenta de Google a dos profesionales del mismo negocio (pasaba si el
-- dueño tocaba "Conectar" en otro con su propia cuenta abierta).

alter table google_calendar_conexiones
  -- Dio el permiso de la lista de calendarios.
  add column if not exists lee_todos boolean not null default false,
  -- Ids de sus calendarios, guardados un rato para no pedir la lista en
  -- cada consulta de la grilla (_shared/google.ts, calendariosALeer).
  add column if not exists calendarios text[],
  add column if not exists calendarios_at timestamptz,
  add column if not exists bloquea boolean not null default true;

-- Cambia lo que devuelve: hay que borrarla y crearla de nuevo.
drop function if exists google_calendar_estado(uuid);
create function google_calendar_estado(p_business_id uuid)
returns table (professional_id uuid, google_email text, conectado_at timestamptz, error text, lee_todos boolean, bloquea boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if is_business_owner(p_business_id) or auth_is_platform() then
    return query
      select c.professional_id, c.google_email, c.conectado_at, c.error, c.lee_todos, c.bloquea
      from google_calendar_conexiones c where c.business_id = p_business_id;
  elsif is_assigned_staff(p_business_id) and auth_professional_id() is not null then
    return query
      select c.professional_id, c.google_email, c.conectado_at, c.error, c.lee_todos, c.bloquea
      from google_calendar_conexiones c
      where c.business_id = p_business_id and c.professional_id = auth_professional_id();
  else
    raise exception 'No tenés permiso para ver esto.';
  end if;
end;
$$;
revoke all on function google_calendar_estado(uuid) from public, anon;
grant execute on function google_calendar_estado(uuid) to authenticated, service_role;
