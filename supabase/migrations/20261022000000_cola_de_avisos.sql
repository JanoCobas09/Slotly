-- ============================================================================
-- Cola de avisos: ningún aviso se pierde en silencio
-- ============================================================================
-- Hasta acá los triggers llamaban a las Edge Functions con pg_net y se
-- olvidaban: si la función estaba caída, tardaba o rechazaba la clave (pasó
-- el 24/09: 401 durante horas, cero push y cero recordatorios), el aviso se
-- perdía sin rastro. Y el mail de confirmación al cliente salía de
-- create-appointment / mp-webhook en un solo intento.
--
-- Ahora cada aviso es una fila de `envios_pendientes`. La Edge Function la
-- marca `procesado_at` recién cuando el aviso le llegó a todos (o cuando no
-- hay forma de que llegue: sin destinatarios, turno ya cancelado...), y
-- `reintentar_envios()` (pg_cron, cada 2 minutos) vuelve a mandar las que no
-- se marcaron, con espera creciente (2, 4, 8, 16, 32 min). `progreso` lo
-- escribe la función para no repetirle el aviso a quien ya lo recibió.

create table if not exists envios_pendientes (
  id uuid primary key default gen_random_uuid(),
  funcion text not null check (funcion in ('send-push', 'notify-cancellation', 'mandar-confirmacion')),
  payload jsonb not null,
  progreso jsonb not null default '{}'::jsonb,
  intentos smallint not null default 0,
  ultimo_intento_at timestamptz,
  procesado_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists envios_pendientes_sin_procesar_idx
  on envios_pendientes (created_at) where procesado_at is null;

-- Solo la usan los triggers y las Edge Functions (service role): sin policies.
alter table envios_pendientes enable row level security;
revoke all on envios_pendientes from anon, authenticated;
grant select, insert, update, delete on envios_pendientes to service_role;

comment on table envios_pendientes is
  'Cola de avisos (push, mail de cancelación al dueño, confirmación al cliente). procesado_at NULL = todavía no salió: reintentar_envios() la vuelve a mandar.';

create or replace function despachar_envio(eid uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_url text;
  service_key text;
  e envios_pendientes;
begin
  update envios_pendientes set intentos = intentos + 1, ultimo_intento_at = now()
  where id = eid and procesado_at is null
  returning * into e;
  if e.id is null then
    return;
  end if;

  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';
  if base_url is null or service_key is null then
    return;
  end if;

  perform net.http_post(
    url := base_url || '/' || e.funcion,
    headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
    body := e.payload || jsonb_build_object('envioId', e.id)
  );
end;
$$;

create or replace function encolar_envio(p_funcion text, p_payload jsonb) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eid uuid;
begin
  insert into envios_pendientes (funcion, payload) values (p_funcion, p_payload) returning id into eid;
  perform despachar_envio(eid);
end;
$$;

create or replace function reintentar_envios() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from envios_pendientes
    where procesado_at is null
      and intentos < 6
      and created_at > now() - interval '6 hours'
      and ultimo_intento_at < now() - interval '2 minutes' * power(2, greatest(intentos - 1, 0))
    order by created_at
    limit 50
  loop
    perform despachar_envio(r.id);
    n := n + 1;
  end loop;

  delete from envios_pendientes where created_at < now() - interval '7 days';
  return n;
end;
$$;

revoke all on function despachar_envio(uuid) from public, anon, authenticated;
revoke all on function encolar_envio(text, jsonb) from public, anon, authenticated;
revoke all on function reintentar_envios() from public, anon, authenticated;

select cron.schedule('reintentar-envios', '*/2 * * * *', $$select reintentar_envios()$$);

-- Turno nuevo (o seña pagada): aviso al negocio + confirmación al cliente.
-- Igual que en 20261009000000_sucursales.sql salvo que todo pasa por la cola.
-- `avisarSinPush`: el dueño que nunca activó el push también se entera (mail).
create or replace function notificar_nuevo_turno(t appointments, titulo text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  mensaje text;
begin
  mensaje := coalesce(t.client_name, 'Un cliente') || ' reservó ' || coalesce(t.service_name, 'un servicio')
    || ' · ' || to_char(t.appointment_date, 'DD/MM') || ' ' || t.start_time;

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date, branch_id)
  values (t.business_id, 'nuevo_turno', titulo, mensaje, t.professional_id, t.id, t.appointment_date, t.branch_id);

  perform encolar_envio('send-push', jsonb_build_object(
    'businessId', t.business_id, 'professionalId', t.professional_id, 'branchId', t.branch_id,
    'title', titulo, 'body', mensaje, 'url', '/admin/citas',
    'respaldoMail', true, 'avisarSinPush', true
  ));

  if t.client_email is not null then
    perform encolar_envio('mandar-confirmacion', jsonb_build_object('appointmentId', t.id));
  end if;
end;
$$;

revoke all on function notificar_nuevo_turno(appointments, text) from public, anon, authenticated;

-- Igual que en 20261021000000_push_caido_respaldo_mail.sql, por la cola.
create or replace function handle_turno_cancelado() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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

  -- Cuando cancela el cliente, el mail al dueño lo manda notify-cancellation
  -- (más completo); el respaldo de send-push sería un segundo mail.
  perform encolar_envio('send-push', jsonb_build_object(
    'businessId', new.business_id, 'professionalId', new.professional_id, 'branchId', new.branch_id,
    'title', titulo, 'body', mensaje, 'url', '/admin/citas',
    'respaldoMail', not del_cliente
  ));
  if del_cliente then
    perform encolar_envio('notify-cancellation', jsonb_build_object('appointmentId', new.id));
  end if;

  return new;
end;
$$;
