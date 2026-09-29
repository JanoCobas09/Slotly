-- ============================================================================
-- Avisos de la plataforma a los dueños
-- ============================================================================
-- El dueño de la plataforma escribe un aviso (título + mensaje) desde el
-- panel global y le aparece a TODOS los dueños de negocio como un cartel que
-- no se va hasta que tocan "Aceptar". Cada aceptación queda registrada por
-- cuenta, así el panel global ve quién ya lo leyó.
--
-- Un aviso "activo" se le muestra también al dueño que se da de alta después
-- de mandarlo; para dejar de mostrarlo se archiva (activo = false), no se
-- borra: así se conserva quién lo aceptó.
--
-- Solo el rol 'owner' (no el staff, no el administrador de sucursal, no el
-- cliente) los ve y los acepta.

create table if not exists avisos_plataforma (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  mensaje text not null,
  activo boolean not null default true,
  creado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint avisos_plataforma_titulo_valido check (char_length(btrim(titulo)) between 1 and 120),
  constraint avisos_plataforma_mensaje_valido check (char_length(btrim(mensaje)) between 1 and 2000)
);

-- `id` propio (y no la clave compuesta) porque la suscripción en vivo del
-- panel global identifica cada fila por una sola columna.
create table if not exists avisos_aceptados (
  id uuid primary key default gen_random_uuid(),
  aviso_id uuid not null references avisos_plataforma(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  business_id uuid references businesses(id) on delete cascade default auth_business_id(),
  aceptado_el timestamptz not null default now(),
  unique (aviso_id, user_id)
);

create index if not exists avisos_aceptados_user_idx on avisos_aceptados (user_id);

alter table avisos_plataforma enable row level security;
alter table avisos_aceptados enable row level security;

-- Escribir: solo el dueño de la plataforma (no los moderadores).
create policy avisos_plataforma_escribir on avisos_plataforma
  for all using (auth_is_platform()) with check (auth_is_platform());

-- Leer: la plataforma, y cualquier dueño de negocio. Los dueños leen también
-- los archivados (el cartel filtra por `activo`): si RLS los escondiera, al
-- archivar uno Realtime no le avisaría al panel abierto y el cartel quedaría
-- colgado hasta recargar. Un aviso no tiene nada privado.
create policy avisos_plataforma_leer on avisos_plataforma
  for select using (auth_is_platform_team() or auth_role() = 'owner');

-- Aceptar: el dueño anota SU aceptación, con su negocio (no uno ajeno).
create policy avisos_aceptados_insertar on avisos_aceptados
  for insert with check (
    user_id = auth.uid()
    and auth_role() = 'owner'
    and business_id is not distinct from auth_business_id()
  );

-- Cada uno ve las suyas; la plataforma ve todas (para contar quién leyó).
-- Necesaria también para el upsert con ignoreDuplicates del dueño.
create policy avisos_aceptados_leer on avisos_aceptados
  for select using (user_id = auth.uid() or auth_is_platform_team());

alter publication supabase_realtime add table avisos_plataforma, avisos_aceptados;
