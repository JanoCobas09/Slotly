-- ============================================================================
-- Los turnos nacen confirmados
-- ============================================================================
-- El cliente solo puede elegir horarios que el negocio ya habilitó (franjas,
-- horario de atención, días bloqueados), así que no hay nada que aprobar:
-- pedido del usuario. Antes la reserva pública entraba 'pendiente' y quedaba
-- así hasta que alguien tocara "Confirmar".
--
-- 'pendiente' sigue siendo un estado válido (CHECK, filtros, los turnos que
-- ya estaban así), pero ya no nace ninguno. Un turno con seña sin pagar
-- también nace confirmado: lo que espera es la seña (deposit_status), y si no
-- se paga se borra solo a los 15 minutos, como antes.

-- create_appointment: idéntica a la de 20261009000000_sucursales.sql salvo
-- el estado con el que inserta.
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
    'confirmada', 'client'
  ) returning * into nuevo;

  return nuevo;
end;
$$;
