-- ============================================================================
-- Sucursales
-- ============================================================================
-- Un negocio puede atender en varios lugares. Cada sucursal tiene su horario
-- de atención (o usa el general del negocio), sus datos de contacto y sus
-- precios (o los del servicio). Un profesional puede trabajar en varias:
-- cada franja de su horario (`schedules`) dice en qué sucursal es — como no
-- puede estar en dos lugares a la vez, la hora de un turno ya dice en qué
-- sucursal es (ver `sucursal_de_turno`).
--
-- Rol nuevo, 'manager' (administrador de sucursal): claims
-- { business_id, role: 'manager', branch_id }. Ve y gestiona los turnos de
-- SU sucursal, ve a sus profesionales, edita sus horarios, los días
-- bloqueados de su sucursal y el horario de la sucursal. No ve el resto.
--
-- Compatibilidad: cada negocio que existe recibe una sucursal "Principal"
-- sin datos propios (hereda todo del negocio), y todos sus horarios y turnos
-- quedan en ella. Mientras un negocio tenga una sola sucursal, nada cambia.

-- ── Sucursales ─────────────────────────────────────────────────────────────
create table branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  -- NULL = usa el del negocio (dirección, teléfono, link de Maps, horario).
  address text,
  phone text,
  maps_url text,
  business_hours jsonb,
  is_main boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint branches_nombre_valido check (char_length(btrim(name)) between 2 and 60),
  constraint branches_direccion_valida check (largo_ok(address, 200)),
  constraint branches_telefono_valido check (telefono_ok(phone)),
  constraint branches_maps_valido check (url_ok(maps_url)),
  constraint branches_horario_valido check (business_hours is null or horario_negocio_ok(business_hours))
);
create index branches_business_idx on branches (business_id);
-- Una sola principal por negocio.
create unique index branches_una_principal on branches (business_id) where is_main;

-- Precio de un servicio en una sucursal. Sin fila = el precio del servicio.
create table branch_service_prices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  price numeric not null,
  unique (branch_id, service_id),
  constraint branch_service_prices_precio_valido check (price between 0 and 100000000)
);
create index branch_service_prices_business_idx on branch_service_prices (business_id);

-- Sucursal principal para cada negocio que ya existe, y para cada uno nuevo.
insert into branches (business_id, name, is_main)
select id, 'Principal', true from businesses b
where not exists (select 1 from branches x where x.business_id = b.id and x.is_main);

create or replace function crear_sucursal_principal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into branches (business_id, name, is_main) values (new.id, 'Principal', true);
  return new;
end;
$$;
drop trigger if exists businesses_sucursal_principal on businesses;
create trigger businesses_sucursal_principal
  after insert on businesses
  for each row execute function crear_sucursal_principal();

create or replace function sucursal_principal(p_business_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from branches where business_id = p_business_id and is_main limit 1
$$;

-- La principal no se borra (es la que heredan los turnos y horarios sin sucursal).
create or replace function proteger_sucursal_principal() returns trigger
language plpgsql as $$
begin
  -- Si se está borrando el negocio entero (cascada), el negocio ya no está:
  -- ahí sí se va también la principal. Sin esto, borrar un negocio fallaba.
  if old.is_main and exists (select 1 from businesses where id = old.business_id) then
    raise exception 'La sucursal principal no se puede eliminar.';
  end if;
  return old;
end;
$$;
drop trigger if exists branches_proteger_principal on branches;
create trigger branches_proteger_principal
  before delete on branches
  for each row execute function proteger_sucursal_principal();

-- ── Sucursal en horarios, turnos, días bloqueados, avisos ──────────────────
alter table schedules add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table appointments add column if not exists branch_id uuid references branches(id) on delete set null;
-- NULL = el bloqueo vale para todas las sucursales (lo de siempre).
alter table blocked_days add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table notifications add column if not exists branch_id uuid references branches(id) on delete set null;
alter table push_subscriptions add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table admins add column if not exists branch_id uuid references branches(id) on delete cascade;
alter table pending_admins add column if not exists branch_id uuid references branches(id) on delete cascade;

create index if not exists schedules_branch_idx on schedules (branch_id);
create index if not exists appointments_branch_date_idx on appointments (branch_id, appointment_date);
create index if not exists blocked_days_branch_idx on blocked_days (branch_id);
create index if not exists notifications_branch_idx on notifications (branch_id);

update schedules s set branch_id = sucursal_principal(s.business_id) where branch_id is null;
-- La migración corre sin sesión (ni JWT de usuario ni service role), y el
-- trigger que frena al CLIENTE la trataría como uno: se apaga solo para
-- este relleno, dentro de la misma transacción.
alter table appointments disable trigger appointments_protect_client_cancel;
update appointments a set branch_id = sucursal_principal(a.business_id) where branch_id is null;
alter table appointments enable trigger appointments_protect_client_cancel;

-- Rol 'manager' en el registro de administradores y en los pendientes.
alter table admins drop constraint if exists admins_role_check;
alter table admins add constraint admins_role_check check (role in ('owner', 'admin', 'manager'));
alter table pending_admins drop constraint if exists pending_admins_role_check;
alter table pending_admins add constraint pending_admins_role_check check (role in ('owner', 'admin', 'manager'));

-- Una franja sin sucursal (pantallas viejas, o un negocio con una sola) va
-- a la principal. Y la sucursal tiene que ser del mismo negocio.
create or replace function schedules_sucursal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.branch_id is null then
    new.branch_id := sucursal_principal(new.business_id);
  elsif not exists (select 1 from branches where id = new.branch_id and business_id = new.business_id) then
    raise exception 'invalid-argument: Esa sucursal no es de este negocio.';
  end if;
  return new;
end;
$$;
drop trigger if exists schedules_0_sucursal on schedules;
create trigger schedules_0_sucursal
  before insert or update on schedules
  for each row execute function schedules_sucursal();

-- Sucursal de un turno: la de la franja del profesional que contiene esa
-- hora ese día. Sin franja que lo contenga (turno cargado a mano fuera de
-- horario), la de cualquier franja suya, y si no tiene, la principal.
create or replace function sucursal_de_turno(p_business_id uuid, p_professional_id uuid, p_fecha date, p_hora text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s.branch_id from schedules s
      where s.professional_id = p_professional_id and s.day_of_week = dia_de_la_semana(p_fecha)
        and coalesce(s.is_active, true) and s.start_time <> '' and s.end_time <> ''
        and p_hora >= s.start_time and p_hora < s.end_time
      limit 1),
    (select s.branch_id from schedules s where s.professional_id = p_professional_id and s.branch_id is not null limit 1),
    sucursal_principal(p_business_id)
  )
$$;

create or replace function appointments_sucursal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Se movió de profesional, día u hora sin que nadie eligiera sucursal:
  -- vuelve a salir de la franja en la que cae ahora.
  if tg_op = 'UPDATE'
    and new.branch_id is not distinct from old.branch_id
    and (new.professional_id is distinct from old.professional_id
      or new.appointment_date is distinct from old.appointment_date
      or new.start_time is distinct from old.start_time)
  then
    new.branch_id := null;
  end if;

  if new.branch_id is null then
    new.branch_id := sucursal_de_turno(new.business_id, new.professional_id, new.appointment_date, new.start_time);
  elsif not exists (select 1 from branches where id = new.branch_id and business_id = new.business_id) then
    raise exception 'invalid-argument: Esa sucursal no es de este negocio.';
  end if;
  return new;
end;
$$;
-- '0' en el nombre: los BEFORE corren en orden alfabético y este tiene que
-- ir antes que los que miran la sucursal (días bloqueados).
drop trigger if exists appointments_0_sucursal on appointments;
create trigger appointments_0_sucursal
  before insert or update of professional_id, appointment_date, start_time, branch_id on appointments
  for each row execute function appointments_sucursal();

create or replace function blocked_days_sucursal() returns trigger
language plpgsql as $$
begin
  if new.branch_id is not null and not exists (select 1 from branches where id = new.branch_id and business_id = new.business_id) then
    raise exception 'invalid-argument: Esa sucursal no es de este negocio.';
  end if;
  return new;
end;
$$;
drop trigger if exists blocked_days_0_sucursal on blocked_days;
create trigger blocked_days_0_sucursal
  before insert or update on blocked_days
  for each row execute function blocked_days_sucursal();

-- Días bloqueados: los de todo el negocio (branch_id NULL) y los de la
-- sucursal del turno.
create or replace function enforce_blocked_days() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fin text;
begin
  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date and start_time is null
      and (branch_id is null or branch_id = new.branch_id)
  ) then
    raise exception 'failed-precondition: El negocio no atiende el %. Elegí otro día.',
      to_char(new.appointment_date, 'DD/MM');
  end if;

  fin := coalesce(new.end_time, new.start_time);
  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date
      and start_time is not null
      and (branch_id is null or branch_id = new.branch_id)
      and new.start_time < end_time and fin > start_time
  ) then
    raise exception 'failed-precondition: El negocio no atiende en ese horario. Elegí otro.';
  end if;
  return new;
end;
$$;

-- Un día entero bloqueado ya no es único por (negocio, fecha): puede estar
-- bloqueado en una sucursal y en otra no.
drop index if exists blocked_days_dia_entero_uniq;
create unique index if not exists blocked_days_dia_entero_uniq
  on blocked_days (business_id, date, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where start_time is null;
drop index if exists blocked_days_rango_uniq;
create unique index if not exists blocked_days_rango_uniq
  on blocked_days (business_id, date, start_time, end_time, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where start_time is not null;

-- ── create_appointment: horario y precio de la sucursal ────────────────────
-- Misma función que 20260924000000_create_appointment.sql con dos cambios:
--   1. El horario de atención que recorta la franja del profesional es el de
--      la sucursal de ESA franja (o el general si la sucursal no tiene uno).
--   2. El precio base es el de la sucursal si tiene uno propio.
-- El turno se guarda con la sucursal de la franja en la que cayó.
create or replace function create_appointment(
  p_business_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_appointment_date date,
  p_start_time text,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text,
  p_user_id uuid
) returns appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  negocio businesses;
  servicio services;
  profesional professionals;
  duracion int;
  precio numeric;
  precio_final numeric;
  promo_discount_type text;
  promo_discount_value numeric;
  promo_encontrada_id uuid;
  dow int;
  inicio int;
  fin int;
  digitos text;
  dia_negocio jsonb;
  desde int;
  hasta int;
  entra_en_alguna boolean := false;
  franja record;
  break_start int;
  break_end int;
  activos_hoy int;
  activos_futuro int;
  hoy date;
  solapa record;
  nuevo appointments;
  sucursal_id uuid;
  horario_sucursal jsonb;
  precio_sucursal numeric;
begin
  if p_business_id is null or p_professional_id is null or p_service_id is null
    or p_appointment_date is null or p_start_time is null
  then
    raise exception 'invalid-argument: Faltan datos del turno.';
  end if;
  if p_start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'invalid-argument: Fecha u hora con formato inválido.';
  end if;
  if p_appointment_date < hoy_en_argentina() then
    raise exception 'invalid-argument: No se puede reservar en una fecha pasada.';
  end if;

  digitos := regexp_replace(coalesce(p_client_phone, ''), '\D', '', 'g');
  if length(digitos) < 10 or length(digitos) > 13 then
    raise exception 'invalid-argument: Ingresá un teléfono válido, con código de área.';
  end if;

  select * into negocio from businesses where id = p_business_id;
  if not found then
    raise exception 'not-found: El negocio no existe.';
  end if;
  if negocio.is_frozen then
    raise exception 'failed-precondition: Este negocio no está tomando turnos en este momento.';
  end if;

  select * into servicio from services where id = p_service_id and business_id = p_business_id;
  if not found or servicio.is_active = false then
    raise exception 'not-found: El servicio no existe o no está disponible.';
  end if;

  select * into profesional from professionals where id = p_professional_id and business_id = p_business_id;
  if not found or profesional.is_active = false then
    raise exception 'not-found: El profesional no existe o no está disponible.';
  end if;

  duracion := servicio.duration_minutes;
  precio := servicio.price;
  if duracion is null or duracion <= 0 then
    raise exception 'failed-precondition: El servicio no tiene una duración válida.';
  end if;

  if not exists (
    select 1 from professional_services
    where professional_id = p_professional_id and service_id = p_service_id
  ) then
    raise exception 'failed-precondition: Ese profesional no realiza el servicio elegido.';
  end if;

  dow := dia_de_la_semana(p_appointment_date);
  inicio := tiempo_a_minutos(p_start_time);
  fin := inicio + duracion;

  -- Cada franja se recorta con el horario de SU sucursal (o el general).
  for franja in
    select s.*, b.business_hours as horario_de_sucursal, b.is_active as sucursal_activa
    from schedules s
    left join branches b on b.id = s.branch_id
    where s.professional_id = p_professional_id
      and s.day_of_week = dow
      and coalesce(s.is_active, true)
      and s.start_time is not null and s.end_time is not null
      and s.start_time <> '' and s.end_time <> ''
  loop
    if franja.sucursal_activa = false then
      continue;
    end if;
    select elem into dia_negocio
    from jsonb_array_elements(coalesce(franja.horario_de_sucursal, negocio.business_hours, '[]'::jsonb)) elem
    where (elem->>'dayOfWeek')::int = dow
    limit 1;

    if dia_negocio is not null and (dia_negocio->>'isActive')::boolean = false then
      continue;
    end if;

    desde := tiempo_a_minutos(franja.start_time);
    hasta := tiempo_a_minutos(franja.end_time);
    if dia_negocio is not null and coalesce(dia_negocio->>'startTime', '') <> '' and coalesce(dia_negocio->>'endTime', '') <> '' then
      desde := greatest(desde, tiempo_a_minutos(dia_negocio->>'startTime'));
      hasta := least(hasta, tiempo_a_minutos(dia_negocio->>'endTime'));
    end if;
    if inicio < desde or fin > hasta then
      continue;
    end if;
    if franja.break_start is not null and franja.break_end is not null
      and franja.break_start <> '' and franja.break_end <> ''
    then
      break_start := tiempo_a_minutos(franja.break_start);
      break_end := tiempo_a_minutos(franja.break_end);
      if inicio < break_end and fin > break_start then
        continue;
      end if;
    end if;
    entra_en_alguna := true;
    sucursal_id := coalesce(franja.branch_id, sucursal_principal(p_business_id));
    exit;
  end loop;

  if not entra_en_alguna then
    if not exists (
      select 1 from schedules
      where professional_id = p_professional_id and day_of_week = dow
        and coalesce(is_active, true) and coalesce(start_time, '') <> '' and coalesce(end_time, '') <> ''
    ) then
      raise exception 'failed-precondition: El profesional no trabaja ese día.';
    end if;
    raise exception 'failed-precondition: Ese horario está fuera del horario de atención.';
  end if;

  -- Precio propio de la sucursal, si tiene.
  select price into precio_sucursal from branch_service_prices
  where branch_id = sucursal_id and service_id = p_service_id;
  if precio_sucursal is not null then
    precio := precio_sucursal;
  end if;

  select discount_type, discount_value, id
  into promo_discount_type, promo_discount_value, promo_encontrada_id
  from promotions
  where service_id = p_service_id
    and day_of_week = dow
    and coalesce(is_active, true)
    and inicio >= tiempo_a_minutos(start_time)
    and inicio < tiempo_a_minutos(end_time)
  limit 1;

  if promo_encontrada_id is not null then
    precio_final := case
      when promo_discount_type = 'fixed' then promo_discount_value
      else round(precio * (1 - promo_discount_value / 100))
    end;
  else
    precio_final := precio;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text || ':' || p_appointment_date::text, 0));

  hoy := hoy_en_argentina();

  select count(*) filter (where appointment_date = p_appointment_date) as hoy_count,
         count(*) filter (where appointment_date >= hoy) as futuro_count
  into activos_hoy, activos_futuro
  from appointments
  where business_id = p_business_id
    and user_id = p_user_id
    and status in ('pendiente', 'confirmada');

  if activos_hoy > 0 then
    raise exception 'already-exists: Ya tenés un turno ese día. Si querés cambiarlo, cancelá el anterior primero.';
  end if;
  if activos_futuro >= 3 then
    raise exception 'resource-exhausted: Ya tenés 3 turnos reservados. Cuando pase alguno, o si cancelás uno, podés reservar otro.';
  end if;

  for solapa in
    select start_time, end_time from appointments
    where business_id = p_business_id
      and professional_id = p_professional_id
      and appointment_date = p_appointment_date
      and status in ('pendiente', 'confirmada')
  loop
    if inicio < coalesce(tiempo_a_minutos(solapa.end_time), tiempo_a_minutos(solapa.start_time))
      and fin > tiempo_a_minutos(solapa.start_time)
    then
      raise exception 'already-exists: Ese horario ya fue tomado. Elegí otro.';
    end if;
  end loop;

  insert into appointments (
    business_id, professional_id, service_id, user_id, branch_id,
    appointment_date, start_time, end_time,
    price, original_price, promo_id, duration_minutes, service_name,
    client_name, client_phone, client_email, notes,
    status, type
  ) values (
    p_business_id, p_professional_id, p_service_id, p_user_id, sucursal_id,
    p_appointment_date, p_start_time, minutos_a_tiempo(fin),
    precio_final,
    case when promo_encontrada_id is not null then precio else null end,
    promo_encontrada_id,
    duracion, servicio.name,
    left(coalesce(p_client_name, ''), 120), left(coalesce(p_client_phone, ''), 40),
    left(coalesce(p_client_email, ''), 120), left(coalesce(p_notes, ''), 500),
    'pendiente', 'client'
  ) returning * into nuevo;

  return nuevo;
end;
$$;

-- ── Permisos: helpers del rol 'manager' ────────────────────────────────────
create or replace function auth_branch_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'branch_id', '')::uuid
$$;

-- Administrador de ESA sucursal de ese negocio.
create or replace function is_branch_manager(target_business_id uuid, target_branch_id uuid) returns boolean
language sql stable as $$
  select in_business(target_business_id) and auth_role() = 'manager'
    and target_branch_id is not null and auth_branch_id() = target_branch_id
$$;

alter table branches enable row level security;
create policy branches_select on branches for select using (true);
create policy branches_insert on branches for insert with check (can_manage(business_id));
create policy branches_delete on branches for delete using (can_manage(business_id));
create policy branches_update on branches
  for update using (can_manage(business_id) or is_branch_manager(business_id, id))
  with check (can_manage(business_id) or is_branch_manager(business_id, id));

-- El administrador de sucursal solo cambia el HORARIO de su sucursal.
create or replace function proteger_campos_sucursal() returns trigger
language plpgsql as $$
begin
  if can_manage(old.business_id) or coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.name is distinct from old.name
    or new.address is distinct from old.address
    or new.phone is distinct from old.phone
    or new.maps_url is distinct from old.maps_url
    or new.is_main is distinct from old.is_main
    or new.is_active is distinct from old.is_active
    or new.business_id is distinct from old.business_id
  then
    raise exception 'Solo el dueño puede cambiar esos datos de la sucursal.';
  end if;
  return new;
end;
$$;
drop trigger if exists branches_proteger_campos on branches;
create trigger branches_proteger_campos
  before update on branches
  for each row execute function proteger_campos_sucursal();

alter table branch_service_prices enable row level security;
create policy branch_service_prices_select on branch_service_prices for select using (true);
create policy branch_service_prices_write on branch_service_prices
  for all using (can_manage(business_id)) with check (can_manage(business_id));

grant select, insert, update, delete on branches, branch_service_prices to anon, authenticated, service_role;
alter publication supabase_realtime add table branches, branch_service_prices;

-- Turnos: el administrador de sucursal, los de su sucursal.
drop policy if exists appointments_select on appointments;
create policy appointments_select on appointments
  for select using (
    is_business_owner(business_id)
    or auth_is_platform_team()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

drop policy if exists appointments_insert on appointments;
create policy appointments_insert on appointments
  for insert with check (
    user_id = auth.uid()
    and (
      auth_is_platform()
      or is_business_owner(business_id)
      or (is_assigned_staff(business_id) and professional_id = auth_professional_id())
      or is_branch_manager(business_id, branch_id)
    )
  );

drop policy if exists appointments_update on appointments;
create policy appointments_update on appointments
  for update
  using (
    is_business_owner(business_id)
    or auth_is_platform()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
    or (auth.uid() is not null and user_id = auth.uid())
  )
  with check (
    is_business_owner(business_id)
    or auth_is_platform()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

-- El trigger que frena al CLIENTE tampoco tiene que frenar al administrador
-- de la sucursal (misma lista que la policy de arriba).
create or replace function protect_appointment_client_cancel() returns trigger
language plpgsql as $$
begin
  if is_business_owner(new.business_id)
    or auth_is_platform()
    or (is_assigned_staff(new.business_id) and auth_professional_id() = new.professional_id)
    or is_branch_manager(new.business_id, old.branch_id)
  then
    return new;
  end if;

  if old.status not in ('pendiente', 'confirmada') then
    raise exception 'Ese turno ya no se puede cancelar.';
  end if;
  if new.status is distinct from 'cancelada' then
    raise exception 'Un cliente solo puede cancelar su turno, no editarlo.';
  end if;
  if new.professional_id is distinct from old.professional_id
    or new.service_id is distinct from old.service_id
    or new.appointment_date is distinct from old.appointment_date
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.price is distinct from old.price
    or new.client_name is distinct from old.client_name
    or new.client_phone is distinct from old.client_phone
    or new.client_email is distinct from old.client_email
    or new.notes is distinct from old.notes
    or new.branch_id is distinct from old.branch_id
  then
    raise exception 'Un cliente solo puede tocar el estado y el motivo de cancelación.';
  end if;
  return new;
end;
$$;

-- Quién canceló: también el administrador de la sucursal.
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
  elsif is_branch_manager(new.business_id, old.branch_id) then
    select b.name into nombre from branches b where b.id = old.branch_id;
    new.cancelled_by := 'staff';
    new.cancelled_by_name := 'el administrador de la sucursal' || coalesce(' ' || nullif(nombre, ''), '');
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

-- Horarios de los profesionales: el administrador, las franjas de su sucursal.
drop policy if exists schedules_insert on schedules;
create policy schedules_insert on schedules
  for insert with check (can_manage(business_id) or auth_professional_id() = professional_id or is_branch_manager(business_id, branch_id));
drop policy if exists schedules_update on schedules;
create policy schedules_update on schedules
  for update
  using (can_manage(business_id) or auth_professional_id() = professional_id or is_branch_manager(business_id, branch_id))
  with check (can_manage(business_id) or auth_professional_id() = professional_id or is_branch_manager(business_id, branch_id));
drop policy if exists schedules_delete on schedules;
create policy schedules_delete on schedules
  for delete using (can_manage(business_id) or auth_professional_id() = professional_id or is_branch_manager(business_id, branch_id));

-- Días bloqueados: el administrador, los de su sucursal (no los de todo el negocio).
drop policy if exists blocked_days_write on blocked_days;
create policy blocked_days_write on blocked_days
  using (can_manage(business_id) or is_branch_manager(business_id, branch_id))
  with check (can_manage(business_id) or is_branch_manager(business_id, branch_id));

-- Avisos: el administrador, los de su sucursal.
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select using (
    is_business_owner(business_id)
    or auth_is_platform_team()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or is_branch_manager(business_id, branch_id)
  );
drop policy if exists notification_reads_insert on notification_reads;
create policy notification_reads_insert on notification_reads
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from notifications n
      where n.id = notification_id
        and (
          is_business_owner(n.business_id)
          or auth_is_platform_team()
          or (is_assigned_staff(n.business_id) and auth_professional_id() = n.professional_id)
          or is_branch_manager(n.business_id, n.branch_id)
        )
    )
  );

-- Push: el administrador de sucursal también registra su dispositivo.
drop policy if exists push_subscriptions_insert on push_subscriptions;
create policy push_subscriptions_insert on push_subscriptions
  for insert with check ((is_business_staff(business_id) or (in_business(business_id) and auth_role() = 'manager')) and user_id = auth.uid());
drop policy if exists push_subscriptions_update on push_subscriptions;
create policy push_subscriptions_update on push_subscriptions
  for update
  using ((is_business_staff(business_id) or (in_business(business_id) and auth_role() = 'manager')) and user_id = auth.uid())
  with check ((is_business_staff(business_id) or (in_business(business_id) and auth_role() = 'manager')) and user_id = auth.uid());
drop policy if exists push_subscriptions_delete on push_subscriptions;
create policy push_subscriptions_delete on push_subscriptions
  for delete using ((is_business_staff(business_id) or (in_business(business_id) and auth_role() = 'manager')) and user_id = auth.uid());

-- Los avisos llevan la sucursal del turno (para el administrador de sucursal).
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

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date, branch_id)
  values (t.business_id, 'nuevo_turno', titulo, mensaje, t.professional_id, t.id, t.appointment_date, t.branch_id);

  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';

  if base_url is not null and service_key is not null then
    perform net.http_post(
      url := base_url || '/send-push',
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'businessId', t.business_id, 'professionalId', t.professional_id, 'branchId', t.branch_id,
        'title', titulo, 'body', mensaje, 'url', '/admin/citas'
      )
    );
  end if;
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
