-- unaccent(): para el slug ("Peluquería Añez" → "peluqueria-anez"), mismo
-- resultado que el NFD + strip de diacríticos + reemplazo de ñ que hace
-- slugify() en functions/index.js y src/utils/slug.js.
create extension if not exists "unaccent";

-- ============================================================================
-- create_business_self_service: alta atómica del negocio + billing + admin
-- ============================================================================
-- Traducción de la parte de escritura de exports.createBusinessSelfService
-- en functions/index.js (la asignación del claim de dueño queda en la Edge
-- Function, porque eso es una operación de Auth, no de la base). El slug
-- único sale acá adentro con el mismo criterio: hasta 200 intentos
-- agregando un sufijo numérico, nunca elegido por quien llama.
create or replace function create_business_self_service(
  p_name text,
  p_profession_category text,
  p_custom_profession text,
  p_primary_color text,
  p_plan_id text,
  p_monthly_fee numeric,
  p_whatsapp_quota integer,
  p_trial_ends_at date,
  p_owner_email text,
  p_owner_name text
) returns businesses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  slug_final text;
  intento int := 1;
  reservados text[] := array['login','admin','super-admin','confirmacion','mis-citas','cuenta','onboarding'];
  nuevo businesses;
begin
  base_slug := trim(both '-' from regexp_replace(lower(unaccent(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'));
  base_slug := left(nullif(base_slug, ''), 50);
  if base_slug is null then base_slug := 'negocio'; end if;

  slug_final := base_slug;
  while intento < 200 loop
    if not (slug_final = any(reservados)) and not exists (select 1 from businesses where slug = slug_final) then
      exit;
    end if;
    intento := intento + 1;
    slug_final := base_slug || '-' || intento;
  end loop;
  if intento >= 200 then
    raise exception 'resource-exhausted: No se pudo generar un link único. Probá con otro nombre.';
  end if;

  insert into businesses (
    name, slug, profession_category, custom_profession, primary_color,
    business_hours, plan_id, whatsapp_quota, trial_ends_at, is_frozen, signup_source
  ) values (
    p_name, slug_final, p_profession_category, nullif(p_custom_profession, ''), p_primary_color,
    -- Mismo horario por defecto que HORARIO_POR_DEFECTO en functions/index.js
    -- y DEFAULT_BUSINESS_HOURS en src/config/plans.js: sin esto un negocio
    -- recién creado aparece "cerrado" todos los días.
    '[
      {"dayOfWeek":0,"startTime":"09:00","endTime":"20:00","isActive":true},
      {"dayOfWeek":1,"startTime":"09:00","endTime":"20:00","isActive":true},
      {"dayOfWeek":2,"startTime":"09:00","endTime":"20:00","isActive":true},
      {"dayOfWeek":3,"startTime":"09:00","endTime":"20:00","isActive":true},
      {"dayOfWeek":4,"startTime":"09:00","endTime":"20:00","isActive":true},
      {"dayOfWeek":5,"startTime":"09:00","endTime":"18:00","isActive":true},
      {"dayOfWeek":6,"startTime":"","endTime":"","isActive":false}
    ]'::jsonb,
    p_plan_id, p_whatsapp_quota, p_trial_ends_at, false, 'self_service'
  ) returning * into nuevo;

  insert into billing (business_id, debt, monthly_fee, next_billing_date)
    values (nuevo.id, 0, p_monthly_fee, p_trial_ends_at);

  insert into admins (business_id, email, name, role)
    values (nuevo.id, lower(trim(p_owner_email)), p_owner_name, 'owner');

  return nuevo;
end;
$$;

revoke all on function create_business_self_service(text, text, text, text, text, numeric, integer, date, text, text) from public, anon;
grant execute on function create_business_self_service(text, text, text, text, text, numeric, integer, date, text, text) to authenticated, service_role;

-- ============================================================================
-- delete_business_cascade: borra todo lo que cuelga de un negocio en la base
-- ============================================================================
-- A diferencia de Firestore, acá casi todo el trabajo ya lo hacen los
-- `ON DELETE CASCADE` del esquema (professionals, services, schedules,
-- appointments, notifications, admins, pending_admins, tickets,
-- ticket_messages, promotions, push_subscriptions, billing, staff_contacts
-- — todos referencian businesses(id) con CASCADE). Lo único que un DELETE
-- de SQL no puede tocar es Auth: los custom claims de los usuarios de este
-- negocio viven en auth.users, no en una tabla con FK — eso lo limpia la
-- Edge Function ANTES de llamar a esto (recorriendo auth.users con la Admin
-- API, igual que el listUsers() paginado de Firebase).
create or replace function delete_business_cascade(p_business_id uuid) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from businesses where id = p_business_id;
$$;

revoke all on function delete_business_cascade(uuid) from public, anon;
grant execute on function delete_business_cascade(uuid) to service_role;
