-- ============================================================================
-- app_settings: cerrar el acceso público
-- ============================================================================
-- 20260928020000_app_settings_table.sql le sacaba todo a anon/authenticated,
-- pero al día siguiente 20260929000000_grant_base_table_privileges.sql dio
-- select/insert/update/delete sobre TODAS las tablas de public a anon y
-- authenticated, contando con que cada tabla tiene RLS. app_settings era la
-- única sin RLS: con la anon key (que está en el bundle publicado) se podía
-- leer la service role key y cambiar edge_functions_url (adonde los crons
-- mandan esa clave).
--
-- Nadie más que el servidor la necesita: la leen funciones SQL security
-- definer (corren como el dueño de la tabla, que no pasa por RLS) y la
-- service role (bypassrls). Se activa RLS sin policies y se sacan los
-- permisos, las dos cosas, para que un GRANT en bloque futuro no la reabra.
alter table app_settings enable row level security;
revoke all on app_settings from public, anon, authenticated;
grant select on app_settings to service_role;
