-- ============================================================================
-- Habilitar una cuenta: que quede andando de verdad
-- ============================================================================
-- El botón "Habilitar" del panel global solo ponía is_frozen = false. Con
-- deuda o un vencimiento atrasado, el cobro de esa misma noche la volvía a
-- suspender; el dueño seguía viendo "Se terminó tu prueba"; y un alta
-- self-service que nunca registró un pago, al volver a quedar suspendida 7
-- días, entraba en el borrado automático.
--
-- habilitar_cuenta() (solo el dueño de la plataforma):
--   * la descongela y le termina la prueba (queda como cuenta activa, con
--     todo lo de su plan);
--   * el próximo cobro pasa a ser dentro de un mes (no se le suma de nuevo
--     lo atrasado esta noche);
--   * hasta ese vencimiento no se la vuelve a suspender aunque tenga deuda
--     (billing.habilitada_hasta). La deuda queda anotada: si al vencimiento
--     sigue debiendo, se suspende como cualquier otra;
--   * nunca más entra en el borrado automático (billing.habilitada_el).

alter table billing
  add column if not exists habilitada_hasta date,
  add column if not exists habilitada_el date;

create or replace function habilitar_cuenta(p_business_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  proximo date := ((now() at time zone 'America/Argentina/Buenos_Aires')::date + interval '1 month')::date;
begin
  if not auth_is_platform() then
    raise exception 'failed-precondition: Solo el dueño de la plataforma puede habilitar cuentas.';
  end if;
  update businesses set is_frozen = false, frozen_at = null, trial_ends_at = null where id = p_business_id;
  if not found then
    raise exception 'not-found: Ese negocio no existe.';
  end if;
  insert into billing (business_id, debt, next_billing_date, habilitada_hasta, habilitada_el)
    values (p_business_id, 0, proximo, proximo, hoy)
    on conflict (business_id) do update set
      next_billing_date = greatest(coalesce(billing.next_billing_date, proximo), proximo),
      habilitada_hasta = proximo,
      habilitada_el = hoy;
end;
$$;
revoke all on function habilitar_cuenta(uuid) from public, anon;
grant execute on function habilitar_cuenta(uuid) to authenticated;

-- Suspender a mano corta el período de gracia de un "habilitar" anterior.
create or replace function suspender_cuenta(p_business_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not auth_is_platform() then
    raise exception 'failed-precondition: Solo el dueño de la plataforma puede suspender cuentas.';
  end if;
  update businesses
    set is_frozen = true,
        frozen_at = coalesce(frozen_at, (now() at time zone 'America/Argentina/Buenos_Aires')::date)
    where id = p_business_id;
  if not found then
    raise exception 'not-found: Ese negocio no existe.';
  end if;
  update billing set habilitada_hasta = null where business_id = p_business_id;
end;
$$;
revoke all on function suspender_cuenta(uuid) from public, anon;
grant execute on function suspender_cuenta(uuid) to authenticated;

-- El cobro diario, igual que antes salvo la gracia de "habilitar" y la
-- exclusión del borrado automático.
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
           coalesce(bi.debt, 0) as debt, bi.monthly_fee, bi.next_billing_date, bi.last_payment_date,
           bi.habilitada_hasta, bi.habilitada_el
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

    -- Habilitada a mano por la plataforma: no se suspende hasta el próximo
    -- vencimiento aunque tenga deuda (si para entonces sigue debiendo, sí).
    deberia_congelar := nueva_deuda > 0
      and not (fila.habilitada_hasta is not null and hoy <= fila.habilitada_hasta);
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
       -- Una cuenta que la plataforma habilitó a mano alguna vez no es "un
       -- alta que nunca pagó": hay una relación comercial, no se borra sola.
       and fila.habilitada_el is null
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
