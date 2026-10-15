-- ============================================================================
-- Turnos fijos (un cliente todos los miércoles a las 18) y feriados
-- ============================================================================
-- Pedido del usuario (15/10/2026).
--
-- TURNOS FIJOS. Los carga el negocio desde el panel (nunca el cliente):
-- semanal, cada 2 semanas, cada 3 semanas o mensual ("el 2do miércoles de cada
-- mes"; si el primero cae en la 5ta semana, "el último miércoles del mes"),
-- sin fecha de fin o hasta una fecha. Cada fecha es un TURNO NORMAL en
-- `appointments` (type 'manual', con `turno_fijo_id`): ocupa el horario para
-- la reserva online, va a Google Calendar, recibe el recordatorio por mail si
-- tiene mail, y se cancela o se mueve de a uno como cualquier otro. No se
-- agendan años de una vez: siempre las próximas 8 semanas (HORIZONTE), y el
-- cron diario `extender-turnos-fijos` va sumando las siguientes.
--
-- Una fecha que no se puede agendar NO se fuerza (decisión del usuario): se
-- saltea y queda anotada en `turnos_fijos_saltados` con el motivo (día
-- bloqueado, feriado, el profesional no atiende ese día, ya había otro turno),
-- y el negocio recibe el aviso en la campanita. Mismas reglas que un turno
-- cargado a mano: el horario del profesional, los días bloqueados (del
-- negocio, de la sucursal y del profesional) y que no se pise con otro turno
-- (trigger turnos_sin_pisarse).
--
-- FERIADOS. La tabla `feriados` tiene los nacionales de Argentina
-- (inamovibles, trasladables y puentes), cargados acá para 2026-2027 y
-- actualizados cada mes por la Edge Function `actualizar-feriados`
-- (api.argentinadatos.com). Cada negocio elige en Configuración:
--   'atiende' (por defecto: nadie pierde reservas sin saberlo) → solo se
--             marcan en el calendario de Días bloqueados.
--   'cierra'  → cada feriado se vuelve un día bloqueado entero
--             (blocked_days con `feriado` = su nombre), así lo respeta TODO lo
--             que ya respeta un día bloqueado. Si el dueño borra uno ("abro
--             este feriado"), queda anotado en `feriados_abiertos` y no vuelve.

-- Día de hoy en Argentina (las fechas de los turnos son hora local).
create or replace function hoy_argentina() returns date
language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- ═══════════════════════════════ FERIADOS ═══════════════════════════════════

create table if not exists feriados (
  fecha date primary key,
  nombre text not null,
  tipo text -- inamovible | trasladable | puente
);
alter table feriados enable row level security;
drop policy if exists feriados_select on feriados;
create policy feriados_select on feriados for select using (true);
grant select on feriados to anon, authenticated;
grant select, insert, update, delete on feriados to service_role;

insert into feriados (fecha, nombre, tipo) values
  ('2026-01-01', 'Año nuevo', 'inamovible'),
  ('2026-02-16', 'Carnaval', 'inamovible'),
  ('2026-02-17', 'Carnaval', 'inamovible'),
  ('2026-03-23', 'Puente turístico no laborable', 'puente'),
  ('2026-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia', 'inamovible'),
  ('2026-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas', 'inamovible'),
  ('2026-04-03', 'Viernes Santo', 'inamovible'),
  ('2026-05-01', 'Día del Trabajador', 'inamovible'),
  ('2026-05-25', 'Día de la Revolución de Mayo', 'inamovible'),
  ('2026-06-15', 'Paso a la Inmortalidad del General Martín Güemes (17/6)', 'trasladable'),
  ('2026-06-20', 'Paso a la Inmortalidad del General Manuel Belgrano', 'inamovible'),
  ('2026-07-09', 'Día de la Independencia', 'inamovible'),
  ('2026-07-10', 'Puente turístico no laborable', 'puente'),
  ('2026-08-17', 'Paso a la Inmortalidad del Gral. José de San Martín', 'trasladable'),
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural', 'trasladable'),
  ('2026-11-09', 'Visita del papa León XIV', 'inamovible'),
  ('2026-11-23', 'Día de la Soberanía Nacional (20/11)', 'trasladable'),
  ('2026-12-07', 'Puente turístico no laborable', 'puente'),
  ('2026-12-08', 'Día de la Inmaculada Concepción de María', 'inamovible'),
  ('2026-12-25', 'Navidad', 'inamovible'),
  ('2027-01-01', 'Año nuevo', 'inamovible'),
  ('2027-02-08', 'Carnaval', 'inamovible'),
  ('2027-02-09', 'Carnaval', 'inamovible'),
  ('2027-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia', 'inamovible'),
  ('2027-03-26', 'Viernes Santo', 'inamovible'),
  ('2027-04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas', 'inamovible'),
  ('2027-05-01', 'Día del Trabajador', 'inamovible'),
  ('2027-05-25', 'Día de la Revolución de Mayo', 'inamovible'),
  ('2027-06-17', 'Paso a la Inmortalidad del General Martín Güemes', 'trasladable'),
  ('2027-06-20', 'Paso a la Inmortalidad del General Manuel Belgrano', 'inamovible'),
  ('2027-07-09', 'Día de la Independencia', 'inamovible'),
  ('2027-08-17', 'Paso a la Inmortalidad del Gral. José de San Martín', 'trasladable'),
  ('2027-10-12', 'Día del Respeto a la Diversidad Cultural', 'trasladable'),
  ('2027-11-20', 'Día de la Soberanía Nacional', 'trasladable'),
  ('2027-12-08', 'Día de la Inmaculada Concepción de María', 'inamovible'),
  ('2027-12-25', 'Navidad', 'inamovible')
on conflict (fecha) do update set nombre = excluded.nombre, tipo = excluded.tipo;

alter table businesses
  add column if not exists feriados text not null default 'atiende'
    check (feriados in ('atiende', 'cierra'));

-- El nombre del feriado, cuando el día bloqueado es un feriado (lo puso el
-- sistema por 'cierra', o el dueño cerró a mano un día que es feriado).
alter table blocked_days add column if not exists feriado text;
-- Lo puso el sistema por 'cierra' (y no el dueño a mano): solo estos se
-- sacan al pasar a 'atiende', y solo borrar uno de estos es "abrir el feriado".
alter table blocked_days add column if not exists feriado_auto boolean not null default false;

create table if not exists feriados_abiertos (
  business_id uuid not null references businesses(id) on delete cascade,
  fecha date not null,
  primary key (business_id, fecha)
);
alter table feriados_abiertos enable row level security;
drop policy if exists feriados_abiertos_select on feriados_abiertos;
create policy feriados_abiertos_select on feriados_abiertos for select using (in_business(business_id) or auth_is_platform());
revoke all on feriados_abiertos from anon, authenticated;
grant select on feriados_abiertos to authenticated;
grant select, insert, update, delete on feriados_abiertos to service_role;

-- Deja los días bloqueados de feriados como dice el negocio. Marca la sesión
-- (slotly.aplicando_feriados) para que el trigger de abajo no confunda un
-- borrado del sistema con un "abro este feriado" del dueño.
create or replace function aplicar_feriados(p_business_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('slotly.aplicando_feriados', '1', true);
  if (select feriados from businesses where id = p_business_id) = 'cierra' then
    insert into blocked_days (business_id, date, feriado, feriado_auto)
    select p_business_id, f.fecha, f.nombre, true
    from feriados f
    where f.fecha >= hoy_argentina()
      and not exists (select 1 from feriados_abiertos a where a.business_id = p_business_id and a.fecha = f.fecha)
    on conflict do nothing;
  else
    delete from blocked_days
    where business_id = p_business_id and feriado_auto and date >= hoy_argentina();
  end if;
  perform set_config('slotly.aplicando_feriados', '', true);
end;
$$;
revoke all on function aplicar_feriados(uuid) from public, anon, authenticated;

create or replace function aplicar_feriados_todos() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b record;
  n integer := 0;
begin
  for b in select id from businesses where feriados = 'cierra' loop
    perform aplicar_feriados(b.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function aplicar_feriados_todos() from public, anon, authenticated;
grant execute on function aplicar_feriados_todos() to service_role;

create or replace function businesses_feriados() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.feriados is distinct from old.feriados then
    perform aplicar_feriados(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists businesses_aplicar_feriados on businesses;
create trigger businesses_aplicar_feriados
  after insert or update of feriados on businesses
  for each row execute function businesses_feriados();

-- Un día bloqueado entero de todo el negocio que cae en feriado lleva su
-- nombre (también si lo bloqueó el dueño a mano), y vuelve a quedar cerrado.
create or replace function blocked_days_feriado_al_crear() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.start_time is null and new.branch_id is null and new.professional_id is null then
    if new.feriado is null then
      new.feriado := (select nombre from feriados where fecha = new.date);
    end if;
    delete from feriados_abiertos where business_id = new.business_id and fecha = new.date;
  end if;
  return new;
end;
$$;
drop trigger if exists blocked_days_feriado on blocked_days;
create trigger blocked_days_feriado
  before insert on blocked_days
  for each row execute function blocked_days_feriado_al_crear();

-- El dueño borró un feriado que el sistema había cerrado: "lo abro".
create or replace function blocked_days_feriado_al_borrar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.feriado_auto and coalesce(current_setting('slotly.aplicando_feriados', true), '') <> '1' then
    insert into feriados_abiertos (business_id, fecha) values (old.business_id, old.date) on conflict do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists blocked_days_feriado_abierto on blocked_days;
create trigger blocked_days_feriado_abierto
  after delete on blocked_days
  for each row execute function blocked_days_feriado_al_borrar();

-- ═════════════════════════════ TURNOS FIJOS ═════════════════════════════════

create table if not exists turnos_fijos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  service_name text,
  cliente_id uuid references clientes(id) on delete set null,
  client_name text not null,
  client_phone text,
  client_email text,
  notes text,
  frecuencia text not null check (frecuencia in ('semanal', 'quincenal', 'cada_3_semanas', 'mensual')),
  hora text not null check (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duracion_min integer not null check (duracion_min between 5 and 720),
  price numeric,
  fecha_inicio date not null,
  fecha_fin date,
  -- Hasta qué fecha ya se agendó (las siguientes las suma el cron).
  generado_hasta date,
  activo boolean not null default true,
  creado_por uuid,
  created_at timestamptz not null default now(),
  constraint turnos_fijos_fechas check (fecha_fin is null or fecha_fin >= fecha_inicio),
  constraint turnos_fijos_nombre check (char_length(btrim(client_name)) between 1 and 120)
);
create index if not exists turnos_fijos_negocio_idx on turnos_fijos (business_id) where activo;

alter table appointments add column if not exists turno_fijo_id uuid references turnos_fijos(id) on delete set null;
-- Una sola fecha por turno fijo: generar dos veces no duplica, y una fecha
-- cancelada a mano no vuelve a aparecer.
create unique index if not exists appointments_turno_fijo_fecha_uniq
  on appointments (turno_fijo_id, appointment_date) where turno_fijo_id is not null;

create table if not exists turnos_fijos_saltados (
  id uuid primary key default gen_random_uuid(),
  turno_fijo_id uuid not null references turnos_fijos(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  fecha date not null,
  motivo text not null,
  created_at timestamptz not null default now(),
  unique (turno_fijo_id, fecha)
);

-- Quién ve y gestiona un turno fijo: el dueño (y la plataforma) todos; un
-- profesional los suyos; un administrador de sucursal, los de profesionales
-- que atienden en su sucursal. Mismo alcance que la agenda.
create or replace function puede_ver_turno_fijo(p_business_id uuid, p_professional_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select can_manage(p_business_id)
    or (is_assigned_staff(p_business_id) and auth_professional_id() = p_professional_id)
    or (in_business(p_business_id) and auth_role() = 'manager'
        and exists (select 1 from schedules s where s.professional_id = p_professional_id and s.branch_id = auth_branch_id()))
$$;

alter table turnos_fijos enable row level security;
drop policy if exists turnos_fijos_select on turnos_fijos;
create policy turnos_fijos_select on turnos_fijos for select using (puede_ver_turno_fijo(business_id, professional_id));
revoke all on turnos_fijos from anon, authenticated;
grant select on turnos_fijos to authenticated;
grant select, insert, update, delete on turnos_fijos to service_role;

alter table turnos_fijos_saltados enable row level security;
drop policy if exists turnos_fijos_saltados_select on turnos_fijos_saltados;
create policy turnos_fijos_saltados_select on turnos_fijos_saltados for select using (
  exists (select 1 from turnos_fijos t where t.id = turno_fijo_id and puede_ver_turno_fijo(t.business_id, t.professional_id))
);
revoke all on turnos_fijos_saltados from anon, authenticated;
grant select on turnos_fijos_saltados to authenticated;
grant select, insert, update, delete on turnos_fijos_saltados to service_role;

-- El n-ésimo día de la semana `p_dow` (0 = domingo, como extract(dow)) de un
-- mes; con p_n = 5, el último.
create or replace function fecha_mensual(p_anio int, p_mes int, p_dow int, p_n int) returns date
language plpgsql immutable as $$
declare
  primero date := make_date(p_anio, p_mes, 1);
  ultimo date := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  cand date;
begin
  if p_n < 5 then
    cand := primero + ((p_dow - extract(dow from primero)::int + 7) % 7) + (p_n - 1) * 7;
    if extract(month from cand) = p_mes then
      return cand;
    end if;
  end if;
  return ultimo - ((extract(dow from ultimo)::int - p_dow + 7) % 7);
end;
$$;

-- Las fechas del turno fijo entre p_desde y p_hasta (incluidas).
create or replace function fechas_turno_fijo(t turnos_fijos, p_desde date, p_hasta date) returns setof date
language plpgsql stable as $$
declare
  paso int;
  n int;
  mes date;
  f date;
begin
  if t.frecuencia = 'mensual' then
    n := least(5, ceil(extract(day from t.fecha_inicio) / 7.0)::int);
    mes := date_trunc('month', greatest(p_desde, t.fecha_inicio))::date;
    while mes <= p_hasta loop
      f := fecha_mensual(extract(year from mes)::int, extract(month from mes)::int, extract(dow from t.fecha_inicio)::int, n);
      if f >= greatest(p_desde, t.fecha_inicio) and f <= p_hasta then
        return next f;
      end if;
      mes := (mes + interval '1 month')::date;
    end loop;
    return;
  end if;
  paso := case t.frecuencia when 'semanal' then 7 when 'quincenal' then 14 else 21 end;
  return query
    select d::date from generate_series(t.fecha_inicio::timestamp, p_hasta::timestamp, make_interval(days => paso)) d
    where d::date >= p_desde;
end;
$$;

-- Cuántos días hacia adelante se agendan las fechas de un turno fijo.
create or replace function horizonte_turnos_fijos() returns date
language sql stable as $$ select hoy_argentina() + 56 $$;

/**
 * Agenda las fechas del turno fijo que falten hasta p_hasta (sin pasar su
 * fecha de fin). Cada una como turno 'manual' confirmado; la que no se puede
 * (no atiende, bloqueada/feriado, ya ocupada) se saltea y se anota. Con
 * p_avisar (el cron), cada salteada es un aviso en la campanita del negocio.
 * Devuelve { creados, saltados: [{ fecha, motivo }] }.
 */
create or replace function generar_turnos_fijos(p_id uuid, p_hasta date, p_avisar boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t turnos_fijos;
  v_desde date;
  v_hasta date;
  f date;
  fin text;
  motivo text;
  bloqueo record;
  sucursal uuid;
  creados int := 0;
  saltados jsonb := '[]'::jsonb;
begin
  select * into t from turnos_fijos where id = p_id for update;
  if not found or not t.activo then
    return jsonb_build_object('creados', 0, 'saltados', saltados);
  end if;
  v_desde := greatest(t.fecha_inicio, coalesce(t.generado_hasta + 1, t.fecha_inicio), hoy_argentina());
  v_hasta := least(p_hasta, coalesce(t.fecha_fin, p_hasta));
  if v_desde > v_hasta then
    return jsonb_build_object('creados', 0, 'saltados', saltados);
  end if;
  fin := to_char(t.hora::time + make_interval(mins => t.duracion_min), 'HH24:MI');

  for f in select * from fechas_turno_fijo(t, v_desde, v_hasta) loop
    continue when exists (select 1 from appointments where turno_fijo_id = t.id and appointment_date = f);
    continue when exists (select 1 from turnos_fijos_saltados where turno_fijo_id = t.id and fecha = f);
    motivo := null;

    if not exists (
      select 1 from schedules s
      where s.professional_id = t.professional_id and s.day_of_week = dia_de_la_semana(f)
        and coalesce(s.is_active, true) and coalesce(s.start_time, '') <> '' and coalesce(s.end_time, '') <> ''
        and t.hora >= s.start_time and fin <= s.end_time
    ) then
      motivo := 'El profesional no atiende ese día en ese horario';
    end if;

    if motivo is null then
      sucursal := sucursal_de_turno(t.business_id, t.professional_id, f, t.hora);
      select b.date, b.feriado into bloqueo from blocked_days b
      where b.business_id = t.business_id and b.date = f
        and (b.professional_id is null or b.professional_id = t.professional_id)
        and (b.branch_id is null or b.branch_id = sucursal)
        and (b.start_time is null or (t.hora < b.end_time and fin > b.start_time))
      order by b.feriado nulls last
      limit 1;
      if found then
        motivo := case when bloqueo.feriado is not null then 'Feriado: ' || bloqueo.feriado else 'Día u horario bloqueado' end;
      end if;
    end if;

    if motivo is null then
      begin
        insert into appointments (
          business_id, professional_id, service_id, service_name, appointment_date, start_time, end_time,
          duration_minutes, price, status, type, client_name, client_phone, client_email, notes,
          cliente_id, user_id, turno_fijo_id
        ) values (
          t.business_id, t.professional_id, t.service_id, t.service_name, f, t.hora, fin,
          t.duracion_min, t.price, 'confirmada', 'manual', t.client_name, nullif(t.client_phone, ''), nullif(t.client_email, ''), nullif(t.notes, ''),
          t.cliente_id, t.creado_por, t.id
        );
        creados := creados + 1;
      exception when others then
        motivo := case
          when sqlerrm like 'already-exists:%' then 'Ya había otro turno en ese horario'
          else 'No se pudo agendar: ' || regexp_replace(sqlerrm, '^[a-z-]+: ', '')
        end;
      end;
    end if;

    if motivo is not null then
      insert into turnos_fijos_saltados (turno_fijo_id, business_id, fecha, motivo)
      values (t.id, t.business_id, f, motivo) on conflict do nothing;
      saltados := saltados || jsonb_build_object('fecha', f, 'motivo', motivo);
      if p_avisar then
        insert into notifications (business_id, type, title, body, professional_id, appointment_date, branch_id)
        values (t.business_id, 'turno_fijo_saltado', 'Un turno fijo no se agendó',
          t.client_name || ' · ' || to_char(f, 'DD/MM') || ' ' || t.hora || ': ' || motivo,
          t.professional_id, f, sucursal_de_turno(t.business_id, t.professional_id, f, t.hora));
      end if;
    end if;
  end loop;

  update turnos_fijos set generado_hasta = v_hasta where id = t.id;
  return jsonb_build_object('creados', creados, 'saltados', saltados);
end;
$$;
revoke all on function generar_turnos_fijos(uuid, date, boolean) from public, anon, authenticated;

/** Alta de un turno fijo desde el panel. Agenda ya las próximas 8 semanas. */
create or replace function crear_turno_fijo(
  p_business_id uuid, p_professional_id uuid, p_service_id uuid,
  p_fecha_inicio date, p_hora text, p_frecuencia text, p_fecha_fin date,
  p_client_name text, p_client_phone text default null, p_client_email text default null,
  p_notes text default null, p_cliente_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  srv services;
  dur int;
  precio numeric;
  nuevo uuid;
  res jsonb;
begin
  if not puede_ver_turno_fijo(p_business_id, p_professional_id) then
    raise exception 'permission-denied: No podés cargar turnos fijos para ese profesional.';
  end if;
  if not exists (select 1 from professionals where id = p_professional_id and business_id = p_business_id) then
    raise exception 'invalid-argument: Ese profesional no es de este negocio.';
  end if;
  select * into srv from services where id = p_service_id and business_id = p_business_id;
  if not found then
    raise exception 'invalid-argument: Elegí un servicio.';
  end if;
  if p_frecuencia not in ('semanal', 'quincenal', 'cada_3_semanas', 'mensual') then
    raise exception 'invalid-argument: Elegí cada cuánto se repite.';
  end if;
  if p_fecha_inicio is null or p_fecha_inicio < hoy_argentina() then
    raise exception 'invalid-argument: El primer turno no puede ser en el pasado.';
  end if;
  if p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'invalid-argument: La fecha de fin tiene que ser después del primer turno.';
  end if;
  if char_length(btrim(coalesce(p_client_name, ''))) = 0 then
    raise exception 'invalid-argument: Poné el nombre del cliente.';
  end if;

  select coalesce(ps.custom_duration, srv.duration_minutes), coalesce(ps.custom_price, srv.price)
    into dur, precio
  from (select 1) x
  left join professional_services ps on ps.professional_id = p_professional_id and ps.service_id = p_service_id;

  insert into turnos_fijos (
    business_id, professional_id, service_id, service_name, cliente_id,
    client_name, client_phone, client_email, notes,
    frecuencia, hora, duracion_min, price, fecha_inicio, fecha_fin, creado_por
  ) values (
    p_business_id, p_professional_id, p_service_id, srv.name, p_cliente_id,
    btrim(p_client_name), nullif(btrim(coalesce(p_client_phone, '')), ''), nullif(btrim(coalesce(p_client_email, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
    p_frecuencia, p_hora, coalesce(dur, 30), precio, p_fecha_inicio, p_fecha_fin, auth.uid()
  ) returning id into nuevo;

  res := generar_turnos_fijos(nuevo, horizonte_turnos_fijos(), false);
  return res || jsonb_build_object('id', nuevo);
end;
$$;
revoke all on function crear_turno_fijo(uuid, uuid, uuid, date, text, text, date, text, text, text, text, uuid) from public, anon;
grant execute on function crear_turno_fijo(uuid, uuid, uuid, date, text, text, date, text, text, text, text, uuid) to authenticated;

/**
 * Termina el turno fijo desde p_desde (incluida): se borran sus turnos de esa
 * fecha en adelante (eran el lugar reservado, nada pasó todavía) y no se
 * agendan más. Los anteriores quedan como historial.
 */
create or replace function terminar_turno_fijo(p_id uuid, p_desde date) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t turnos_fijos;
  borrados int;
begin
  select * into t from turnos_fijos where id = p_id;
  if not found or not puede_ver_turno_fijo(t.business_id, t.professional_id) then
    raise exception 'permission-denied: No podés cambiar ese turno fijo.';
  end if;
  update turnos_fijos
    set activo = false,
        fecha_fin = greatest(fecha_inicio, coalesce(p_desde, hoy_argentina()) - 1)
    where id = p_id;
  delete from appointments
    where turno_fijo_id = p_id and appointment_date >= coalesce(p_desde, hoy_argentina())
      and status in ('pendiente', 'confirmada');
  get diagnostics borrados = row_count;
  delete from turnos_fijos_saltados where turno_fijo_id = p_id and fecha >= coalesce(p_desde, hoy_argentina());
  return borrados;
end;
$$;
revoke all on function terminar_turno_fijo(uuid, date) from public, anon;
grant execute on function terminar_turno_fijo(uuid, date) to authenticated;

/** El cron: agenda las semanas que faltan de todos los turnos fijos activos. */
create or replace function extender_turnos_fijos() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from turnos_fijos
    where activo
      and coalesce(generado_hasta, fecha_inicio - 1) < least(coalesce(fecha_fin, horizonte_turnos_fijos()), horizonte_turnos_fijos())
  loop
    perform generar_turnos_fijos(r.id, horizonte_turnos_fijos(), true);
    n := n + 1;
  end loop;
  -- Los que ya llegaron a su fecha de fin quedan inactivos.
  update turnos_fijos set activo = false where activo and fecha_fin is not null and fecha_fin < hoy_argentina();
  return n;
end;
$$;
revoke all on function extender_turnos_fijos() from public, anon, authenticated;

-- ═════════════════════════════════ CRONS ════════════════════════════════════
-- 09:10 UTC = 06:10 en Argentina, antes de que abran los negocios.
select cron.schedule('extender-turnos-fijos', '10 9 * * *', $$select extender_turnos_fijos()$$);
select cron.schedule('aplicar-feriados', '20 9 * * *', $$select aplicar_feriados_todos()$$);
-- El 1° de cada mes: trae los feriados del año y del siguiente (decretos,
-- puentes nuevos) por la Edge Function, con la URL y la clave de app_settings
-- (mismo esquema que despachar_envio).
create or replace function pedir_actualizacion_feriados() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  base_url text;
  service_key text;
begin
  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';
  if base_url is null or service_key is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/actualizar-feriados',
    headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;
revoke all on function pedir_actualizacion_feriados() from public, anon, authenticated;
select cron.schedule('actualizar-feriados', '0 10 1 * *', $$select pedir_actualizacion_feriados()$$);
