-- ============================================================================
-- Días bloqueados: también por rango horario, no solo el día entero
-- ============================================================================
-- "Mañana no trabajo a la mañana, a la tarde sí." Un bloqueo puede tener un
-- horario (start_time/end_time, 'HH:MM'); sin horario sigue siendo el día
-- entero, como hasta ahora — las filas que ya existen no cambian de sentido.
-- Un mismo día puede tener varios rangos (9 a 13 y 17 a 18).
alter table public.blocked_days
  add column if not exists start_time text,
  add column if not exists end_time text;

alter table public.blocked_days
  add constraint blocked_days_rango_valido check (
    (start_time is null and end_time is null)
    or (
      start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and start_time < end_time
    )
  );

-- La unicidad (negocio, día) ya no alcanza: un día puede tener varios rangos.
-- Queda: un solo bloqueo de día entero por fecha, y no repetir el mismo rango.
alter table public.blocked_days drop constraint if exists blocked_days_business_id_date_key;
create unique index if not exists blocked_days_dia_entero_uniq
  on public.blocked_days (business_id, date) where start_time is null;
create unique index if not exists blocked_days_rango_uniq
  on public.blocked_days (business_id, date, start_time, end_time) where start_time is not null;

-- El trigger ahora mira también los rangos: rechaza un turno de CLIENTE que
-- caiga en un día bloqueado entero o que se pise con un rango bloqueado.
-- 'HH:MM' con cero adelante compara bien como texto.
create or replace function enforce_blocked_days() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fin text;
begin
  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date and start_time is null
  ) then
    raise exception 'failed-precondition: El negocio no atiende el %. Elegí otro día.',
      to_char(new.appointment_date, 'DD/MM');
  end if;

  fin := coalesce(new.end_time, new.start_time);
  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date
      and start_time is not null
      and new.start_time < end_time and fin > start_time
  ) then
    raise exception 'failed-precondition: El negocio no atiende en ese horario. Elegí otro.';
  end if;
  return new;
end;
$$;
