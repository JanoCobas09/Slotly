-- ============================================================================
-- Mail al dueño cuando el CLIENTE cancela un turno
-- ============================================================================
-- Hasta acá handle_turno_cancelado avisaba al dueño solo por push + la
-- campanita in-app (20260928010000_send_push_from_triggers.sql). Se suma un
-- tercer aviso, por mail, para quien no tiene push activado en el celular o
-- no lo vio en el momento — mismo criterio que ya se usa para la
-- confirmación al cliente (create-appointment) y el recordatorio
-- (send-reminders): nunca puede tirar abajo la cancelación ya hecha, por eso
-- vive en su propia Edge Function (notify-cancellation) detrás del mismo
-- `perform net.http_post` fire-and-forget que ya usa el push.
create or replace function handle_turno_cancelado() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_url text;
  service_key text;
  titulo text := 'Turno cancelado';
  mensaje text;
begin
  if old.status = 'cancelada' or new.status <> 'cancelada' then
    return new;
  end if;
  if new.cancelled_by <> 'client' then
    return new;
  end if;

  mensaje := coalesce(new.client_name, 'Un cliente') || ' canceló ' || coalesce(new.service_name, 'su turno')
    || ' · ' || to_char(new.appointment_date, 'DD/MM') || ' ' || new.start_time;

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date)
  values (new.business_id, 'turno_cancelado', titulo, mensaje, new.professional_id, new.id, new.appointment_date);

  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';

  if base_url is not null and service_key is not null then
    perform net.http_post(
      url := base_url || '/send-push',
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'businessId', new.business_id, 'professionalId', new.professional_id,
        'title', titulo, 'body', mensaje, 'url', '/admin/citas'
      )
    );
    perform net.http_post(
      url := base_url || '/notify-cancellation',
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object('appointmentId', new.id)
    );
  end if;

  return new;
end;
$$;
