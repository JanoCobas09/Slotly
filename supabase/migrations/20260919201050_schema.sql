-- ============================================================================
-- Slotly — esquema inicial (migración de Firestore a Postgres)
-- ============================================================================
-- Mapea 1:1 las colecciones de Firestore documentadas en CLAUDE.md a tablas
-- relacionadas. Diferencias a propósito respecto del modelo de Firestore:
--
--   - `/slugs/{slug}` desaparece como colección aparte: acá un slug es
--     simplemente una columna UNIQUE en `businesses`. En Firestore existía
--     solo porque resolver /mi-negocio sin eso obligaba a permitir listar
--     toda la colección `businesses` (agujero de seguridad). Postgres no
--     tiene esa limitación: `select id from businesses where slug = $1` no
--     expone nada que la RLS no autorice ya.
--   - Los custom claims (businessId/role/professionalId/platform) NO son una
--     tabla: viven en `auth.users.raw_app_meta_data` (JWT), exactamente el
--     mismo rol que cumplían en Firebase Auth. Ver funciones auth_* en la
--     migración de RLS.
--   - `notifications.leidaPor` (mapa uid->bool en Firestore) pasa a ser una
--     tabla de unión `notification_reads`, más natural en relacional.
--
-- Extensión necesaria para gen_random_uuid().
create extension if not exists "pgcrypto";

-- ============================================================================
-- BUSINESSES — documento público (CLAUDE.md: "⚠️ pública")
-- ============================================================================
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,

  -- Rubro (ver src/config/professionPresets.js — la categoría vive en el
  -- cliente, acá solo se persiste lo que el negocio eligió/escribió).
  profession_category text,
  custom_profession text,

  -- Tema white-label. NULL = hereda el preset de su categoría en el cliente.
  primary_color text,
  secondary_color text,
  accent_color text,

  -- Horarios y configuración operativa.
  business_hours jsonb not null default '[]'::jsonb,
  welcome_message text,
  min_cancel_hours integer not null default 2,
  slot_interval integer not null default 30,
  online_booking_enabled boolean not null default true,

  -- Comercial / facturación pública (isFrozen tiene que ser público: la
  -- página de reservas y las políticas de RLS lo necesitan para bloquear
  -- el link sin exponer la deuda real, que vive aparte en `billing`).
  plan_id text not null default 'basico',
  whatsapp_quota integer not null default 100,
  is_frozen boolean not null default false,
  frozen_at date,
  trial_ends_at date,
  -- 'self_service' | null (alta manual). Ver el borrado automático de
  -- pruebas vencidas en la migración de funciones/cron.
  signup_source text,

  created_at timestamptz not null default now()
);
create index businesses_slug_idx on businesses (slug);

comment on column businesses.is_frozen is 'Público a propósito: Rules/RLS y la página de reservas lo necesitan antes del login.';
comment on column businesses.signup_source is 'self_service = vino del alta pública con prueba gratis. Solo esas se borran automáticamente si nunca pagaron.';

-- ============================================================================
-- BILLING — privado, solo plataforma (CLAUDE.md: "🔒 solo plataforma")
-- ============================================================================
create table billing (
  business_id uuid primary key references businesses(id) on delete cascade,
  debt numeric not null default 0,
  monthly_fee numeric not null default 0,
  next_billing_date date,
  last_payment_date date
);

comment on table billing is 'Aparte de businesses a propósito: la deuda no puede ser de lectura pública.';

-- ============================================================================
-- PROFESSIONALS — público (staff, sin datos de contacto)
-- ============================================================================
create table professionals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  role_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index professionals_business_idx on professionals (business_id);

-- Privado: teléfono/mail del staff NO van en `professionals` (que es de
-- lectura pública para armar la grilla de reserva).
create table staff_contacts (
  professional_id uuid primary key references professionals(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  phone text,
  email text
);

-- ============================================================================
-- SERVICES — público
-- ============================================================================
create table services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  duration_minutes integer not null,
  price numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index services_business_idx on services (business_id);

create table professional_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  unique (professional_id, service_id)
);
create index professional_services_business_idx on professional_services (business_id);

-- ============================================================================
-- SCHEDULES — horario semanal por profesional, público
-- ============================================================================
create table schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6), -- 0=Lunes … 6=Domingo
  start_time text,
  end_time text,
  is_active boolean not null default true
);
create index schedules_business_idx on schedules (business_id);
create index schedules_professional_idx on schedules (professional_id);

-- ============================================================================
-- APPOINTMENTS — privado (staff + dueño del turno)
-- ============================================================================
create table appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  professional_id uuid not null references professionals(id),
  service_id uuid references services(id),
  -- NULL en walk-in/manual: no hay cliente logueado detrás.
  user_id uuid references auth.users(id),

  appointment_date date not null,
  start_time text not null,
  end_time text,
  price numeric,
  duration_minutes integer,
  service_name text,

  client_name text,
  client_phone text,
  client_email text,
  notes text,

  status text not null default 'pendiente'
    check (status in ('pendiente', 'confirmada', 'completada', 'cancelada', 'no_asistio')),
  -- 'client' (reserva pública) | 'walkin' | 'manual' (cargado por el staff)
  type text not null default 'client',
  -- Los tres solo se completan cuando status pasa a 'cancelada'.
  cancelled_by text, -- 'client' | 'staff'
  cancelled_at timestamptz,
  cancellation_reason text,

  created_at timestamptz not null default now()
);
create index appointments_business_idx on appointments (business_id);
create index appointments_business_date_idx on appointments (business_id, appointment_date);
create index appointments_professional_date_idx on appointments (professional_id, appointment_date);
create index appointments_user_idx on appointments (user_id);

-- ============================================================================
-- NOTIFICATIONS — privado (dueño ve todas, staff asignado ve las suyas)
-- ============================================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null, -- 'nuevo_turno' | 'turno_cancelado'
  title text not null,
  body text not null,
  professional_id uuid references professionals(id),
  appointment_id uuid references appointments(id),
  appointment_date date,
  created_at timestamptz not null default now()
);
create index notifications_business_idx on notifications (business_id);

-- Reemplaza el mapa `leidaPor: { uid: true }` de Firestore.
create table notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ============================================================================
-- PUSH SUBSCRIPTIONS — Web Push (VAPID), reemplaza los tokens de FCM
-- ============================================================================
create table push_subscriptions (
  endpoint text primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null,
  professional_id uuid references professionals(id),
  p256dh text not null,
  auth_key text not null,
  updated_at timestamptz not null default now()
);
create index push_subscriptions_business_idx on push_subscriptions (business_id);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

comment on table push_subscriptions is 'endpoint como PK: mismo criterio que pushTokens de Firestore (doc id = el token), dedup natural por dispositivo.';

-- ============================================================================
-- ADMINS — registro para UI, NO otorga permiso (el permiso real es el JWT)
-- ============================================================================
create table admins (
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  name text,
  role text not null check (role in ('owner', 'admin')),
  professional_id uuid references professionals(id),
  added_at timestamptz not null default now(),
  primary key (business_id, email)
);

-- ============================================================================
-- PENDING ADMINS — claims de quien no entró todavía
-- ============================================================================
-- Dos formas, nunca mezcladas (mismo criterio que pendingAdmins en
-- Firestore): permiso de negocio (business_id + role) o moderador de
-- plataforma (platform = 'moderator', el resto vacío).
create table pending_admins (
  email text primary key,
  business_id uuid references businesses(id) on delete cascade,
  role text check (role in ('owner', 'admin')),
  professional_id uuid references professionals(id),
  platform text check (platform = 'moderator'),
  check (
    (platform = 'moderator' and business_id is null and role is null)
    or (platform is null and business_id is not null and role is not null)
  )
);

-- ============================================================================
-- TICKETS — soporte (negocio ↔ plataforma)
-- ============================================================================
create table tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  subject text,
  status text not null default 'abierto' check (status in ('abierto', 'cerrado')),
  created_at timestamptz not null default now()
);
create index tickets_business_idx on tickets (business_id);

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  sender_email text,
  sender_role text,
  body text not null,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on ticket_messages (ticket_id);

-- ============================================================================
-- PLATAFORMA
-- ============================================================================
create table platform_config (
  id boolean primary key default true check (id), -- fila única
  data jsonb not null default '{}'::jsonb
);

-- Moderadores. El dueño de la plataforma NO vive acá — es el claim
-- `platform: true` en el JWT, fijado a mano en Supabase (ver seed/README).
create table platform_team (
  email text primary key,
  added_at timestamptz not null default now()
);
