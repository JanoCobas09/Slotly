-- ============================================================================
-- Tope de sucursales por plan
-- ============================================================================
-- Básico: 1 (la principal). Pro: 3. Business: sin límite. Mismo número que
-- `maxBranches` en src/config/plans.js — si cambia allá, cambia acá.
--
-- Se cuentan las sucursales ACTIVAS. Frena crear una nueva o reactivar una
-- desactivada por encima del tope; lo que ya existe no se toca: un negocio
-- que baja de plan conserva sus sucursales, solo no puede sumar más.
-- La plataforma (y el servidor) no tienen tope: arman cuentas a mano.
create or replace function limite_sucursales(p_plan_id text) returns integer
language sql immutable as $$
  select case p_plan_id when 'basico' then 1 when 'pro' then 3 else null end
$$;

create or replace function enforce_limite_sucursales() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tope integer;
  activas integer;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') or auth_is_platform() then
    return new;
  end if;
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active then
    return new; -- ya estaba activa: editar sus datos no suma nada
  end if;

  select limite_sucursales(plan_id) into tope from businesses where id = new.business_id;
  if tope is null then
    return new;
  end if;

  select count(*) into activas from branches
  where business_id = new.business_id and is_active and id <> new.id;
  if activas >= tope then
    raise exception 'failed-precondition: Tu plan permite hasta % %. Para sumar más, pasate a un plan superior.',
      tope, case when tope = 1 then 'sucursal' else 'sucursales' end;
  end if;
  return new;
end;
$$;

drop trigger if exists branches_limite_plan on branches;
create trigger branches_limite_plan
  before insert or update of is_active on branches
  for each row execute function enforce_limite_sucursales();
