-- ============================================================================
-- Plan gratis: cuentas sin cargo que elige la plataforma
-- ============================================================================
-- `businesses.plan_gratis`: el negocio tiene su plan (Básico/Pro/Business o
-- personalizado, con todo lo que ese plan incluye) pero no se le cobra.
-- process_billing lo saltea entero: no suma deuda, no lo congela y nunca lo
-- borra (el borrado automático es solo para altas self-service que no
-- pagaron). Lo da y lo saca solo el dueño de la plataforma, con
-- cambiar_plan() — el mismo camino que cualquier cambio de plan.
--
-- Va en `businesses` (lectura pública) y no en `billing` porque el panel del
-- dueño lo necesita para no mostrarle los avisos de prueba/pago; no es un
-- dato sensible (la plata, el abono y la deuda siguen en `billing`).

alter table businesses add column if not exists plan_gratis boolean not null default false;

-- El dueño del negocio no se lo puede poner solo (mismo trigger que protege
-- plan, prueba y congelamiento).
create or replace function protect_business_columns() returns trigger
language plpgsql as $$
begin
  if auth_is_platform() then
    return new;
  end if;
  if new.is_frozen is distinct from old.is_frozen
    or new.plan_id is distinct from old.plan_id
    or new.whatsapp_quota is distinct from old.whatsapp_quota
    or new.slug is distinct from old.slug
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.created_at is distinct from old.created_at
    or new.signup_source is distinct from old.signup_source
    or new.frozen_at is distinct from old.frozen_at
    or new.plan_gratis is distinct from old.plan_gratis
  then
    raise exception 'Solo la plataforma puede modificar esos campos.';
  end if;
  return new;
end;
$$;

-- El cobro diario, igual que antes salvo que saltea los de plan gratis.
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
    select b.id, b.name, b.trial_ends_at, b.is_frozen, b.frozen_at, b.signup_source, b.plan_gratis,
           coalesce(bi.debt, 0) as debt, bi.monthly_fee, bi.next_billing_date, bi.last_payment_date
    from businesses b
    left join billing bi on bi.business_id = b.id
  loop
    -- Plan gratis (lo da la plataforma a quien elige): nunca se cobra, nunca
    -- se congela por deuda y nunca entra en el borrado automático.
    if fila.plan_gratis then
      continue;
    end if;

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

-- ── Cambiar de plan (y darlo o sacarlo gratis) en un solo paso ────────────
-- Reemplaza los dos updates sueltos que hacía el panel (businesses y
-- billing por separado): acá va todo junto, en una transacción.
--   Gratis → plan y cuota del plan elegido, abono 0, deuda perdonada,
--            sin prueba pendiente y descongelado.
--   Pago   → plan, cuota y abono; si venía de gratis, el primer cobro es
--            dentro de un mes (no se le cobra retroactivo lo que fue gratis).
create or replace function cambiar_plan(
  p_business_id uuid,
  p_plan_id text,
  p_whatsapp_quota integer,
  p_monthly_fee numeric,
  p_gratis boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  era_gratis boolean;
begin
  if not auth_is_platform() then
    raise exception 'failed-precondition: Solo el dueño de la plataforma puede cambiar planes.';
  end if;
  select plan_gratis into era_gratis from businesses where id = p_business_id;
  if not found then
    raise exception 'not-found: Ese negocio no existe.';
  end if;

  if p_gratis then
    update businesses
      set plan_id = p_plan_id, whatsapp_quota = p_whatsapp_quota, plan_gratis = true,
          trial_ends_at = null, is_frozen = false, frozen_at = null
      where id = p_business_id;
    insert into billing (business_id, debt, monthly_fee, next_billing_date)
      values (p_business_id, 0, 0, null)
      on conflict (business_id) do update set debt = 0, monthly_fee = 0, next_billing_date = null;
  else
    update businesses
      set plan_id = p_plan_id, whatsapp_quota = p_whatsapp_quota, plan_gratis = false
      where id = p_business_id;
    insert into billing (business_id, debt, monthly_fee, next_billing_date)
      values (p_business_id, 0, coalesce(p_monthly_fee, 0),
              case when era_gratis then (hoy + interval '1 month')::date end)
      on conflict (business_id) do update set
        monthly_fee = excluded.monthly_fee,
        next_billing_date = case when era_gratis then excluded.next_billing_date else billing.next_billing_date end;
  end if;
end;
$$;
revoke all on function cambiar_plan(uuid, text, integer, numeric, boolean) from public, anon;
grant execute on function cambiar_plan(uuid, text, integer, numeric, boolean) to authenticated;
