-- ============================================================================
-- Aviso de cancelación por WhatsApp
-- ============================================================================
-- Mismo mecanismo que 20261017000000_avisos_whatsapp.sql: sobre un turno
-- cancelado (que todavía no pasó), el negocio le avisa al cliente con un
-- botón que abre WhatsApp, y acá queda cuándo lo hizo.

alter table appointments add column if not exists whatsapp_cancelacion_at timestamptz;

-- La misma regla para las tres marcas: solo las toca quien gestiona el turno.
-- Mover día u hora sigue borrando las dos de antes (confirmación y
-- recordatorio); la de cancelación no tiene datos que queden viejos.
create or replace function proteger_avisos_whatsapp() returns trigger
language plpgsql as $$
begin
  if new.whatsapp_confirmacion_at is distinct from old.whatsapp_confirmacion_at
    or new.whatsapp_recordatorio_at is distinct from old.whatsapp_recordatorio_at
    or new.whatsapp_cancelacion_at is distinct from old.whatsapp_cancelacion_at
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
