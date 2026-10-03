-- ============================================================================
-- Avisos por WhatsApp, manuales, desde el panel
-- ============================================================================
-- El negocio le manda al cliente, con un botón, la confirmación ("Agendaste
-- un turno...") y, desde el día anterior hasta que empieza, el recordatorio
-- ("Recordá que tenés un turno..."). El botón abre WhatsApp con el mensaje
-- armado (link wa.me: sin API de Meta, sin costo) y anota acá cuándo se tocó.
-- No hay envío automático a propósito: lo pidió así el usuario.
--
-- `whatsapp_confirmacion_at` / `whatsapp_recordatorio_at`: NULL = no se mandó.

alter table appointments add column if not exists whatsapp_confirmacion_at timestamptz;
alter table appointments add column if not exists whatsapp_recordatorio_at timestamptz;

-- Los marca solo quien gestiona el turno (dueño, administrador de su
-- sucursal, el profesional asignado, la plataforma) — la misma lista que
-- protect_appointment_client_cancel. El cliente, que puede hacer UPDATE de
-- su turno para cancelarlo, no.
--
-- Y si al turno le cambian el día o la hora, los avisos ya mandados tenían
-- los datos viejos: se borran las marcas para que el botón vuelva a ofrecer
-- la confirmación con los datos nuevos.
create or replace function proteger_avisos_whatsapp() returns trigger
language plpgsql as $$
begin
  if new.whatsapp_confirmacion_at is distinct from old.whatsapp_confirmacion_at
    or new.whatsapp_recordatorio_at is distinct from old.whatsapp_recordatorio_at
  then
    -- coalesce: sin claims de profesional, `auth_professional_id() = ...` es
    -- NULL, y `not (... or NULL)` también — dejaba pasar al cliente.
    if coalesce(auth.role(), '') in ('authenticated', 'anon')
      and not coalesce(
        is_business_owner(new.business_id)
        or auth_is_platform()
        or (is_assigned_staff(new.business_id) and auth_professional_id() = new.professional_id)
        or is_branch_manager(new.business_id, old.branch_id),
        false
      )
    then
      raise exception 'Solo el negocio marca los avisos por WhatsApp.';
    end if;
    return new;
  end if;

  if new.appointment_date is distinct from old.appointment_date
    or new.start_time is distinct from old.start_time
  then
    new.whatsapp_confirmacion_at := null;
    new.whatsapp_recordatorio_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_avisos_whatsapp on appointments;
create trigger appointments_avisos_whatsapp
  before update on appointments
  for each row execute function proteger_avisos_whatsapp();
