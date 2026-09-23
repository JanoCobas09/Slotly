-- ============================================================================
-- Correcciones al esquema recuperado (19/09), auditado campo por campo el
-- 23/09 contra lo que src/ usa de verdad hoy (no contra la documentación).
-- ============================================================================
-- La seguridad (funciones, policies, triggers de protección de columnas) ya
-- estaba completa y correcta. Lo que faltaba: varias columnas y la tabla
-- `promotions` entera. Este archivo cierra esa brecha.

-- ── businesses: contacto público y moneda ──────────────────────────────────
-- Ninguna de estas columnas está en la lista de protect_business_columns()
-- a propósito: son datos de marca/contacto que el dueño edita libremente,
-- no campos comerciales/de facturación.
alter table public.businesses
  add column currency text not null default 'ARS',
  add column logo_url text,
  add column maps_url text,
  add column phone text,
  add column email text,
  add column address text,
  add column social_links jsonb not null default '{}'::jsonb;

-- ── professionals: ficha pública ────────────────────────────────────────────
-- `role_label` no lo lee ningún archivo de src/ — el campo real es
-- `specialty`. Se renombra en vez de agregar uno nuevo para no dejar una
-- columna muerta.
alter table public.professionals
  rename column role_label to specialty;
alter table public.professionals
  add column bio text,
  add column avatar_url text;

-- ── services: catálogo ──────────────────────────────────────────────────────
alter table public.services
  add column description text,
  add column category text;

-- ── schedules: descanso opcional dentro de la jornada ───────────────────────
-- Nullable a propósito: availabilityEngine.js trata la ausencia de
-- breakStart/breakEnd como "sin descanso", no como un dato faltante.
alter table public.schedules
  add column break_start text,
  add column break_end text;

-- ── appointments: notas internas y control de recordatorios ────────────────
alter table public.appointments
  add column admin_notes text,
  add column reminder_sent_at timestamptz;

-- ── tickets: el estado 'respondido' no estaba permitido ─────────────────────
-- repository.js pone status='respondido' cuando la plataforma contesta
-- (addTicketMessage); con el CHECK original esa escritura fallaba siempre.
alter table public.tickets
  drop constraint tickets_status_check;
alter table public.tickets
  add constraint tickets_status_check
    check (status in ('abierto', 'respondido', 'cerrado'));

alter table public.tickets
  add column business_name text,
  add column category text,
  add column last_message_at timestamptz not null default now(),
  add column last_message_by text,
  add column unread_for_platform boolean not null default true,
  add column unread_for_business boolean not null default false;

create index tickets_last_message_idx on public.tickets (last_message_at desc);

-- ── ticket_messages: quién escribió, en texto ───────────────────────────────
alter table public.ticket_messages
  add column author_name text;

-- ── promotions: tabla entera faltante ───────────────────────────────────────
-- Descuentos por servicio + día de la semana + franja horaria. Lectura
-- pública (se muestra el badge "Promo" antes de loguearse) igual que
-- services/schedules; el precio real con descuento siempre lo recalcula el
-- servidor (createAppointment), nunca se confía en lo que mande el cliente.
create table public.promotions (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    service_id uuid not null references public.services(id) on delete cascade,
    day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
    start_time text not null,
    end_time text not null,
    discount_type text not null check (discount_type in ('fixed', 'percentage')),
    discount_value numeric not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create index promotions_business_idx on public.promotions (business_id);
create index promotions_service_idx on public.promotions (service_id);

alter table public.promotions enable row level security;

create policy promotions_select on public.promotions
  for select using (true);

create policy promotions_write on public.promotions
  using (public.can_manage(business_id))
  with check (public.can_manage(business_id));
