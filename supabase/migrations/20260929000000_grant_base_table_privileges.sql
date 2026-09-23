-- ============================================================================
-- Fix: anon/authenticated/service_role sin permiso base sobre las tablas
-- ============================================================================
-- Descubierto desplegando contra el proyecto real de Supabase (no aparece
-- en el stack local de `supabase start`, que viene configurado distinto):
-- las tablas que crea una migración corrida por el CLI son dueñas del rol
-- `postgres`, y el default ACL de ESE rol en `public` solo entrega
-- `DELETE, TRUNCATE, REFERENCES, TRIGGER` a anon/authenticated/service_role
-- — nada de SELECT/INSERT/UPDATE. El default ACL permisivo (SELECT/INSERT/
-- UPDATE/DELETE completo) existe, pero está reservado para tablas creadas
-- por `supabase_admin` (el que usa el dashboard), no por `postgres` (el que
-- usa el CLI). Sin esto, hasta `service_role` — que bypassea RLS por
-- rolbypassrls=true — se encontraba con "permission denied for table": el
-- bypass de RLS no sirve de nada si el permiso de base ni siquiera existe.
--
-- RLS sigue siendo la barrera real para anon/authenticated (ya probada a
-- fondo en local): este GRANT es el prerrequisito grueso que la habilita,
-- no un permiso nuevo de negocio. service_role la bypassea igual que
-- siempre — acá recién puede hacerlo porque ahora SÍ tiene el permiso base.
--
-- Ojo: esto es solo para TABLAS. Las funciones (create_appointment,
-- create_business_self_service, etc.) ya tienen su propio grant/revoke
-- explícito por función en sus migraciones — un GRANT EXECUTE en bloque acá
-- reabriría accesos que esas migraciones cerraron a propósito (ej. `anon`
-- no puede llamar a create_business_self_service). No se toca.
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;

-- Para que esto no se repita con cada tabla nueva que se cree desde acá en
-- adelante (Fase 7/8 en lo que queda, o cualquier ajuste futuro): mismo
-- default ACL que ya tienen las tablas creadas por supabase_admin, pero
-- para lo que cree el CLI (rol postgres).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
