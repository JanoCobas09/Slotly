-- ============================================================================
-- Publicaciones programadas del Instagram de Slotly (@slotly.turnos)
-- ============================================================================
-- No tiene nada que ver con los negocios: es el marketing de la propia
-- plataforma. Una cola de publicaciones con fecha y hora; el cron
-- `publicar-instagram` llama cada 15 minutos a la Edge Function del mismo
-- nombre, que publica las que ya tocan con la API oficial de Instagram
-- (Instagram Login, graph.instagram.com) y renueva el token antes de que
-- venza (dura 60 días).
--
-- Solo la service role toca estas tablas: ni dueños ni clientes las ven.
-- La cola se carga desde la compu con `video/scripts/instagram-cola.mjs`.

-- ─── Cuenta (una sola fila) ─────────────────────────────────────────────────
create table if not exists ig_cuenta (
  id smallint primary key default 1 check (id = 1),
  ig_user_id text not null,
  usuario text,
  token text not null,
  token_vence_at timestamptz not null,
  actualizado_at timestamptz not null default now()
);
alter table ig_cuenta enable row level security;
revoke all on ig_cuenta from public, anon, authenticated;
grant select, insert, update, delete on ig_cuenta to service_role;

-- ─── Cola de publicaciones ──────────────────────────────────────────────────
-- medios: rutas dentro del bucket `instagram` (JPEG o MP4), en orden. Un post
-- o una historia llevan una; un carrusel, de 2 a 10; un reel, el video.
-- clave: identificador estable que pone el script al cargar, para poder
-- volver a correrlo sin duplicar (y corregir texto/hora de lo pendiente).
create table if not exists ig_publicaciones (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  publicar_at timestamptz not null,
  tipo text not null check (tipo in ('post', 'carrusel', 'historia', 'reel')),
  medios text[] not null check (cardinality(medios) between 1 and 10),
  texto text not null default '' check (char_length(texto) <= 2200),
  -- Portada del reel (ruta en el bucket), opcional.
  portada text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesando', 'publicada', 'error')),
  -- Contenedor de Instagram mientras procesa un video (estado 'procesando').
  contenedor_id text,
  -- Cuándo una corrida de la función la tomó (para que otra no la repita;
  -- si quedó tomada sin contenedor más de 10 minutos, la corrida se cayó).
  tomada_at timestamptz,
  ig_media_id text,
  permalink text,
  intentos smallint not null default 0,
  error text,
  creado_at timestamptz not null default now(),
  publicada_at timestamptz
);
create index if not exists ig_publicaciones_pendientes_idx
  on ig_publicaciones (publicar_at) where estado in ('pendiente', 'procesando');
alter table ig_publicaciones enable row level security;
revoke all on ig_publicaciones from public, anon, authenticated;
grant select, insert, update, delete on ig_publicaciones to service_role;

-- ─── Bucket público ─────────────────────────────────────────────────────────
-- Instagram baja la imagen o el video de una URL pública al publicar, así que
-- el bucket tiene que ser público. Solo hay material de marketing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('instagram', 'instagram', true, 52428800, array['image/jpeg', 'video/mp4'])
on conflict (id) do nothing;

-- ─── Cron ───────────────────────────────────────────────────────────────────
-- Cada 15 minutos, solo si hay algo que publicar o un video procesando (para
-- no despertar la función de balde). Una vez por día la llama igual, para
-- renovar el token aunque la cola esté vacía.
create or replace function pedir_publicacion_instagram(forzar boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  base_url text;
  service_key text;
begin
  if not forzar and not exists (
    select 1 from ig_publicaciones
    where estado in ('pendiente', 'procesando') and publicar_at <= now()
  ) then
    return;
  end if;
  select value into base_url from app_settings where key = 'edge_functions_url';
  select value into service_key from app_settings where key = 'service_role_key';
  if base_url is null or service_key is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/publicar-instagram',
    headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function pedir_publicacion_instagram(boolean) from public, anon, authenticated;

select cron.schedule('publicar-instagram', '*/15 * * * *', $$select pedir_publicacion_instagram()$$);
-- 11:40 UTC = 08:40 en Argentina.
select cron.schedule('instagram-token', '40 11 * * *', $$select pedir_publicacion_instagram(true)$$);
