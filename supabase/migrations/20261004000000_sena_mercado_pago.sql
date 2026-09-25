-- ============================================================================
-- Seña obligatoria con Mercado Pago (opcional por negocio, apagada por defecto)
-- ============================================================================
-- Modelo: cada negocio conecta SU cuenta de Mercado Pago por OAuth
-- ("Conectar Mercado Pago" en Configuración). Slotly guarda el token que MP
-- le da para esa cuenta y arma el cobro en nombre del negocio: la plata va
-- del cliente directo a la cuenta del negocio, nunca pasa por la de Slotly.
--
-- Flujo de un turno con seña:
--   1. create_appointment inserta el turno como siempre ('pendiente'). El
--      trigger de abajo (BEFORE INSERT) ve que el negocio pide seña y le
--      marca deposit_status = 'pendiente' + 15 minutos para pagar. El turno
--      ocupa el horario desde ya (sigue siendo 'pendiente' para todo lo que
--      calcula solapamientos: create_appointment, get-busy-slots, agenda).
--   2. La Edge Function create-appointment arma la preferencia de pago en MP
--      y devuelve el link al checkout.
--   3. MP avisa a mp-webhook; la función verifica el pago contra la API de
--      MP y pasa deposit_status a 'pagada'. Recién ahí salen el aviso al
--      negocio (trigger de abajo) y el mail de confirmación al cliente.
--   4. Si no se pagó en 15 minutos, liberar_senas_vencidas() (pg_cron, cada
--      minuto) borra el turno y el horario vuelve a quedar libre.
--   5. El dueño puede devolver una seña pagada desde el panel (mp-refund).

-- ── Configuración por negocio (pública: la página de reserva la muestra) ───
alter table businesses
  add column if not exists deposit_enabled boolean not null default false,
  add column if not exists deposit_type text not null default 'percent'
    check (deposit_type in ('fixed', 'percent')),
  add column if not exists deposit_value numeric
    check (deposit_value is null or deposit_value > 0);

comment on column businesses.deposit_enabled is
  'Seña obligatoria para reservar. Solo aplica si además hay una fila en mp_connections.';

-- ── Conexión OAuth con la cuenta de Mercado Pago de cada negocio ───────────
-- 🔒 Nadie la lee desde el browser: el token permite cobrar y devolver plata
-- en la cuenta del negocio. Solo las Edge Functions (service role).
create table if not exists mp_connections (
  business_id uuid primary key references businesses(id) on delete cascade,
  mp_user_id text not null,
  nickname text,
  access_token text not null,
  refresh_token text,
  public_key text,
  expires_at timestamptz,
  live_mode boolean,
  connected_at timestamptz not null default now()
);
alter table mp_connections enable row level security;
revoke all on mp_connections from public, anon, authenticated;
grant select, insert, update, delete on mp_connections to service_role;

-- `state` del OAuth: lo genera mp-oauth-start y lo consume mp-oauth-callback.
-- Es lo que impide que alguien le conecte SU cuenta de MP a un negocio ajeno
-- mandándole al dueño un link de callback armado.
create table if not exists mp_oauth_states (
  state text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null,
  -- Origen del panel desde el que se pidió conectar (producción o un
  -- localhost de desarrollo): a dónde vuelve el dueño al terminar.
  volver_a text not null,
  created_at timestamptz not null default now()
);
alter table mp_oauth_states enable row level security;
revoke all on mp_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on mp_oauth_states to service_role;

-- Lo único que el panel necesita saber de la conexión: si existe y con qué
-- cuenta. Nunca el token.
create or replace function mp_connection_status(p_business_id uuid)
returns table (connected boolean, nickname text, live_mode boolean, connected_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (is_business_owner(p_business_id) or auth_is_platform()) then
    raise exception 'No tenés permiso para ver esto.';
  end if;
  return query
    select true, c.nickname, c.live_mode, c.connected_at
    from mp_connections c where c.business_id = p_business_id;
end;
$$;
revoke all on function mp_connection_status(uuid) from public, anon;
grant execute on function mp_connection_status(uuid) to authenticated, service_role;

-- ── Seña en el turno ───────────────────────────────────────────────────────
alter table appointments
  add column if not exists deposit_amount numeric,
  -- null = el turno no lleva seña (todos los de antes, los del staff, y los
  -- de negocios que no la piden).
  add column if not exists deposit_status text
    check (deposit_status in ('pendiente', 'pagada', 'devuelta')),
  add column if not exists deposit_expires_at timestamptz,
  add column if not exists deposit_checkout_url text,
  add column if not exists mp_preference_id text,
  add column if not exists mp_payment_id text,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists deposit_refunded_at timestamptz;

create index if not exists appointments_sena_pendiente_idx
  on appointments (deposit_expires_at) where deposit_status = 'pendiente';

-- BEFORE INSERT: decide si el turno lleva seña. En un trigger y no dentro de
-- create_appointment por el mismo motivo que max_advance_days/blocked_days:
-- esa función es larga y crítica, esto no la toca.
--
-- Solo turnos del CLIENTE. Lo que carga el staff (manual/walk-in) nunca pide
-- seña — y si alguien desde el browser intenta insertar un turno ya
-- "pagado", se le vacían los campos.
create or replace function aplicar_sena_obligatoria() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  negocio businesses;
  monto numeric;
begin
  new.deposit_amount := null;
  new.deposit_status := null;
  new.deposit_expires_at := null;
  new.deposit_checkout_url := null;
  new.mp_preference_id := null;
  new.mp_payment_id := null;
  new.deposit_paid_at := null;
  new.deposit_refunded_at := null;

  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  select * into negocio from businesses where id = new.business_id;
  if not found or not negocio.deposit_enabled or negocio.deposit_value is null then
    return new;
  end if;
  -- Sin cuenta de MP conectada no hay cómo cobrar: se reserva como siempre.
  if not exists (select 1 from mp_connections where business_id = new.business_id) then
    return new;
  end if;
  -- Mercado Pago de Argentina cobra en pesos.
  if coalesce(negocio.currency, 'ARS') <> 'ARS' then
    return new;
  end if;

  if negocio.deposit_type = 'fixed' then
    monto := negocio.deposit_value;
    -- Una seña nunca puede ser más que el turno.
    if new.price is not null and new.price > 0 then
      monto := least(monto, new.price);
    end if;
  else
    monto := round(coalesce(new.price, 0) * least(negocio.deposit_value, 100) / 100, 2);
  end if;

  if monto is null or monto <= 0 then
    return new;
  end if;

  new.deposit_amount := monto;
  new.deposit_status := 'pendiente';
  new.deposit_expires_at := now() + interval '15 minutes';
  return new;
end;
$$;

drop trigger if exists appointments_sena_obligatoria on appointments;
create trigger appointments_sena_obligatoria
  before insert on appointments
  for each row execute function aplicar_sena_obligatoria();

-- BEFORE UPDATE: los campos de la seña solo los toca el servidor (webhook de
-- MP, devolución). Sin esto, el cliente —que puede hacer UPDATE de su propio
-- turno para cancelarlo— podía marcarse la seña como pagada desde la consola.
-- auth.role() es 'authenticated'/'anon' cuando viene del browser, y
-- 'service_role' (o null, desde pg_cron) cuando viene del servidor.
create or replace function proteger_campos_sena() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.deposit_amount is distinct from old.deposit_amount
    or new.deposit_status is distinct from old.deposit_status
    or new.deposit_expires_at is distinct from old.deposit_expires_at
    or new.deposit_checkout_url is distinct from old.deposit_checkout_url
    or new.mp_preference_id is distinct from old.mp_preference_id
    or new.mp_payment_id is distinct from old.mp_payment_id
    or new.deposit_paid_at is distinct from old.deposit_paid_at
    or new.deposit_refunded_at is distinct from old.deposit_refunded_at
  then
    raise exception 'Los datos de la seña solo los modifica Mercado Pago.';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_proteger_sena on appointments;
create trigger appointments_proteger_sena
  before update on appointments
  for each row execute function proteger_campos_sena();

-- ── Aviso de "nuevo turno": recién cuando la seña está pagada ──────────────
-- Un turno esperando seña todavía no es un turno: si nunca se paga, se borra
-- solo a los 15 minutos. Avisarle al negocio antes sería ruido (y un push de
-- un turno que después desaparece). El cuerpo del aviso se factoriza para
-- usarlo igual desde el INSERT (sin seña) y desde el pago (con seña).
create or replace function notificar_nuevo_turno(t appointments, titulo text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_url text;
  service_key text;
  mensaje text;
begin
  mensaje := coalesce(t.client_name, 'Un cliente') || ' reservó ' || coalesce(t.service_name, 'un servicio')
    || ' · ' || to_char(t.appointment_date, 'DD/MM') || ' ' || t.start_time;

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date)
  values (t.business_id, 'nuevo_turno', titulo, mensaje, t.professional_id, t.id, t.appointment_date);

  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';

  if base_url is not null and service_key is not null then
    perform net.http_post(
      url := base_url || '/send-push',
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'businessId', t.business_id, 'professionalId', t.professional_id,
        'title', titulo, 'body', mensaje, 'url', '/admin/citas'
      )
    );
  end if;
end;
$$;
revoke all on function notificar_nuevo_turno(appointments, text) from public, anon, authenticated;

create or replace function handle_nuevo_turno() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.type in ('walkin', 'manual') then
    return new;
  end if;
  -- Espera la seña: avisa handle_sena_pagada cuando llegue el pago.
  if new.deposit_status = 'pendiente' then
    return new;
  end if;
  perform notificar_nuevo_turno(new, 'Nuevo turno');
  return new;
end;
$$;

create or replace function handle_sena_pagada() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.deposit_status is distinct from 'pendiente' or new.deposit_status is distinct from 'pagada' then
    return new;
  end if;
  perform notificar_nuevo_turno(new, 'Nuevo turno · seña pagada');
  return new;
end;
$$;

drop trigger if exists trg_sena_pagada on appointments;
create trigger trg_sena_pagada
  after update of deposit_status on appointments
  for each row execute function handle_sena_pagada();

-- ── Liberar los horarios de señas que no se pagaron a tiempo ───────────────
-- Se BORRAN, no se cancelan: el turno nunca existió para el negocio (no se
-- le avisó, no está en su agenda como reserva real), y una cancelación
-- dispararía el aviso de "el cliente canceló". Si MP igual aprueba un pago
-- tarde, mp-webhook no encuentra el turno y lo devuelve solo.
--
-- 2 minutos de margen sobre el vencimiento: el checkout de MP se cierra
-- justo a los 15, pero el aviso de un pago aprobado en el último segundo
-- puede tardar un poco en llegar — sin margen, ese cliente pagaba y se
-- quedaba sin turno (con la plata devuelta, pero sin turno).
create or replace function liberar_senas_vencidas() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  borrados integer;
begin
  delete from appointments
  where deposit_status = 'pendiente' and deposit_expires_at < now() - interval '2 minutes';
  get diagnostics borrados = row_count;
  return borrados;
end;
$$;
revoke all on function liberar_senas_vencidas() from public, anon, authenticated;
grant execute on function liberar_senas_vencidas() to service_role;

-- Cada minuto: es SQL puro (no llama a ninguna Edge Function), así que no
-- necesita URL ni service role key como los otros dos cron.
create extension if not exists pg_cron;
select cron.schedule('liberar-senas-vencidas', '* * * * *', $$select liberar_senas_vencidas()$$);
