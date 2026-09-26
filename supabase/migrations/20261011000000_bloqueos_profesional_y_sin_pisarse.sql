-- ============================================================================
-- Bloqueos del profesional + un profesional nunca en dos lugares a la vez
-- ============================================================================
-- 1. Días bloqueados de un PROFESIONAL (blocked_days.professional_id): los
--    carga el propio profesional (o el dueño). Solo sacan de la grilla a ese
--    profesional; el negocio y sus sucursales siguen atendiendo. Quedan así
--    los tres alcances:
--      professional_id NULL, branch_id NULL  → todo el negocio (solo el dueño)
--      professional_id NULL, branch_id X     → una sucursal (dueño o su administrador)
--      professional_id P,    branch_id NULL  → un profesional, en todas las sucursales
-- 2. Horarios (schedules): un profesional no puede tener dos franjas que se
--    pisen el mismo día, aunque sean de sucursales distintas. Hasta acá solo
--    lo frenaban las pantallas.
-- 3. Turnos: tampoco dos turnos vivos que se pisen para el mismo profesional,
--    en ninguna sucursal. create_appointment ya lo chequeaba para el cliente;
--    el turno que carga el staff a mano (insert directo) no, y el
--    administrador de una sucursal no ve la agenda de las otras.

-- ── 1. Bloqueos del profesional ─────────────────────────────────────────────
alter table blocked_days
  add column if not exists professional_id uuid references professionals(id) on delete cascade;
create index if not exists blocked_days_professional_idx on blocked_days (professional_id);

-- Un bloqueo es de un solo alcance: el de un profesional no lleva sucursal.
alter table blocked_days drop constraint if exists blocked_days_un_alcance;
alter table blocked_days
  add constraint blocked_days_un_alcance check (professional_id is null or branch_id is null) not valid;

create or replace function blocked_days_sucursal() returns trigger
language plpgsql as $$
begin
  if new.branch_id is not null and not exists (select 1 from branches where id = new.branch_id and business_id = new.business_id) then
    raise exception 'invalid-argument: Esa sucursal no es de este negocio.';
  end if;
  if new.professional_id is not null and not exists (select 1 from professionals where id = new.professional_id and business_id = new.business_id) then
    raise exception 'invalid-argument: Ese profesional no es de este negocio.';
  end if;
  return new;
end;
$$;

-- La unicidad incluye ahora al profesional: el negocio y un profesional
-- pueden tener bloqueado el mismo día cada uno por su lado.
drop index if exists blocked_days_dia_entero_uniq;
create unique index blocked_days_dia_entero_uniq
  on blocked_days (
    business_id, date,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where start_time is null;
drop index if exists blocked_days_rango_uniq;
create unique index blocked_days_rango_uniq
  on blocked_days (
    business_id, date, start_time, end_time,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(professional_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where start_time is not null;

-- Quién escribe cada alcance:
--   dueño/plataforma → cualquiera
--   administrador de sucursal → solo los de SU sucursal (sin profesional)
--   profesional (rol admin) → solo los suyos (sin sucursal)
drop policy if exists blocked_days_write on blocked_days;
create policy blocked_days_write on blocked_days
  using (
    can_manage(business_id)
    or (professional_id is null and is_branch_manager(business_id, branch_id))
    or (branch_id is null and is_assigned_staff(business_id) and professional_id = auth_professional_id())
  )
  with check (
    can_manage(business_id)
    or (professional_id is null and is_branch_manager(business_id, branch_id))
    or (branch_id is null and is_assigned_staff(business_id) and professional_id = auth_professional_id())
  );

-- El trigger que frena el turno del cliente: cuentan los del negocio, los de
-- la sucursal del turno y los del profesional del turno.
create or replace function enforce_blocked_days() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fin text;
begin
  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  -- Del negocio o de la sucursal del turno (mismos mensajes de siempre).
  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date and start_time is null
      and professional_id is null
      and (branch_id is null or branch_id = new.branch_id)
  ) then
    raise exception 'failed-precondition: El negocio no atiende el %. Elegí otro día.',
      to_char(new.appointment_date, 'DD/MM');
  end if;

  fin := coalesce(new.end_time, new.start_time);
  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date
      and start_time is not null
      and professional_id is null
      and (branch_id is null or branch_id = new.branch_id)
      and new.start_time < end_time and fin > start_time
  ) then
    raise exception 'failed-precondition: El negocio no atiende en ese horario. Elegí otro.';
  end if;

  -- Del profesional del turno.
  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date
      and professional_id = new.professional_id
      and (start_time is null or (new.start_time < end_time and fin > start_time))
  ) then
    raise exception 'failed-precondition: El profesional no atiende en ese horario. Elegí otro día u horario.';
  end if;
  return new;
end;
$$;

-- ── 2. Franjas que no se pisan (en ninguna sucursal) ────────────────────────
-- Los reemplazos de horario (replaceMatching / replaceSchedulesDeSucursal)
-- borran antes de insertar, y un trigger de fila ve las filas que el mismo
-- INSERT ya metió: también frena dos franjas pisadas dentro del mismo lote.
create or replace function schedules_sin_pisarse() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active is false or coalesce(new.start_time, '') = '' or coalesce(new.end_time, '') = '' then
    return new;
  end if;
  if exists (
    select 1 from schedules s
    where s.professional_id = new.professional_id
      and s.day_of_week = new.day_of_week
      and s.id <> new.id
      and s.is_active is not false
      and coalesce(s.start_time, '') <> '' and coalesce(s.end_time, '') <> ''
      and s.start_time < new.end_time and new.start_time < s.end_time
  ) then
    raise exception 'invalid-argument: Ese horario se pisa con otro del mismo profesional (en esta u otra sucursal).';
  end if;
  return new;
end;
$$;

drop trigger if exists schedules_1_sin_pisarse on schedules;
create trigger schedules_1_sin_pisarse
  before insert or update of professional_id, day_of_week, start_time, end_time, is_active on schedules
  for each row execute function schedules_sin_pisarse();

-- ── 3. Turnos vivos que no se pisan (en ninguna sucursal) ───────────────────
create or replace function turnos_sin_pisarse() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fin text;
begin
  if new.status not in ('pendiente', 'confirmada') or new.professional_id is null or coalesce(new.start_time, '') = '' then
    return new;
  end if;
  -- El "servicio sin turno" registra lo que ya pasó en la silla (por ejemplo
  -- en el lugar de un cliente que no vino): no se frena.
  if coalesce(new.type, '') = 'walkin' then
    return new;
  end if;
  -- En un UPDATE solo si cambió algo que mueve el turno (o si revive).
  if tg_op = 'UPDATE'
    and new.professional_id is not distinct from old.professional_id
    and new.appointment_date is not distinct from old.appointment_date
    and new.start_time is not distinct from old.start_time
    and new.end_time is not distinct from old.end_time
    and old.status in ('pendiente', 'confirmada')
  then
    return new;
  end if;

  -- Mismo candado que create_appointment: dos altas a la vez para el mismo
  -- profesional y día no pueden pasar las dos el chequeo.
  perform pg_advisory_xact_lock(hashtextextended(new.professional_id::text || ':' || new.appointment_date::text, 0));

  fin := coalesce(nullif(new.end_time, ''), new.start_time);
  if exists (
    select 1 from appointments a
    where a.professional_id = new.professional_id
      and a.appointment_date = new.appointment_date
      and a.id <> new.id
      and a.status in ('pendiente', 'confirmada')
      and a.start_time < fin
      and coalesce(nullif(a.end_time, ''), a.start_time) > new.start_time
  ) then
    raise exception 'already-exists: Ese profesional ya tiene un turno en ese horario (en esta u otra sucursal).';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_1_sin_pisarse on appointments;
create trigger appointments_1_sin_pisarse
  before insert or update of professional_id, appointment_date, start_time, end_time, status on appointments
  for each row execute function turnos_sin_pisarse();
