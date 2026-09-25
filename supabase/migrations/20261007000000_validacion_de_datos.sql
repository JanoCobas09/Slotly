-- ============================================================================
-- Validación de datos: la base no acepta cualquier cosa
-- ============================================================================
-- Auditoría de todo lo que carga cada tipo de usuario (cliente, profesional,
-- dueño, plataforma). Hasta acá casi ninguna columna tenía reglas: textos de
-- cualquier largo, precios y duraciones negativos, colores que no son
-- colores, horarios con el fin antes del inicio, teléfonos/mails sin forma y
-- links que no son links. Las pantallas validaban poco y desparejo, y de
-- todos modos no son barrera: con la consola abierta se escribe directo
-- (RLS decide QUIÉN escribe, no QUÉ).
--
-- Estas reglas son la barrera real. Las pantallas replican las mismas (ver
-- src/utils/validaciones.js) para avisar antes de guardar, y repository.js
-- traduce el nombre de cada restricción a un mensaje legible — por eso los
-- nombres importan: si cambiás uno acá, cambialo allá.
--
-- NOT VALID a propósito: la regla rige para todo lo que se cree o se edite
-- de acá en adelante, pero no revisa las filas que ya existen (una fila vieja
-- fuera de regla no rompe la migración ni la página; se pide corregirla
-- recién cuando alguien la edite).

-- ── Helpers (immutable: los usan los CHECK) ────────────────────────────────
create or replace function hora_ok(t text) returns boolean
language sql immutable as $$
  select t is null or t = '' or t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
$$;

create or replace function telefono_ok(t text) returns boolean
language sql immutable as $$
  select t is null or btrim(t) = ''
    or (t ~ '^[0-9+()\s.-]{6,25}$' and length(regexp_replace(t, '\D', '', 'g')) between 6 and 15)
$$;

create or replace function email_ok(t text) returns boolean
language sql immutable as $$
  select t is null or btrim(t) = ''
    or (char_length(t) <= 254 and t ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
$$;

-- Solo http(s): nada de javascript:, data:, etc. en un link que después se
-- muestra como <a href> o <img src> en la página pública del negocio.
create or replace function url_ok(t text) returns boolean
language sql immutable as $$
  select t is null or btrim(t) = ''
    or (char_length(t) <= 2000 and t ~* '^https?://[^\s<>"]+$')
$$;

create or replace function color_ok(t text) returns boolean
language sql immutable as $$
  select t is null or t ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
$$;

create or replace function largo_ok(t text, maximo int) returns boolean
language sql immutable as $$
  select t is null or char_length(t) <= maximo
$$;

-- business_hours: [{dayOfWeek 0-6, isActive, startTime, endTime}, ...]. Un
-- día abierto tiene que tener las dos horas y el cierre después de la apertura.
create or replace function horario_negocio_ok(h jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(h) = 'array'
    and jsonb_array_length(h) <= 7
    and not exists (
      select 1 from jsonb_array_elements(h) e
      where jsonb_typeof(e) <> 'object'
        or coalesce(e->>'dayOfWeek', '') !~ '^[0-6]$'
        or (
          e->'isActive' = 'true'::jsonb
          and not (
            coalesce(e->>'startTime', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and coalesce(e->>'endTime', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and e->>'startTime' < e->>'endTime'
          )
        )
    )
$$;

-- ── NEGOCIO (dueño desde Configuración, plataforma desde el alta) ──────────
alter table businesses
  add constraint businesses_nombre_valido check (char_length(btrim(name)) between 2 and 80) not valid,
  add constraint businesses_mensaje_valido check (largo_ok(welcome_message, 500)) not valid,
  add constraint businesses_telefono_valido check (telefono_ok(phone)) not valid,
  add constraint businesses_email_valido check (email_ok(email)) not valid,
  add constraint businesses_direccion_valida check (largo_ok(address, 200)) not valid,
  add constraint businesses_maps_valido check (url_ok(maps_url)) not valid,
  add constraint businesses_logo_valido check (url_ok(logo_url)) not valid,
  add constraint businesses_colores_validos check (color_ok(primary_color) and color_ok(secondary_color) and color_ok(accent_color)) not valid,
  add constraint businesses_moneda_valida check (currency in ('ARS', 'USD', 'CLP', 'MXN', 'COP')) not valid,
  add constraint businesses_intervalo_valido check (slot_interval between 5 and 240) not valid,
  add constraint businesses_cancelacion_valida check (min_cancel_hours between 0 and 168) not valid,
  add constraint businesses_rubro_valido check (largo_ok(custom_profession, 60)) not valid,
  add constraint businesses_redes_validas check (
    jsonb_typeof(social_links) = 'object'
    and coalesce(social_links->>'instagram', '') ~ '^@?[A-Za-z0-9._]{0,30}$'
    and telefono_ok(social_links->>'whatsapp')
  ) not valid,
  add constraint businesses_horario_valido check (horario_negocio_ok(business_hours)) not valid,
  add constraint businesses_sena_valida check (
    deposit_value is null
    or (deposit_type = 'percent' and deposit_value <= 100)
    or (deposit_type = 'fixed' and deposit_value <= 100000000)
  ) not valid;

-- ── SERVICIOS ──────────────────────────────────────────────────────────────
-- Precio 0 permitido: los servicios sugeridos por rubro nacen sin precio, y
-- una consulta gratis es un caso real.
alter table services
  add constraint services_nombre_valido check (char_length(btrim(name)) between 2 and 80) not valid,
  add constraint services_descripcion_valida check (largo_ok(description, 500)) not valid,
  add constraint services_categoria_valida check (largo_ok(category, 60)) not valid,
  add constraint services_duracion_valida check (duration_minutes between 5 and 720) not valid,
  add constraint services_precio_valido check (price between 0 and 100000000) not valid;

alter table professional_services
  add constraint professional_services_precio_valido check (custom_price is null or custom_price between 0 and 100000000) not valid,
  add constraint professional_services_duracion_valida check (custom_duration is null or custom_duration between 5 and 720) not valid;

-- ── PROFESIONALES (dueño, o el propio profesional desde "Mi perfil") ───────
alter table professionals
  add constraint professionals_nombre_valido check (char_length(btrim(name)) between 2 and 80) not valid,
  add constraint professionals_especialidad_valida check (largo_ok(specialty, 80)) not valid,
  add constraint professionals_bio_valida check (largo_ok(bio, 500)) not valid,
  add constraint professionals_foto_valida check (url_ok(avatar_url)) not valid;

alter table staff_contacts
  add constraint staff_contacts_telefono_valido check (telefono_ok(phone)) not valid,
  add constraint staff_contacts_email_valido check (email_ok(email)) not valid;

-- Horas vacías permitidas (días sin horario desde "Mi perfil"); si están las
-- dos, el fin después del inicio, y el descanso adentro de la franja.
alter table schedules
  add constraint schedules_horas_validas check (
    hora_ok(start_time) and hora_ok(end_time) and hora_ok(break_start) and hora_ok(break_end)
  ) not valid,
  add constraint schedules_rango_valido check (
    coalesce(start_time, '') = '' or coalesce(end_time, '') = '' or start_time < end_time
  ) not valid,
  add constraint schedules_descanso_valido check (
    coalesce(break_start, '') = '' or coalesce(break_end, '') = ''
    or (break_start < break_end
        and (coalesce(start_time, '') = '' or break_start >= start_time)
        and (coalesce(end_time, '') = '' or break_end <= end_time))
  ) not valid;

-- ── PROMOCIONES ────────────────────────────────────────────────────────────
-- 'percentage' = % de descuento; 'fixed' = precio final fijo (así la usa
-- create_appointment).
alter table promotions
  add constraint promotions_horas_validas check (
    start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and start_time < end_time
  ) not valid,
  add constraint promotions_descuento_valido check (
    (discount_type = 'percentage' and discount_value > 0 and discount_value < 100)
    or (discount_type = 'fixed' and discount_value between 0 and 100000000)
  ) not valid;

-- ── TURNOS (el cliente vía create_appointment, el staff directo) ───────────
-- create_appointment ya recorta nombre/teléfono/notas; esto cubre también lo
-- que carga o edita el staff a mano. El fin admite 24:xx: un turno que
-- termina justo a la medianoche lo calcula así minutos_a_tiempo().
alter table appointments
  add constraint appointments_horas_validas check (
    start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and (end_time is null or end_time ~ '^([01][0-9]|2[0-4]):[0-5][0-9]$')
  ) not valid,
  add constraint appointments_tipo_valido check (type in ('client', 'walkin', 'manual')) not valid,
  add constraint appointments_cliente_valido check (
    largo_ok(client_name, 120) and largo_ok(client_phone, 40) and telefono_ok(client_phone) and email_ok(client_email)
  ) not valid,
  add constraint appointments_notas_validas check (
    largo_ok(notes, 500) and largo_ok(admin_notes, 500) and largo_ok(cancellation_reason, 300)
  ) not valid,
  add constraint appointments_precio_valido check (price is null or price between 0 and 100000000) not valid;

-- ── EQUIPO Y SOPORTE ───────────────────────────────────────────────────────
alter table admins
  add constraint admins_email_valido check (btrim(email) <> '' and email_ok(email)) not valid,
  add constraint admins_nombre_valido check (largo_ok(name, 80)) not valid;

alter table tickets
  add constraint tickets_asunto_valido check (subject is null or char_length(btrim(subject)) between 1 and 120) not valid,
  add constraint tickets_categoria_valida check (largo_ok(category, 40)) not valid;

alter table ticket_messages
  add constraint ticket_messages_texto_valido check (char_length(btrim(body)) between 1 and 4000) not valid;

-- ── FACTURACIÓN (solo plataforma) ──────────────────────────────────────────
alter table billing
  add constraint billing_abono_valido check (monthly_fee >= 0) not valid;
