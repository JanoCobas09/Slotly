-- ============================================================================
-- Anticipación mínima: con cuántas horas de anticipación puede reservar un
-- cliente
-- ============================================================================
-- Caso real: con un mínimo de 3 horas, a las 14:00 el turno de las 16:00 ya
-- no se ofrece — el negocio no quiere enterarse de un turno cuando ya no
-- llega a organizarse. Es la otra punta de max_advance_days (hasta cuándo).
--
-- NULL = sin mínimo (el comportamiento de siempre): ningún negocio existente
-- cambia hasta que lo configure en Configuración.
alter table businesses
  add column if not exists min_advance_hours integer
    check (min_advance_hours is null or min_advance_hours between 1 and 168);

-- Mismo criterio que enforce_max_advance_days: un trigger chico aparte, sin
-- tocar create_appointment, y solo para turnos del CLIENTE (lo que carga el
-- propio negocio desde el panel no tiene mínimo). La grilla del cliente ya
-- esconde esos horarios; esto frena a quien se la saltee.
--
-- La fecha y la hora del turno son hora de Argentina (texto 'HH:MM', igual
-- que en todo el esquema), por eso se interpretan en ese huso antes de
-- compararlas con now().
create or replace function enforce_min_advance_hours() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  minimo integer;
  inicio timestamptz;
begin
  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  select min_advance_hours into minimo from businesses where id = new.business_id;
  if minimo is null then
    return new;
  end if;

  inicio := (new.appointment_date + new.start_time::time) at time zone 'America/Argentina/Buenos_Aires';
  if inicio < now() + make_interval(hours => minimo) then
    raise exception 'failed-precondition: Este negocio toma turnos con al menos % % de anticipación. Elegí un horario más adelante.',
      minimo, case when minimo = 1 then 'hora' else 'horas' end;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_enforce_min_advance_hours on appointments;
create trigger appointments_enforce_min_advance_hours
  before insert on appointments
  for each row execute function enforce_min_advance_hours();
