-- ============================================================================
-- Push caído: se marca en vez de borrarse, y el aviso sale por mail
-- ============================================================================
-- Caso real (09/10/2026, Reiz): el servicio de push dio por muerta la única
-- suscripción del dueño (404/410), send-push la borró, y desde ahí el negocio
-- se quedó sin avisos sin que nadie se enterara. Ahora:
--   * send-push marca `baja_at` en vez de borrar: la fila que queda es la
--     prueba de que esa persona QUERÍA avisos en el celular.
--   * Si a alguien que tiene push no le llegó a ningún dispositivo, send-push
--     le manda ese mismo aviso por mail (con cómo reactivarlo). Deja de
--     hacerlo a los 30 días de la baja (send-push borra la fila).
--   * El panel, al abrirse con el permiso dado, se vuelve a registrar solo
--     (lib/push.js, sincronizarPush) y borra la fila caída de ese dispositivo.

alter table push_subscriptions add column if not exists baja_at timestamptz;

comment on column push_subscriptions.baja_at is
  'NULL = vigente. Fecha en que el servicio de push la rechazó (404/410): no se le manda más, pero su dueño recibe los avisos por mail hasta volver a registrarse.';

-- Igual que en 20261009000000_sucursales.sql salvo `respaldoMail`: cuando
-- cancela el CLIENTE, notify-cancellation ya le manda un mail al dueño, y
-- el respaldo de send-push sería un segundo mail por lo mismo.
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

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date, branch_id)
  values (new.business_id, 'turno_cancelado', titulo, mensaje, new.professional_id, new.id, new.appointment_date, new.branch_id);

  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';

  if base_url is not null and service_key is not null then
    perform net.http_post(
      url := base_url || '/send-push',
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'businessId', new.business_id, 'professionalId', new.professional_id, 'branchId', new.branch_id,
        'title', titulo, 'body', mensaje, 'url', '/admin/citas',
        'respaldoMail', not del_cliente
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
