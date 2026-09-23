-- ============================================================================
-- create_appointment: reserva server-side autoritativa
-- ============================================================================
-- Traducción de exports.createAppointment en functions/index.js. Es la
-- función más crítica de todo el sistema: el precio, la duración y la
-- disponibilidad NUNCA se confían en lo que mande el cliente, siempre se
-- recalculan acá adentro.
--
-- Por qué es una función de Postgres (SECURITY DEFINER) y no solo lógica en
-- la Edge Function: la transacción de Firestore original leía "¿hay
-- solapamiento?" y escribía el turno como una unidad atómica, para que dos
-- personas mirando la misma grilla no pudieran confirmar con milisegundos
-- de diferencia y pisarse. Acá el equivalente es correr todo DENTRO de una
-- sola función de Postgres (que ya corre en su propia transacción) más un
-- advisory lock transaccional sobre (professional_id, appointment_date):
-- mientras una llamada para ese profesional/día está en curso, cualquier
-- otra llamada para el MISMO profesional/día espera a que termine antes de
-- leer el estado de la agenda — mismo efecto que el retry optimista de
-- Firestore, sin necesitar reintentar nada del lado del cliente.
--
-- Convención de errores: cada RAISE EXCEPTION empieza con 'codigo: mensaje'
-- (mismos códigos que ya usaban los HttpsError de Firebase — invalid-
-- argument, not-found, failed-precondition, already-exists,
-- resource-exhausted) — la Edge Function separa el prefijo del mensaje y
-- arma la misma Response que las demás.

create extension if not exists "pgcrypto";

-- El Cloud Function original guardaba esto en el turno cuando aplicaba una
-- promo (para que el panel pueda mostrar "tenía descuento" sin recalcular
-- nada) — ningún archivo de src/ lo lee todavía, pero se preserva para
-- mantener paridad de comportamiento con lo que se está migrando.
alter table public.appointments
  add column if not exists original_price numeric,
  add column if not exists promo_id uuid references public.promotions(id);

-- 0=Lunes … 6=Domingo, igual que diaDeLaSemana() en functions/index.js y
-- getLocalDayOfWeek() en src/utils/dateUtils.js. Tiene que coincidir clavado
-- con los dos, si no los horarios cargados no matchean ningún día.
create or replace function dia_de_la_semana(fecha date) returns integer
language sql immutable as $$
  select case extract(dow from fecha)::int
    when 0 then 6
    else extract(dow from fecha)::int - 1
  end
$$;

-- 'HH:MM' → minutos desde medianoche. Los horarios se guardan como texto
-- (mismo formato que Firestore), no como `time`, para no tener que tocar
-- src/utils/dateUtils.js ni availabilityEngine.js del lado del cliente.
create or replace function tiempo_a_minutos(t text) returns integer
language sql immutable as $$
  select (split_part(t, ':', 1)::int * 60) + split_part(t, ':', 2)::int
$$;

create or replace function minutos_a_tiempo(min integer) returns text
language sql immutable as $$
  select lpad((min / 60)::text, 2, '0') || ':' || lpad((min % 60)::text, 2, '0')
$$;

-- Hoy en Buenos Aires, como fecha — no el hoy del servidor (que puede estar
-- en UTC y adelantarse un día a partir de las 21hs argentinas).
create or replace function hoy_en_argentina() returns date
language sql stable as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

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

  -- El teléfono es lo único que le pedimos al cliente además del turno: es
  -- por donde lo va a contactar el negocio. Se cuentan solo los dígitos:
  -- "+54 9 11 1234-5678" y "1123456789" son los dos válidos.
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

  -- ── El turno tiene que caer dentro del horario ──────────────────────────
  dow := dia_de_la_semana(p_appointment_date);
  inicio := tiempo_a_minutos(p_start_time);
  fin := inicio + duracion;

  -- El horario del negocio recorta el del profesional (mismo criterio que
  -- availabilityEngine.js del lado del cliente). business_hours es jsonb:
  -- un array de {dayOfWeek, startTime, endTime, isActive}.
  select elem into dia_negocio
  from jsonb_array_elements(coalesce(negocio.business_hours, '[]'::jsonb)) elem
  where (elem->>'dayOfWeek')::int = dow
  limit 1;

  if dia_negocio is not null and (dia_negocio->>'isActive')::boolean = false then
    raise exception 'failed-precondition: El negocio no abre ese día.';
  end if;

  -- Puede haber más de una franja el mismo día (horario cortado): alcanza
  -- con que el turno entre en CUALQUIERA de ellas.
  for franja in
    select * from schedules
    where professional_id = p_professional_id
      and day_of_week = dow
      and coalesce(is_active, true)
      and start_time is not null and end_time is not null
  loop
    desde := tiempo_a_minutos(franja.start_time);
    hasta := tiempo_a_minutos(franja.end_time);
    if dia_negocio is not null and dia_negocio->>'startTime' is not null and dia_negocio->>'endTime' is not null then
      desde := greatest(desde, tiempo_a_minutos(dia_negocio->>'startTime'));
      hasta := least(hasta, tiempo_a_minutos(dia_negocio->>'endTime'));
    end if;
    if inicio < desde or fin > hasta then
      continue;
    end if;
    if franja.break_start is not null and franja.break_end is not null then
      break_start := tiempo_a_minutos(franja.break_start);
      break_end := tiempo_a_minutos(franja.break_end);
      if inicio < break_end and fin > break_start then
        continue;
      end if;
    end if;
    entra_en_alguna := true;
    exit;
  end loop;

  if not entra_en_alguna then
    -- Ninguna franja encontrada en absoluto (el profesional no trabaja ese
    -- día) vs. una franja que existe pero no alcanza: mismo mensaje que
    -- Firebase en el primer caso, "fuera de horario" en el segundo — acá
    -- se simplifica a un solo mensaje, la distinción no cambia qué hace el
    -- cliente (elegir otro día/horario).
    if not exists (
      select 1 from schedules
      where professional_id = p_professional_id and day_of_week = dow
        and coalesce(is_active, true) and start_time is not null and end_time is not null
    ) then
      raise exception 'failed-precondition: El profesional no trabaja ese día.';
    end if;
    raise exception 'failed-precondition: Ese horario está fuera del horario de atención.';
  end if;

  -- ── Promoción activa para este servicio+día+horario, si hay ────────────
  -- Mismo criterio que el precio del servicio: se calcula acá, nunca se
  -- confía en lo que mande el cliente. src/utils/promoEngine.js hace este
  -- mismo cálculo del lado del browser, pero solo para MOSTRAR el precio
  -- antes de confirmar — lo que de verdad se cobra sale de acá.
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

  -- ── Todo lo que sigue, con el advisory lock tomado ──────────────────────
  -- Mismo profesional + mismo día: solo una llamada a la vez pasa de acá en
  -- adelante. Se libera solo al terminar la función (commit o rollback).
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
    business_id, professional_id, service_id, user_id,
    appointment_date, start_time, end_time,
    price, original_price, promo_id, duration_minutes, service_name,
    client_name, client_phone, client_email, notes,
    status, type
  ) values (
    p_business_id, p_professional_id, p_service_id, p_user_id,
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

revoke all on function create_appointment(uuid, uuid, uuid, date, text, text, text, text, text, uuid) from public, anon;
grant execute on function create_appointment(uuid, uuid, uuid, date, text, text, text, text, text, uuid) to authenticated, service_role;
