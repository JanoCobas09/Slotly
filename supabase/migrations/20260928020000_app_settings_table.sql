-- ============================================================================
-- app_settings: config de infraestructura para los triggers (no para la app)
-- ============================================================================
-- handle_nuevo_turno/handle_turno_cancelado necesitan saber a qué URL de
-- Edge Functions pegarle y con qué service role key — eso varía por entorno
-- (local vs. el proyecto real) y NO se puede fijar con `alter database ...
-- set app.algo`: el rol `postgres` de Supabase (incluso local) no es
-- superusuario de verdad y esa sentencia da "permission denied". Una tabla
-- común sí funciona. Sin RLS habilitada a propósito: nadie except las
-- funciones SECURITY DEFINER que la leen (ningún camino del cliente pasa
-- por acá) — igual no se expone ninguna policy de SELECT/INSERT/UPDATE
-- para authenticated/anon, así que ni siquiera con RLS desactivada hay una
-- vía de lectura desde el browser (no hay endpoint de PostgREST expuesto a
-- esta tabla salvo que alguien la agregue a propósito).
create table app_settings (
  key text primary key,
  value text not null
);

revoke all on app_settings from public, anon, authenticated;
grant select on app_settings to service_role;

-- Valores para ESTE stack local (Kong es el gateway interno, alcanzable
-- desde el contenedor de Postgres por el nombre del servicio en la red de
-- Docker que arma `supabase start`). La service role key de acá es la fija
-- que imprime `supabase start` en cualquier proyecto local — no es un
-- secreto real, ver el comentario de supabase/tests/test-claims.mjs.
--
-- Para producción (Fase 8): reemplazar las dos filas por la URL del
-- proyecto real y su service role key de verdad —
--   update app_settings set value = 'https://<project-ref>.supabase.co/functions/v1' where key = 'edge_functions_url';
--   update app_settings set value = '<service role key real>' where key = 'service_role_key';
-- nunca versionar la key real en una migración.
--
-- OJO — esto costó un día entero de cron/triggers fallando en silencio
-- (401 en todas las llamadas, cero mails de recordatorio, cero push) hasta
-- encontrarlo: un proyecto de Supabase nuevo (creado después de que
-- lanzaron el sistema de API keys nuevo) tiene DOS claves de service_role
-- distintas. El dashboard/`api-keys` de siempre muestra la "legacy"
-- (el JWT `eyJhbGci...`, rol service_role) — esa sigue funcionando para
-- PostgREST (`supabaseAdmin()`, cualquier `.from(tabla)` con la service
-- role key), pero `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` DENTRO de
-- una Edge Function ya NO es esa: es la nueva, con forma
-- `sb_secret_xxxxxxxxxxxxxxxxxxxxxxxx`. Cualquier Edge Function que
-- compare el Bearer contra esa variable de entorno (send-push,
-- run-billing, send-reminders — todas las "solo el propio proyecto")
-- rechaza silenciosamente el JWT legacy con 401, aunque sea una key
-- genuina y válida del mismo proyecto.
--
-- Para conseguir la key correcta: Management API, GET
-- /v1/projects/<ref>/api-keys?reveal=true — el objeto con "type": "secret"
-- (no el "type": "legacy" con "id": "service_role"). Verificar SIEMPRE
-- llamando a una función real con la key antes de darla por buena; el
-- síntoma (401 "Esto solo lo puede llamar el propio proyecto") es idéntico
-- al de una key mal copiada, así que no alcanza con revisar que el string
-- esté bien pegado.
insert into app_settings (key, value) values
  ('edge_functions_url', 'http://kong:8000/functions/v1'),
  ('service_role_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU')
on conflict (key) do nothing;
