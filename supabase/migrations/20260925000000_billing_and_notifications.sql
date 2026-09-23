-- ============================================================================
-- Facturación diaria (process_billing) y notificaciones de turnos
-- ============================================================================
-- Traducción de procesarFacturacion + onNuevoTurno/onTurnoCancelado en
-- functions/index.js.

-- ============================================================================
-- Fix: auth_is_platform() también reconoce a la service role
-- ============================================================================
-- process_billing() (más abajo) escribe is_frozen/frozen_at en `businesses`,
-- columnas protegidas por el trigger businesses_protect_columns (ver
-- 20260919201100_rls.sql), que exige auth_is_platform(). SECURITY DEFINER
-- evita las policies de RLS, pero NO evita triggers BEFORE UPDATE — esos
-- siguen viendo el JWT real con el que se llamó a la función. Cuando
-- run-billing invoca process_billing() con la service role key (nunca con
-- el JWT de una persona), auth.jwt() trae el JWT de esa key, que tiene
-- `role: service_role` pero ningún `app_metadata.platform` — sin este fix,
-- process_billing() se bloquearía a sí misma con "Solo la plataforma puede
-- modificar esos campos" en cuanto hubiera algo real para congelar.
--
-- No amplía el acceso de nadie: la service role ya bypassea RLS por
-- completo a nivel de rol de Postgres (BYPASSRLS) en cualquier policy que
-- use auth_is_platform() — acá solo hace falta porque un trigger no es RLS
-- y no se bypassea solo.
create or replace function auth_is_platform() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform')::boolean, false)
    or (auth.jwt() ->> 'role') = 'service_role'
$$;

-- ============================================================================
-- process_billing: cobro mensual, suspensión por deuda, borrado de
-- self-service que nunca pagaron
-- ============================================================================
-- Postgres hace en una sola sentencia lo que en Firestore eran lecturas +
-- writes en batches de 450 (el límite de Firestore por batch) — acá no hace
-- falta ese trabajo manual, una transacción cubre todos los negocios.
--
-- Lo único que esta función NO hace es borrar los negocios candidatos: igual
-- que delete-business, borrar implica limpiar los custom claims de Auth
-- primero (raw_app_meta_data vive en auth.users, no en una tabla con FK), y
-- eso requiere la Admin API — solo la puede hacer una Edge Function. Por eso
-- esta función devuelve la lista de candidatos y quien llama (el Edge
-- Function run-billing) hace el borrado real, con el mismo orden que
-- delete-business: primero limpiar claims, después delete_business_cascade.
create or replace function process_billing()
returns table(business_id uuid, business_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  cambios integer := 0;
  en_prueba integer := 0;
  fila record;
  nueva_deuda numeric;
  proximo_vencimiento date;
  vueltas integer;
  deberia_congelar boolean;
  estaba_congelado boolean;
  nuevo_frozen_at date;
begin
  for fila in
    select b.id, b.name, b.trial_ends_at, b.is_frozen, b.frozen_at, b.signup_source,
           coalesce(bi.debt, 0) as debt, bi.monthly_fee, bi.next_billing_date, bi.last_payment_date
    from businesses b
    left join billing bi on bi.business_id = b.id
  loop
    -- Cuenta de prueba: ni se cobra ni se congela hasta que termine.
    if fila.trial_ends_at is not null and hoy <= fila.trial_ends_at then
      en_prueba := en_prueba + 1;
      continue;
    end if;

    nueva_deuda := fila.debt;
    proximo_vencimiento := fila.next_billing_date;

    if proximo_vencimiento is null then
      proximo_vencimiento := (hoy + interval '1 month')::date;
      -- `billing.business_id` calificado a propósito: sin el alias, ese
      -- nombre de columna es ambiguo con el parámetro de salida
      -- `business_id` de la función (visible en todo el cuerpo por el
      -- `returns table(business_id uuid, ...)`).
      update billing set next_billing_date = proximo_vencimiento where billing.business_id = fila.id;
      if not found then
        insert into billing (business_id, debt, next_billing_date) values (fila.id, 0, proximo_vencimiento);
      end if;
    end if;

    -- Si pasaron varios vencimientos sin pago, se acumulan todos. El tope de
    -- vueltas es una red por si next_billing_date viniera corrupto.
    vueltas := 0;
    while hoy > proximo_vencimiento and vueltas < 120 loop
      nueva_deuda := nueva_deuda + coalesce(fila.monthly_fee, 0);
      proximo_vencimiento := (proximo_vencimiento + interval '1 month')::date;
      vueltas := vueltas + 1;
    end loop;

    if vueltas > 0 then
      update billing set debt = nueva_deuda, next_billing_date = proximo_vencimiento
        where billing.business_id = fila.id;
      cambios := cambios + 1;
    end if;

    deberia_congelar := nueva_deuda > 0;
    estaba_congelado := coalesce(fila.is_frozen, false);
    nuevo_frozen_at := case
      when deberia_congelar and estaba_congelado then fila.frozen_at
      when deberia_congelar then hoy
      else null
    end;

    if estaba_congelado is distinct from deberia_congelar then
      update businesses set is_frozen = deberia_congelar, frozen_at = nuevo_frozen_at where id = fila.id;
      cambios := cambios + 1;
    end if;

    -- Alta self-service que nunca pagó ni un peso y sigue congelada hace una
    -- semana: candidata a borrado automático. Nunca toca una cuenta que
    -- alguna vez registró un pago, ni una que no vino de esta puerta de alta.
    if fila.signup_source = 'self_service'
       and deberia_congelar
       and nuevo_frozen_at is not null
       and fila.last_payment_date is null
       and (hoy - nuevo_frozen_at) >= 7
    then
      business_id := fila.id;
      business_name := fila.name;
      return next;
    end if;
  end loop;

  raise log '[billing] %: % cambios, % negocios en prueba.', hoy, cambios, en_prueba;
end;
$$;

revoke all on function process_billing() from public, anon, authenticated;
grant execute on function process_billing() to service_role;

-- ============================================================================
-- Fix: notifications.appointment_id necesita ON DELETE CASCADE
-- ============================================================================
-- Sin write real hacia `notifications` (hasta esta migración, la tabla
-- estaba en el esquema pero nada la usaba) esta FK nunca se había ejercitado.
-- Con los triggers de más abajo escribiendo de verdad, borrar un turno con
-- notificaciones asociadas violaba la FK (verificado con
-- rls_smoke_test.sql, cuya limpieza sí borra turnos). El borrado en cascada
-- de un negocio entero no lo sufre (business_id ya cascadea en las dos
-- tablas independientemente), pero cualquier borrado puntual de un turno sí.
alter table notifications drop constraint if exists notifications_appointment_id_fkey;
alter table notifications
  add constraint notifications_appointment_id_fkey
  foreign key (appointment_id) references appointments(id) on delete cascade;

-- ============================================================================
-- Notificaciones de turnos (reemplaza onNuevoTurno / onTurnoCancelado)
-- ============================================================================
-- El envío de push (FCM en el original) queda para la Fase 5 (Web Push +
-- push_subscriptions, que ya existe en el esquema desde la Fase 1). Estos
-- triggers dejan lista la notificación in-app (la campanita), que es la
-- parte que no depende de esa infraestructura todavía. Cuando llegue Fase 5,
-- se le agrega a cada trigger un `perform net.http_post(...)` hacia una Edge
-- Function que reparta el push, mismo criterio que ya deja documentado
-- CLAUDE.md para cuando llegue WhatsApp ("sale del mismo trigger").
create or replace function handle_nuevo_turno() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Lo cargó el propio staff (walk-in o a mano): ya lo sabe.
  if new.type in ('walkin', 'manual') then
    return new;
  end if;

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date)
  values (
    new.business_id,
    'nuevo_turno',
    'Nuevo turno',
    coalesce(new.client_name, 'Un cliente') || ' reservó ' || coalesce(new.service_name, 'un servicio')
      || ' · ' || to_char(new.appointment_date, 'DD/MM') || ' ' || new.start_time,
    new.professional_id,
    new.id,
    new.appointment_date
  );
  return new;
end;
$$;

drop trigger if exists trg_nuevo_turno on appointments;
create trigger trg_nuevo_turno
  after insert on appointments
  for each row execute function handle_nuevo_turno();

create or replace function handle_turno_cancelado() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'cancelada' or new.status <> 'cancelada' then
    return new;
  end if;
  -- Solo si canceló el cliente. Si lo canceló el staff, ya lo sabe.
  if new.cancelled_by <> 'client' then
    return new;
  end if;

  insert into notifications (business_id, type, title, body, professional_id, appointment_id, appointment_date)
  values (
    new.business_id,
    'turno_cancelado',
    'Turno cancelado',
    coalesce(new.client_name, 'Un cliente') || ' canceló ' || coalesce(new.service_name, 'su turno')
      || ' · ' || to_char(new.appointment_date, 'DD/MM') || ' ' || new.start_time,
    new.professional_id,
    new.id,
    new.appointment_date
  );
  return new;
end;
$$;

-- ============================================================================
-- Scheduling: pg_cron -> Edge Function run-billing (una vez por día)
-- ============================================================================
-- Equivalente a `onSchedule({ schedule: '0 3 * * *', timeZone:
-- 'America/Argentina/Buenos_Aires' }, ...)` en Firebase. Queda comentado a
-- propósito: `net.http_post` necesita la URL pública del proyecto de
-- Supabase — no la local (que además dispararía cobros/borrados de prueba
-- cada 24hs sobre datos de prueba sin que nadie lo pida) — y la service
-- role key como Bearer. Activar recién en Fase 8, contra el proyecto real,
-- reemplazando <PROJECT_REF> y <SERVICE_ROLE_KEY>:
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule(
--   'run-billing-diario',
--   '0 6 * * *', -- pg_cron corre en UTC; 3 AM Argentina (UTC-3) = 6 AM UTC
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/run-billing',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
--   );
--   $$
-- );

drop trigger if exists trg_turno_cancelado on appointments;
create trigger trg_turno_cancelado
  after update on appointments
  for each row execute function handle_turno_cancelado();
