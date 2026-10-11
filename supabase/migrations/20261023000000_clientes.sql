-- ============================================================================
-- Clientes: ficha por negocio, historial, comentarios y archivos por turno
-- ============================================================================
-- Diseño completo y motivos en PLAN-CLIENTES.md. Resumen:
--
--   clientes            ficha del cliente DENTRO de un negocio (la misma
--                       persona en otro negocio tiene otra ficha: nada se
--                       comparte entre negocios).
--   appointments.cliente_id   vínculo turno → ficha. El historial se lee de
--                       appointments: no se duplica ningún dato del turno.
--   turno_comentarios   comentarios internos de cada turno.
--   turno_adjuntos      metadatos de los archivos; el binario vive en el
--                       bucket privado `turno-adjuntos`, nunca en la base.
--
-- Identidad: un turno se vincula solo cuando la identidad es
-- verificable, es decir, un turno 'client' creado por create_appointment()
-- con el uid de la cuenta que reservó (el id estable de Supabase Auth, atado
-- al `sub` de Google). En los turnos 'manual' el user_id es el del STAFF que
-- los cargó (lo exige appointments_insert), así que esos se vinculan a mano:
-- es el staff quien sabe quién es la persona. Nunca por nombre ni por mail.
--
-- No destructiva: solo agrega tablas, una columna nullable, funciones y
-- policies. El vínculo de los turnos históricos es idempotente.

-- Búsqueda sin acentos ("Jose" encuentra "José"). La extensión puede estar
-- en `extensions` o en `public` según cómo se creó el proyecto: el
-- search_path de sin_acentos() la encuentra en cualquiera de los dos.
create extension if not exists unaccent with schema extensions;

create or replace function sin_acentos(t text) returns text
language sql stable set search_path = public, extensions, pg_temp as $$
  select unaccent(t)
$$;

-- ============================================================================
-- CLIENTES
-- ============================================================================
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- La cuenta (auth.users.id) cuando la hay. NULL = ficha sin cuenta, creada
  -- por el negocio. Si la cuenta se borra, la ficha y su historial quedan.
  user_id uuid references auth.users(id) on delete set null,
  -- Cómo lo llama el negocio. Arranca con el nombre de Google y después es
  -- del negocio: ninguna reserva ni inicio de sesión lo vuelve a pisar.
  nombre text not null,
  -- Referencia: el último nombre que trajo la cuenta de Google.
  nombre_google text,
  email text,
  telefono text,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Para las FKs compuestas (cliente_id, business_id): impiden apuntar a la
  -- ficha de otro negocio aunque alguien mande un id ajeno.
  constraint clientes_id_negocio unique (id, business_id),
  constraint clientes_nombre_valido check (char_length(btrim(nombre)) between 1 and 120),
  constraint clientes_contacto_valido check (
    largo_ok(email, 254) and email_ok(email) and largo_ok(telefono, 40) and telefono_ok(telefono)
  ),
  constraint clientes_observaciones_validas check (largo_ok(observaciones, 2000) and largo_ok(nombre_google, 200))
);

-- Una ficha por cuenta y por negocio: la misma persona reservando muchas
-- veces no genera duplicados.
create unique index if not exists clientes_negocio_cuenta_uq
  on clientes (business_id, user_id) where user_id is not null;
create index if not exists clientes_negocio_nombre_idx on clientes (business_id, lower(nombre));
create index if not exists clientes_negocio_creado_idx on clientes (business_id, created_at desc);

-- ============================================================================
-- VÍNCULO TURNO → FICHA
-- ============================================================================
alter table appointments add column if not exists cliente_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_cliente_fk') then
    -- on delete set null (cliente_id): si algún día se borra una ficha, los
    -- turnos quedan intactos, solo sin vínculo. Hoy no hay forma de borrarla.
    alter table appointments
      add constraint appointments_cliente_fk
      foreign key (cliente_id, business_id) references clientes (id, business_id)
      on delete set null (cliente_id);
  end if;
end $$;

-- Historial de una ficha (más reciente primero) y contadores por negocio.
create index if not exists appointments_cliente_fecha_idx
  on appointments (cliente_id, appointment_date desc, start_time desc) where cliente_id is not null;
create index if not exists appointments_negocio_cliente_idx
  on appointments (business_id, cliente_id) where cliente_id is not null;

-- ============================================================================
-- PERMISOS (helpers)
-- ============================================================================
-- security definer: leen appointments/clientes sin depender de la RLS de
-- quien consulta, y deciden SOLO con los claims del JWT. Así las policies
-- quedan cortas y no hay recursión entre tablas.

-- Puede VER la documentación interna de un turno: el dueño, el profesional
-- del turno, el administrador de su sucursal, o la plataforma si el negocio
-- no activó el principio de privacidad. El cliente del turno NO: es
-- documentación interna del negocio.
create or replace function turno_interno_visible(p_appointment_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from appointments a
    where a.id = p_appointment_id
      and (
        is_business_owner(a.business_id)
        or (is_assigned_staff(a.business_id) and a.professional_id = auth_professional_id())
        or is_branch_manager(a.business_id, a.branch_id)
        or (auth_is_platform_team() and not negocio_privado(a.business_id))
      )
  )
$$;

-- Puede ESCRIBIR en esa documentación: lo mismo menos la plataforma (que la
-- lee para dar soporte, pero no documenta atenciones ajenas).
create or replace function turno_documentable(p_appointment_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from appointments a
    where a.id = p_appointment_id
      and (
        is_business_owner(a.business_id)
        or (is_assigned_staff(a.business_id) and a.professional_id = auth_professional_id())
        or is_branch_manager(a.business_id, a.branch_id)
      )
  )
$$;

-- Puede ver la ficha: el dueño (todas), la plataforma (sin privacidad), y el
-- profesional o administrador de sucursal que tenga al menos un turno de
-- ese cliente a su cargo.
create or replace function cliente_visible(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from clientes c
    where c.id = p_cliente_id
      and (
        is_business_owner(c.business_id)
        or (auth_is_platform_team() and not negocio_privado(c.business_id))
        or exists (
          select 1 from appointments a
          where a.cliente_id = c.id and a.business_id = c.business_id
            and (
              (is_assigned_staff(a.business_id) and a.professional_id = auth_professional_id())
              or is_branch_manager(a.business_id, a.branch_id)
            )
        )
      )
  )
$$;

-- Puede editar la ficha: el dueño, el administrador de una sucursal donde
-- se atiende, o el dueño de la plataforma (sin privacidad). El profesional
-- la ve pero no la edita: documenta en sus turnos.
create or replace function cliente_editable(p_cliente_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from clientes c
    where c.id = p_cliente_id
      and (
        is_business_owner(c.business_id)
        or (auth_is_platform() and not negocio_privado(c.business_id))
        or exists (
          select 1 from appointments a
          where a.cliente_id = c.id and a.business_id = c.business_id
            and is_branch_manager(a.business_id, a.branch_id)
        )
      )
  )
$$;

revoke all on function turno_interno_visible(uuid), turno_documentable(uuid),
  cliente_visible(uuid), cliente_editable(uuid) from public, anon;
grant execute on function turno_interno_visible(uuid), turno_documentable(uuid),
  cliente_visible(uuid), cliente_editable(uuid) to authenticated, service_role;

-- ============================================================================
-- CLIENTES — RLS y protección de campos
-- ============================================================================
alter table clientes enable row level security;

drop policy if exists clientes_select on clientes;
create policy clientes_select on clientes
  for select using (is_business_owner(business_id) or cliente_visible(id));

-- Ficha nueva desde cero: solo el dueño (o la plataforma preparando la
-- cuenta). Las fichas de turnos cargados a mano se crean con
-- crear_cliente_desde_turno(), que valida el turno.
drop policy if exists clientes_insert on clientes;
create policy clientes_insert on clientes
  for insert with check (can_manage(business_id) and user_id is null);

drop policy if exists clientes_update on clientes;
create policy clientes_update on clientes
  for update using (cliente_editable(id)) with check (cliente_editable(id));

-- Sin policy de DELETE: las fichas no se borran (tienen historial atado).

create or replace function proteger_campos_cliente() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  -- Sin sesión (migraciones, triggers, Edge Functions con service role): libre.
  if auth.uid() is null then
    return new;
  end if;
  if new.business_id is distinct from old.business_id
    or new.user_id is distinct from old.user_id
    or new.nombre_google is distinct from old.nombre_google
    or new.created_at is distinct from old.created_at
  then
    raise exception 'failed-precondition: Esos datos de la ficha no se pueden cambiar.';
  end if;
  -- El mail de una ficha con cuenta es el de la cuenta: no se edita a mano.
  if old.user_id is not null and new.email is distinct from old.email then
    raise exception 'failed-precondition: El email de un cliente con cuenta es el de su cuenta de Google.';
  end if;
  return new;
end;
$$;

drop trigger if exists clientes_proteger_campos on clientes;
create trigger clientes_proteger_campos
  before update on clientes
  for each row execute function proteger_campos_cliente();

-- ============================================================================
-- VÍNCULO AUTOMÁTICO AL RESERVAR CON CUENTA
-- ============================================================================
-- Devuelve la ficha de esa cuenta en ese negocio, creándola si no existe.
-- Nunca pisa `nombre`: solo refresca la referencia de Google y el mail.
create or replace function asegurar_cliente_de_cuenta(p_business_id uuid, p_user_id uuid, p_nombre_reserva text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  usuario record;
  nombre_inicial text;
  ficha_id uuid;
begin
  select u.email,
         nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '') as nombre
    into usuario
    from auth.users u where u.id = p_user_id;

  nombre_inicial := left(coalesce(usuario.nombre, nullif(btrim(p_nombre_reserva), ''),
                                  split_part(coalesce(usuario.email, ''), '@', 1), 'Cliente'), 120);
  if btrim(nombre_inicial) = '' then nombre_inicial := 'Cliente'; end if;

  insert into clientes (business_id, user_id, nombre, nombre_google, email)
  values (p_business_id, p_user_id, nombre_inicial, left(usuario.nombre, 200),
          case when email_ok(usuario.email) then left(usuario.email, 254) end)
  on conflict (business_id, user_id) where user_id is not null do update
    set nombre_google = coalesce(excluded.nombre_google, clientes.nombre_google),
        email = coalesce(excluded.email, clientes.email)
  returning id into ficha_id;

  return ficha_id;
end;
$$;

revoke all on function asegurar_cliente_de_cuenta(uuid, uuid, text) from public, anon, authenticated;
grant execute on function asegurar_cliente_de_cuenta(uuid, uuid, text) to service_role;

create or replace function vincular_cliente_al_reservar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Reserva con cuenta: la crea create_appointment() desde el servidor (sin
  -- sesión de usuario en la base) con el uid verificado de quien reservó.
  if new.type = 'client' and new.user_id is not null and auth.uid() is null then
    new.cliente_id := asegurar_cliente_de_cuenta(new.business_id, new.user_id, new.client_name);
    return new;
  end if;

  -- Un servicio sin turno no tiene cliente.
  if new.type = 'walkin' then
    new.cliente_id := null;
    return new;
  end if;

  -- Turno cargado por el negocio con una ficha elegida: tiene que ser una
  -- ficha que quien lo carga pueda ver (la FK ya impide otro negocio).
  if new.cliente_id is not null and auth.uid() is not null and not cliente_visible(new.cliente_id) then
    raise exception 'failed-precondition: No podés asignar ese cliente.';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_vincular_cliente on appointments;
create trigger appointments_vincular_cliente
  before insert on appointments
  for each row execute function vincular_cliente_al_reservar();

-- Nadie cambia el vínculo con un UPDATE suelto: solo las funciones de abajo
-- (que validan permiso y tipo de turno) o el servidor sin sesión.
create or replace function proteger_vinculo_cliente() returns trigger
language plpgsql as $$
begin
  if new.cliente_id is distinct from old.cliente_id
    and auth.uid() is not null
    and coalesce(current_setting('slotly.vincular_cliente', true), '') <> 'on'
  then
    raise exception 'failed-precondition: El cliente de un turno se cambia desde el detalle del turno.';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_proteger_vinculo_cliente on appointments;
create trigger appointments_proteger_vinculo_cliente
  before update on appointments
  for each row execute function proteger_vinculo_cliente();

-- ============================================================================
-- VÍNCULO A MANO (turnos cargados por el negocio)
-- ============================================================================
create or replace function vincular_turno_cliente(p_appointment_id uuid, p_cliente_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  turno record;
begin
  select id, business_id, type into turno from appointments where id = p_appointment_id;
  if turno.id is null or not turno_documentable(p_appointment_id) then
    raise exception 'not-found: No encontramos ese turno.';
  end if;
  if turno.type <> 'manual' then
    raise exception 'failed-precondition: Solo los turnos cargados por el negocio se vinculan a mano: las reservas con cuenta ya quedan en la ficha de quien reservó.';
  end if;
  if p_cliente_id is not null then
    if not exists (select 1 from clientes where id = p_cliente_id and business_id = turno.business_id)
      or not cliente_visible(p_cliente_id)
    then
      raise exception 'not-found: No encontramos ese cliente.';
    end if;
  end if;
  perform set_config('slotly.vincular_cliente', 'on', true);
  update appointments set cliente_id = p_cliente_id where id = p_appointment_id;
  perform set_config('slotly.vincular_cliente', 'off', true);
end;
$$;

-- Crea una ficha sin cuenta con los datos del turno (o los que pase el
-- staff) y le vincula el turno, en una sola operación.
create or replace function crear_cliente_desde_turno(
  p_appointment_id uuid, p_nombre text default null, p_telefono text default null, p_email text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  turno record;
  ficha_id uuid;
begin
  select id, business_id, type, client_name, client_phone, client_email
    into turno from appointments where id = p_appointment_id;
  if turno.id is null or not turno_documentable(p_appointment_id) then
    raise exception 'not-found: No encontramos ese turno.';
  end if;
  if turno.type <> 'manual' then
    raise exception 'failed-precondition: Solo los turnos cargados por el negocio se vinculan a mano.';
  end if;

  insert into clientes (business_id, nombre, telefono, email)
  values (
    turno.business_id,
    left(coalesce(nullif(btrim(p_nombre), ''), nullif(btrim(turno.client_name), ''), 'Cliente'), 120),
    nullif(btrim(coalesce(p_telefono, turno.client_phone)), ''),
    nullif(btrim(coalesce(p_email, turno.client_email)), '')
  ) returning id into ficha_id;

  perform set_config('slotly.vincular_cliente', 'on', true);
  update appointments set cliente_id = ficha_id where id = p_appointment_id;
  perform set_config('slotly.vincular_cliente', 'off', true);
  return ficha_id;
end;
$$;

revoke all on function vincular_turno_cliente(uuid, uuid), crear_cliente_desde_turno(uuid, text, text, text) from public, anon;
grant execute on function vincular_turno_cliente(uuid, uuid), crear_cliente_desde_turno(uuid, text, text, text) to authenticated;

-- ============================================================================
-- CONSULTAS PAGINADAS (security invoker: aplican la RLS de quien consulta)
-- ============================================================================
-- Hoy en la zona del negocio, mismo criterio que el resto del esquema.
create or replace function hoy_ar() returns date
language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- Listado de fichas: búsqueda, filtro, orden y página en el servidor. Los
-- contadores salen de agregar appointments solo de las fichas del negocio
-- (índice appointments_negocio_cliente_idx); no hay contadores duplicados
-- que mantener. `total` es el total filtrado, para la paginación.
create or replace function listar_clientes(
  p_business_id uuid,
  p_busqueda text default null,
  p_filtro text default 'todos',     -- todos | con_cuenta | sin_cuenta | con_proximo
  p_orden text default 'reciente',   -- reciente | nombre | nuevos
  p_limite int default 25,
  p_offset int default 0
) returns table (
  id uuid, nombre text, email text, telefono text, con_cuenta boolean, created_at timestamptz,
  cantidad_turnos bigint, ultimo_turno date, proximo_turno date, total bigint
)
language sql stable as $$
  with filtro as (
    select nullif(btrim(p_busqueda), '') as q
  ),
  patron as (
    select '%' || replace(replace(replace(sin_acentos(lower(q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
    from filtro where q is not null
  ),
  -- Por teléfono solo si lo que se escribió parece un teléfono (sin letras y
  -- con 3 dígitos o más): si no, "Ana 2" traería a todos los que tienen un 2.
  digitos as (
    select regexp_replace(q, '\D', '', 'g') as d
    from filtro where q is not null and q !~ '[[:alpha:]]' and length(regexp_replace(q, '\D', '', 'g')) >= 3
  ),
  base as (
    select c.* from clientes c
    where c.business_id = p_business_id
      and (
        not exists (select 1 from patron)
        or sin_acentos(lower(c.nombre)) like (select p from patron)
        or lower(coalesce(c.email, '')) like (select p from patron)
        or regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g') like '%' || (select d from digitos) || '%'
      )
      and (
        p_filtro is null or p_filtro = 'todos'
        or (p_filtro = 'con_cuenta' and c.user_id is not null)
        or (p_filtro = 'sin_cuenta' and c.user_id is null)
        or p_filtro = 'con_proximo'
      )
  ),
  stats as (
    select a.cliente_id,
           count(*) filter (where a.status <> 'cancelada') as cantidad,
           max(a.appointment_date) filter (where a.status <> 'cancelada' and a.appointment_date <= hoy_ar()) as ultimo,
           min(a.appointment_date) filter (where a.status in ('pendiente', 'confirmada') and a.appointment_date >= hoy_ar()) as proximo
    from appointments a
    where a.business_id = p_business_id and a.cliente_id in (select b.id from base b)
    group by a.cliente_id
  ),
  unido as (
    select b.id, b.nombre, b.email, b.telefono, (b.user_id is not null) as con_cuenta, b.created_at,
           coalesce(s.cantidad, 0) as cantidad_turnos, s.ultimo as ultimo_turno, s.proximo as proximo_turno
    from base b left join stats s on s.cliente_id = b.id
    where p_filtro is distinct from 'con_proximo' or s.proximo is not null
  )
  select u.*, count(*) over () as total
  from unido u
  order by
    case when p_orden = 'nombre' then lower(u.nombre) end asc,
    case when p_orden = 'nuevos' then u.created_at end desc,
    case when p_orden not in ('nombre', 'nuevos') or p_orden is null then u.ultimo_turno end desc nulls last,
    u.created_at desc, u.id
  limit least(greatest(coalesce(p_limite, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Ficha + métricas en una sola consulta.
create or replace function ficha_cliente(p_cliente_id uuid) returns jsonb
language sql stable as $$
  select to_jsonb(c) - 'user_id' || jsonb_build_object(
    'con_cuenta', c.user_id is not null,
    'puede_editar', cliente_editable(c.id),
    'total_turnos', (select count(*) from appointments a where a.cliente_id = c.id and a.status <> 'cancelada'),
    'completados', (select count(*) from appointments a where a.cliente_id = c.id and a.status = 'completada'),
    'cancelados', (select count(*) from appointments a where a.cliente_id = c.id and a.status = 'cancelada'),
    'ausencias', (select count(*) from appointments a where a.cliente_id = c.id and a.status = 'no_asistio'),
    'ultimo_turno', (
      select jsonb_build_object('id', a.id, 'fecha', a.appointment_date, 'hora', a.start_time, 'servicio', a.service_name, 'estado', a.status)
      from appointments a
      where a.cliente_id = c.id and a.status <> 'cancelada' and a.appointment_date <= hoy_ar()
      order by a.appointment_date desc, a.start_time desc limit 1
    ),
    'proximo_turno', (
      select jsonb_build_object('id', a.id, 'fecha', a.appointment_date, 'hora', a.start_time, 'servicio', a.service_name, 'estado', a.status)
      from appointments a
      where a.cliente_id = c.id and a.status in ('pendiente', 'confirmada') and a.appointment_date >= hoy_ar()
      order by a.appointment_date asc, a.start_time asc limit 1
    )
  )
  from clientes c where c.id = p_cliente_id
$$;

-- ============================================================================
-- COMENTARIOS DEL TURNO
-- ============================================================================
create table if not exists turno_comentarios (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  -- Copiado del turno por trigger: nunca se toma del navegador.
  business_id uuid not null references businesses(id) on delete cascade,
  autor_id uuid references auth.users(id) on delete set null,
  autor_nombre text,
  texto text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint turno_comentarios_texto_valido check (char_length(btrim(texto)) between 1 and 4000),
  constraint turno_comentarios_autor_valido check (largo_ok(autor_nombre, 120))
);
create index if not exists turno_comentarios_turno_idx on turno_comentarios (appointment_id, created_at desc);

-- Nombre visible de quien está logueado (Google), para firmar lo que escribe.
create or replace function nombre_de_sesion() returns text
language sql stable as $$
  select left(coalesce(
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
    split_part(auth.jwt() ->> 'email', '@', 1)
  ), 120)
$$;

create or replace function preparar_comentario() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.business_id := (select business_id from appointments where id = new.appointment_id);
    if auth.uid() is not null then
      new.autor_id := auth.uid();
      new.autor_nombre := nombre_de_sesion();
    end if;
    new.created_at := now();
    new.updated_at := null;
    return new;
  end if;
  -- Al editar solo cambia el texto.
  if new.appointment_id is distinct from old.appointment_id
    or new.business_id is distinct from old.business_id
    or new.autor_id is distinct from old.autor_id
    or new.autor_nombre is distinct from old.autor_nombre
    or new.created_at is distinct from old.created_at
  then
    raise exception 'failed-precondition: Solo se puede cambiar el texto del comentario.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists turno_comentarios_preparar on turno_comentarios;
create trigger turno_comentarios_preparar
  before insert or update on turno_comentarios
  for each row execute function preparar_comentario();

alter table turno_comentarios enable row level security;

drop policy if exists turno_comentarios_select on turno_comentarios;
create policy turno_comentarios_select on turno_comentarios
  for select using (turno_interno_visible(appointment_id));

drop policy if exists turno_comentarios_insert on turno_comentarios;
create policy turno_comentarios_insert on turno_comentarios
  for insert with check (turno_documentable(appointment_id) and autor_id = auth.uid());

-- Editar: solo quien lo escribió (y mientras siga teniendo acceso al turno).
drop policy if exists turno_comentarios_update on turno_comentarios;
create policy turno_comentarios_update on turno_comentarios
  for update using (autor_id = auth.uid() and turno_documentable(appointment_id))
  with check (autor_id = auth.uid() and turno_documentable(appointment_id));

-- Borrar: quien lo escribió, o el dueño del negocio.
drop policy if exists turno_comentarios_delete on turno_comentarios;
create policy turno_comentarios_delete on turno_comentarios
  for delete using (
    (autor_id = auth.uid() and turno_documentable(appointment_id))
    or is_business_owner(business_id)
  );

-- ============================================================================
-- ARCHIVOS DEL TURNO (metadatos; el contenido va al bucket privado)
-- ============================================================================
create table if not exists turno_adjuntos (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  subido_por uuid references auth.users(id) on delete set null,
  subido_por_nombre text,
  nombre_original text not null,
  -- 'imagen' | 'documento': permite sumar tipos nuevos sin migrar columnas.
  categoria text not null,
  mime text not null,
  tamano_bytes bigint not null,
  ruta_objeto text not null unique,
  ruta_miniatura text unique,
  ancho int,
  alto int,
  -- 'pendiente' hasta que confirmar-adjunto valida el contenido real.
  estado text not null default 'pendiente',
  created_at timestamptz not null default now(),
  confirmado_at timestamptz,
  constraint turno_adjuntos_estado_valido check (estado in ('pendiente', 'listo')),
  constraint turno_adjuntos_categoria_valida check (categoria in ('imagen', 'documento')),
  constraint turno_adjuntos_nombre_valido check (char_length(nombre_original) between 1 and 180),
  constraint turno_adjuntos_tamano_valido check (tamano_bytes > 0)
);
create index if not exists turno_adjuntos_turno_idx on turno_adjuntos (appointment_id, created_at desc);
-- Para la limpieza de subidas que nunca se confirmaron.
create index if not exists turno_adjuntos_pendientes_idx on turno_adjuntos (created_at) where estado = 'pendiente';

alter table turno_adjuntos enable row level security;

-- Lectura: quien ve el turno, solo los archivos ya validados (más los
-- propios en curso, para que la subida pueda seguir su estado).
drop policy if exists turno_adjuntos_select on turno_adjuntos;
create policy turno_adjuntos_select on turno_adjuntos
  for select using (
    turno_interno_visible(appointment_id)
    and (estado = 'listo' or subido_por = auth.uid())
  );
-- Sin policies de INSERT/UPDATE/DELETE: el alta pasa por iniciar_adjunto()
-- y la confirmación y el borrado por Edge Functions con service role, que
-- validan el contenido y limpian el objeto de Storage junto con la fila.

-- Límites: una sola fuente de verdad. La pantalla los lee para avisarlos
-- ANTES de subir; iniciar_adjunto() los hace cumplir; el bucket tiene además
-- su propio tope duro (file_size_limit) y su lista de tipos.
create or replace function adjuntos_limites() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'maxPorTurno', 20,
    'imagen', jsonb_build_object(
      'maxBytes', 10485760,
      'mimes', jsonb_build_array('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
    ),
    'documento', jsonb_build_object(
      'maxBytes', 15728640,
      'mimes', jsonb_build_array(
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    )
  )
$$;

-- Paso 1 de la subida: valida y reserva la fila + la ruta en Storage. La
-- extensión de la ruta sale del tipo, no del nombre que manda el navegador.
create or replace function iniciar_adjunto(
  p_appointment_id uuid, p_nombre text, p_mime text, p_tamano bigint,
  p_con_miniatura boolean default false, p_ancho int default null, p_alto int default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  limites jsonb := adjuntos_limites();
  turno record;
  cat text;
  ext text;
  nuevo_id uuid := gen_random_uuid();
  ruta text;
  ruta_mini text;
  nombre_limpio text;
begin
  select id, business_id into turno from appointments where id = p_appointment_id;
  if turno.id is null or not turno_documentable(p_appointment_id) then
    raise exception 'not-found: No encontramos ese turno.';
  end if;

  if limites->'imagen'->'mimes' ? p_mime then cat := 'imagen';
  elsif limites->'documento'->'mimes' ? p_mime then cat := 'documento';
  else
    raise exception 'invalid-argument: Ese tipo de archivo no está permitido. Podés subir fotos (JPG, PNG, WebP, HEIC), PDF o Word.';
  end if;

  if p_tamano is null or p_tamano <= 0 then
    raise exception 'invalid-argument: El archivo está vacío.';
  end if;
  if p_tamano > (limites->cat->>'maxBytes')::bigint then
    raise exception 'invalid-argument: El archivo supera el máximo de % MB.', ((limites->cat->>'maxBytes')::bigint / 1048576);
  end if;

  if (select count(*) from turno_adjuntos
      where appointment_id = p_appointment_id
        and (estado = 'listo' or created_at > now() - interval '2 hours')) >= (limites->>'maxPorTurno')::int
  then
    raise exception 'resource-exhausted: Este turno ya tiene el máximo de % archivos.', limites->>'maxPorTurno';
  end if;

  ext := case p_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf'
    when 'application/msword' then 'doc' else 'docx' end;

  -- Sin separadores de carpeta ni caracteres de control; tope de largo.
  nombre_limpio := left(btrim(regexp_replace(coalesce(p_nombre, ''), '[\x00-\x1f\x7f/\\]', '', 'g')), 180);
  if nombre_limpio = '' then nombre_limpio := 'archivo.' || ext; end if;

  ruta := turno.business_id || '/' || p_appointment_id || '/' || nuevo_id || '/original.' || ext;
  if cat = 'imagen' and coalesce(p_con_miniatura, false) then
    ruta_mini := turno.business_id || '/' || p_appointment_id || '/' || nuevo_id || '/miniatura.webp';
  end if;

  insert into turno_adjuntos (
    id, appointment_id, business_id, subido_por, subido_por_nombre, nombre_original, categoria, mime,
    tamano_bytes, ruta_objeto, ruta_miniatura, ancho, alto, estado
  ) values (
    nuevo_id, p_appointment_id, turno.business_id, auth.uid(), nombre_de_sesion(), nombre_limpio, cat, p_mime,
    p_tamano, ruta, ruta_mini,
    case when p_ancho between 1 and 20000 then p_ancho end,
    case when p_alto between 1 and 20000 then p_alto end,
    'pendiente'
  );

  return jsonb_build_object('id', nuevo_id, 'ruta', ruta, 'rutaMiniatura', ruta_mini);
end;
$$;

revoke all on function iniciar_adjunto(uuid, text, text, bigint, boolean, int, int) from public, anon;
grant execute on function iniciar_adjunto(uuid, text, text, bigint, boolean, int, int) to authenticated;

-- ¿Quien llama puede borrar este archivo? Quien lo subió (si sigue teniendo
-- acceso al turno) o el dueño del negocio. Lo usa eliminar-adjunto.
create or replace function adjunto_borrable(p_adjunto_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from turno_adjuntos t
    where t.id = p_adjunto_id
      and (
        (t.subido_por = auth.uid() and turno_documentable(t.appointment_id))
        or is_business_owner(t.business_id)
      )
  )
$$;
revoke all on function adjunto_borrable(uuid) from public, anon;
grant execute on function adjunto_borrable(uuid) to authenticated;

-- ============================================================================
-- HISTORIAL (va después de las tablas de comentarios y archivos, que cuenta)
-- ============================================================================
-- Historial paginado, más reciente primero, con cuántos comentarios y
-- archivos tiene cada turno (en la misma consulta: sin N+1). Solo devuelve
-- los turnos que quien consulta puede ver (RLS de appointments).
create or replace function historial_cliente(
  p_cliente_id uuid,
  p_desde date default null,
  p_hasta date default null,
  p_estado text default null,
  p_servicio_id uuid default null,
  p_limite int default 20,
  p_offset int default 0
) returns table (
  id uuid, business_id uuid, appointment_date date, start_time text, end_time text, status text, type text,
  service_id uuid, service_name text, professional_id uuid, professional_name text, branch_id uuid,
  price numeric, notes text, cancelled_by text, cancellation_reason text,
  comentarios bigint, adjuntos bigint, total bigint
)
language sql stable as $$
  with pagina as (
    select a.*, count(*) over () as total
    from appointments a
    where a.cliente_id = p_cliente_id
      and (p_desde is null or a.appointment_date >= p_desde)
      and (p_hasta is null or a.appointment_date <= p_hasta)
      and (p_estado is null or a.status = p_estado)
      and (p_servicio_id is null or a.service_id = p_servicio_id)
    order by a.appointment_date desc, a.start_time desc, a.created_at desc
    limit least(greatest(coalesce(p_limite, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.business_id, p.appointment_date, p.start_time, p.end_time, p.status, p.type,
         p.service_id, p.service_name, p.professional_id, pr.name, p.branch_id,
         p.price, p.notes, p.cancelled_by, p.cancellation_reason,
         (select count(*) from turno_comentarios tc where tc.appointment_id = p.id),
         (select count(*) from turno_adjuntos ta where ta.appointment_id = p.id and ta.estado = 'listo'),
         p.total
  from pagina p
  left join professionals pr on pr.id = p.professional_id
  order by p.appointment_date desc, p.start_time desc, p.created_at desc
$$;

revoke all on function listar_clientes(uuid, text, text, text, int, int), ficha_cliente(uuid),
  historial_cliente(uuid, date, date, text, uuid, int, int) from public, anon;
grant execute on function listar_clientes(uuid, text, text, text, int, int), ficha_cliente(uuid),
  historial_cliente(uuid, date, date, text, uuid, int, int) to authenticated, service_role;

-- ============================================================================
-- STORAGE: bucket privado con tope de tamaño y tipos
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'turno-adjuntos', 'turno-adjuntos', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Subir: solo a una ruta reservada por iniciar_adjunto() para ESE usuario,
-- todavía pendiente y reciente. Ninguna otra ruta del bucket es escribible.
drop policy if exists turno_adjuntos_storage_insert on storage.objects;
create policy turno_adjuntos_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'turno-adjuntos'
    and exists (
      select 1 from public.turno_adjuntos t
      where t.estado = 'pendiente'
        and t.subido_por = auth.uid()
        and t.created_at > now() - interval '2 hours'
        and (t.ruta_objeto = storage.objects.name or t.ruta_miniatura = storage.objects.name)
    )
  );

-- Leer (URL firmada): solo archivos ya validados de turnos que quien pide
-- puede ver. La RLS de turno_adjuntos se aplica adentro del exists.
drop policy if exists turno_adjuntos_storage_select on storage.objects;
create policy turno_adjuntos_storage_select on storage.objects
  for select to authenticated using (
    bucket_id = 'turno-adjuntos'
    and exists (
      select 1 from public.turno_adjuntos t
      where t.estado = 'listo'
        and (t.ruta_objeto = storage.objects.name or t.ruta_miniatura = storage.objects.name)
    )
  );
-- Sin UPDATE ni DELETE para usuarios: nada se sobrescribe, y el borrado lo
-- hace eliminar-adjunto con service role, junto con la fila.

-- ============================================================================
-- TURNOS HISTÓRICOS: vínculo idempotente
-- ============================================================================
-- Solo turnos 'client' con cuenta (identidad verificable). Fila por fila con
-- su propio bloque de excepción: un turno viejo que no cumpla alguna
-- validación posterior se saltea (y se avisa) en vez de frenar todo.
do $$
declare
  t record;
  vinculados int := 0;
  salteados int := 0;
begin
  alter table appointments disable trigger appointments_protect_client_cancel;
  for t in
    select id, business_id, user_id, client_name from appointments
    where type = 'client' and user_id is not null and cliente_id is null
    order by created_at
  loop
    begin
      update appointments
        set cliente_id = asegurar_cliente_de_cuenta(t.business_id, t.user_id, t.client_name)
        where id = t.id;
      vinculados := vinculados + 1;
    exception when others then
      salteados := salteados + 1;
      raise notice 'Turno % sin vincular: %', t.id, sqlerrm;
    end;
  end loop;
  alter table appointments enable trigger appointments_protect_client_cancel;
  raise notice 'Clientes: % turnos vinculados, % salteados', vinculados, salteados;
end $$;

-- ============================================================================
-- LIMPIEZA (la usa la Edge Function limpiar-adjuntos, solo con service role)
-- ============================================================================
-- Objetos del bucket que no tienen fila (subidas cortadas antes de reservar
-- la fila no pueden existir por la policy de INSERT, pero sí quedan los de
-- una fila pendiente vencida que ya se borró, o los de un negocio dado de
-- baja: sus filas se van en cascada y el objeto no). Solo los de más de
-- 24 h, para no pisar una subida en curso.
create or replace function adjuntos_huerfanos(p_limite int default 200)
returns table (ruta text)
language sql stable security definer set search_path = public, storage, pg_temp as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'turno-adjuntos'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.turno_adjuntos t
      where t.ruta_objeto = o.name or t.ruta_miniatura = o.name
    )
  order by o.created_at
  limit least(greatest(coalesce(p_limite, 200), 1), 1000)
$$;

revoke all on function adjuntos_huerfanos(int) from public, anon, authenticated;
grant execute on function adjuntos_huerfanos(int) to service_role;
