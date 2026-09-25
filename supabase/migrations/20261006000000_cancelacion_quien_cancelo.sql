-- ============================================================================
-- Cancelaciones: el aviso dice QUIÉN canceló (cliente, dueño o profesional)
-- ============================================================================
-- Bug real: la agenda de Inicio (AccionesTurno.jsx) cancelaba con un update
-- de `status` solo, sin `cancelled_by`. En handle_turno_cancelado,
-- `null <> 'client'` da null (no true), así que no cortaba ahí: el negocio
-- recibía "Fulano canceló su turno" como si hubiera sido el cliente, y el
-- dueño además el mail de cancelación del cliente. Y cuando el staff
-- cancelaba bien (desde Citas), no se avisaba nada.
--
-- Arreglo: quién canceló lo decide la base, a partir de la sesión de quien
-- hace el UPDATE (el JWT), no de lo que mande la pantalla. Así ningún camino
-- del front puede volver a hacerse pasar por el cliente por olvido.

alter table appointments
  add column if not exists cancelled_by_name text;

comment on column appointments.cancelled_by_name is
  'Quién canceló, para mostrar: "el dueño (Jano)", "Pedro (profesional)". Lo completa el trigger, null si fue el cliente.';

-- BEFORE UPDATE: al pasar a 'cancelada', normaliza cancelled_by
-- ('client' | 'staff') y completa cancelled_by_name.
create or replace function registrar_quien_cancela() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  nombre text;
begin
  if new.status is distinct from 'cancelada' or old.status = 'cancelada' then
    return new;
  end if;

  new.cancelled_at := coalesce(new.cancelled_at, now());

  -- Sin sesión (service role, pg_cron): lo que haya mandado el servidor.
  if auth.uid() is null then
    new.cancelled_by := coalesce(new.cancelled_by, 'staff');
    return new;
  end if;

  if is_business_owner(new.business_id) then
    select a.name into nombre from admins a
    where a.business_id = new.business_id and lower(a.email) = lower(auth.jwt()->>'email')
    limit 1;
    nombre := coalesce(nullif(nombre, ''),
      (select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') from auth.users u where u.id = auth.uid()));
    new.cancelled_by := 'staff';
    new.cancelled_by_name := 'el dueño' || coalesce(' (' || nullif(nombre, '') || ')', '');
  elsif is_assigned_staff(new.business_id) and auth_professional_id() = new.professional_id then
    select p.name into nombre from professionals p where p.id = new.professional_id;
    new.cancelled_by := 'staff';
    new.cancelled_by_name := coalesce(nullif(nombre, ''), 'el profesional') || ' (profesional)';
  elsif auth.uid() = new.user_id then
    new.cancelled_by := 'client';
    new.cancelled_by_name := null;
  elsif auth_is_platform() then
    new.cancelled_by := 'staff';
    new.cancelled_by_name := 'la plataforma';
  else
    new.cancelled_by := coalesce(new.cancelled_by, 'staff');
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_quien_cancela on appointments;
create trigger appointments_quien_cancela
  before update on appointments
  for each row execute function registrar_quien_cancela();

-- AFTER UPDATE: el aviso. Cliente → igual que siempre (campanita + push +
-- mail al dueño). Negocio → campanita + push diciendo quién fue, sin mail
-- (el dueño no necesita un mail de algo que hizo él o su equipo).
create or replace function handle_turno_cancelado() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_url text;
  service_key text;
  titulo text;
  mensaje text;
  del_cliente boolean;
begin
  if old.status = 'cancelada' or new.status <> 'cancelada' then
    return new;
  end if;
  -- Un "servicio sin turno" es un bloque de agenda, no hay a quién avisarle.
  -- Un turno que todavía esperaba la seña nunca se le avisó al negocio.
  if new.type = 'walkin' or new.deposit_status = 'pendiente' then
    return new;
  end if;

  del_cliente := new.cancelled_by is not distinct from 'client';
  if del_cliente then
    titulo := 'Turno cancelado';
    mensaje := coalesce(new.client_name, 'Un cliente') || ' canceló ' || coalesce(new.service_name, 'su turno')
      || ' · ' || to_char(new.appointment_date, 'DD/MM') || ' ' || new.start_time;
  else
    titulo := 'Turno cancelado por el negocio';
    mensaje := 'Cancelado por ' || coalesce(new.cancelled_by_name, 'el negocio')
      || ': turno de ' || coalesce(nullif(new.client_name, ''), 'un cliente')
      || coalesce(' · ' || new.service_name, '')
      || ' · ' || to_char(new.appointment_date, 'DD/MM') || ' ' || new.start_time;
  end if;

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
    if del_cliente then
      perform net.http_post(
        url := base_url || '/notify-cancellation',
        headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object('appointmentId', new.id)
      );
    end if;
  end if;

  return new;
end;
$$;
