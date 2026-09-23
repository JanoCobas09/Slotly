-- ============================================================================
-- handle_nuevo_turno / handle_turno_cancelado: ahora también mandan push
-- ============================================================================
-- Extiende los triggers de la Fase 3 (20260925000000_billing_and_notifications.sql)
-- para, además de escribir la notificación in-app, llamar a la Edge Function
-- send-push vía pg_net — el equivalente a que enviarPush() se llamara desde
-- el mismo trigger que notificar() en el functions/index.js original.
--
-- Un trigger de Postgres no puede hablar HTTP por sí solo; pg_net lo permite
-- pero necesita saber A QUÉ URL pegarle y con qué credencial — eso varía por
-- entorno (local vs. el proyecto real). Se lee de la tabla `app_settings`
-- (ver 20260928020000_app_settings_table.sql) en vez de un GUC porque
-- `alter database ... set app.algo` da "permission denied": el rol
-- `postgres` de Supabase no es superusuario real, ni siquiera en local.
--
-- Si `app_settings` no tiene las dos filas (o la Edge Function no responde),
-- el trigger sigue escribiendo la notificación in-app normal y no rompe —
-- mismo criterio de "nunca tirar abajo el trigger" que ya tenía enviarPush().
create extension if not exists pg_net;

create or replace function handle_nuevo_turno() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_url text;
  service_key text;
  titulo text := 'Nuevo turno';
  mensaje text;
begin
  if new.type in ('walkin', 'manual') then
    return new;
  end if;

  mensaje := coalesce(new.client_name, 'Un cliente') || ' reservó ' || coalesce(new.service_name, 'un servicio')
    || ' · ' || to_char(new.appointment_date, 'DD/MM') || ' ' || new.start_time;

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date)
  values (new.business_id, 'nuevo_turno', titulo, mensaje, new.professional_id, new.id, new.appointment_date);

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
  end if;

  return new;
end;
$$;

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
  end if;

  return new;
end;
$$;
