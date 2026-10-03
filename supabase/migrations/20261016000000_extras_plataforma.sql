-- ============================================================================
-- Extras que da la plataforma, sin cambiar el plan
-- ============================================================================
-- `businesses.extra_sucursales` / `extra_profesionales`: lugares de más que el
-- dueño de la plataforma le suma a un negocio por fuera de su plan (ej.: un
-- Básico con una segunda sucursal). Se SUMAN al tope del plan: Básico (1) + 1
-- extra = 2 sucursales activas. No es una sucursal puntual sino un lugar: el
-- dueño la puede editar, desactivar, borrar y volver a crear mientras no pase
-- el tope. Con un plan sin límite (Business, personalizado) no cambian nada.
--
-- Si después se le cambia el plan, los extras quedan y se suman al nuevo tope;
-- se sacan poniéndolos en 0. Igual que al bajar de plan, sacar un extra no
-- borra ni desactiva nada: lo que ya está activo queda, solo no puede sumar.
--
-- Profesionales: el tope vive solo en la interfaz (ProfessionalsPage), como
-- siempre; el extra se suma ahí. Sucursales: la base lo hace cumplir
-- (enforce_limite_sucursales, redefinida abajo).

alter table businesses add column if not exists extra_sucursales integer not null default 0;
alter table businesses add column if not exists extra_profesionales integer not null default 0;

alter table businesses drop constraint if exists businesses_extras_validos;
alter table businesses add constraint businesses_extras_validos
  check (extra_sucursales between 0 and 50 and extra_profesionales between 0 and 50);

-- Solo la plataforma los toca (mismo trigger que protege plan y plan gratis).
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
    or new.extra_sucursales is distinct from old.extra_sucursales
    or new.extra_profesionales is distinct from old.extra_profesionales
  then
    raise exception 'Solo la plataforma puede modificar esos campos.';
  end if;
  return new;
end;
$$;

-- Tope de sucursales = el del plan + los extras (null = sin límite).
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

  select limite_sucursales(plan_id) + extra_sucursales into tope
  from businesses where id = new.business_id;
  if tope is null then
    return new;
  end if;

  select count(*) into activas from branches
  where business_id = new.business_id and is_active and id <> new.id;
  if activas >= tope then
    raise exception 'failed-precondition: Tu cuenta permite hasta % %. Para sumar más, pasate a un plan superior.',
      tope, case when tope = 1 then 'sucursal' else 'sucursales' end;
  end if;
  return new;
end;
$$;
