-- ============================================================================
-- Días bloqueados: días puntuales en que el negocio no atiende
-- ============================================================================
-- Feriados, vacaciones, un día de trámites. El dueño los marca en un
-- calendario desde el panel y ese día no se puede reservar online, aunque
-- el horario semanal diga que se trabaja.
--
-- Es del negocio entero (no por profesional): una fila por día.
create table if not exists public.blocked_days (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (business_id, date)
);

create index if not exists blocked_days_business_idx on public.blocked_days (business_id, date);

alter table public.blocked_days enable row level security;

-- Lectura pública, igual que schedules: el calendario de la reserva tiene
-- que saber qué días no ofrecer antes de que el cliente se loguee. No tiene
-- nada personal.
create policy blocked_days_select on public.blocked_days
  for select using (true);

-- Solo el dueño (o la plataforma) marca y desmarca días.
create policy blocked_days_write on public.blocked_days
  using (public.can_manage(business_id))
  with check (public.can_manage(business_id));

-- En vivo, como el resto de las tablas del negocio (BusinessSync).
alter publication supabase_realtime add table public.blocked_days;

-- Permisos base: la migración de grants ya dejó ALTER DEFAULT PRIVILEGES,
-- pero se repite explícito para no depender de con qué rol corre esto.
grant select, insert, update, delete on public.blocked_days to anon, authenticated, service_role;

-- ── Hacerlo cumplir en el servidor ──────────────────────────────────────────
-- Mismo criterio que enforce_max_advance_days: trigger aparte, sin tocar
-- create_appointment(), y solo para turnos del CLIENTE. El dueño puede
-- igual cargar a mano un turno en un día bloqueado (el panel le avisa).
create or replace function enforce_blocked_days() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.type, 'client') <> 'client' then
    return new;
  end if;

  if exists (
    select 1 from blocked_days
    where business_id = new.business_id and date = new.appointment_date
  ) then
    raise exception 'failed-precondition: El negocio no atiende el %. Elegí otro día.',
      to_char(new.appointment_date, 'DD/MM');
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_enforce_blocked_days on appointments;
create trigger appointments_enforce_blocked_days
  before insert on appointments
  for each row execute function enforce_blocked_days();
