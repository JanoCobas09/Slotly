-- ============================================================================
-- Ventana de reserva: hasta cuántos días hacia adelante puede reservar un
-- cliente
-- ============================================================================
-- Caso real: el negocio sabe sus horarios de esta semana pero no los de la
-- que viene, y no quiere que le saquen turno en días que todavía no definió.
--
-- NULL = sin límite (el comportamiento de siempre): ningún negocio existente
-- cambia hasta que lo configure en Configuración.
alter table businesses
  add column if not exists max_advance_days integer
    check (max_advance_days is null or max_advance_days between 1 and 365);

-- Se hace cumplir con un trigger aparte y no dentro de create_appointment():
-- esa función es larga y ya se redefinió más de una vez; un trigger chico e
-- independiente no la toca, y frena cualquier camino de alta de un turno de
-- cliente, no solo ese.
--
-- Solo aplica a turnos del CLIENTE. Los que carga el propio negocio desde el
-- panel ('manual') o los walk-in no tienen límite: el dueño sabe cuándo puede.
-- El mensaje sigue el formato 'código: texto' que create-appointment ya
-- traduce a un error legible para el cliente (errorDeFuncionSql).
create or replace function enforce_max_advance_days() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  limite integer;
  hasta date;
begin
  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  select max_advance_days into limite from businesses where id = new.business_id;
  if limite is null then
    return new;
  end if;

  hasta := hoy_en_argentina() + limite;
  if new.appointment_date > hasta then
    raise exception 'failed-precondition: Por ahora solo se pueden reservar turnos hasta el %.',
      to_char(hasta, 'DD/MM');
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_enforce_max_advance_days on appointments;
create trigger appointments_enforce_max_advance_days
  before insert on appointments
  for each row execute function enforce_max_advance_days();
