-- Prueba rápida y manual de RLS, corrida como postgres (superusuario, bypassa
-- RLS) salvo donde se cambia explícitamente a `authenticated`/`anon`
-- simulando un JWT. No reemplaza una suite de verdad (ver nota al final), es
-- un smoke test para validar que las policies no tienen un error obvio antes
-- de construir nada más arriba.
--
-- OJO: `set local` solo dura lo que dura la transacción actual. Cada caso va
-- en su propio begin/commit (o rollback, si el caso mismo hace un cambio que
-- no interesa dejar).

\set ON_ERROR_STOP on

-- Dos negocios de prueba, insertados como postgres (bypassa RLS, como lo
-- haría un Edge Function con service role).
insert into businesses (id, name, slug, plan_id)
values
  ('00000000-0000-0000-0000-00000000000a', 'Negocio A', 'negocio-a', 'basico'),
  ('00000000-0000-0000-0000-00000000000b', 'Negocio B', 'negocio-b', 'basico');

insert into billing (business_id, debt, monthly_fee)
values
  ('00000000-0000-0000-0000-00000000000a', 0, 12000),
  ('00000000-0000-0000-0000-00000000000b', 0, 12000);

-- Un "usuario" real en auth.users, para que auth.uid() tenga algo que devolver.
insert into auth.users (id, email, raw_app_meta_data)
values (
  '00000000-0000-0000-0000-0000000000aa',
  'owner-a@example.com',
  '{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}'::jsonb
);

\echo '--- Caso 1: anónimo lee el negocio público (esperado: 2 filas) ---'
begin;
set local role anon;
select count(*) from businesses;
commit;

\echo '--- Caso 2: anónimo NO puede crear un negocio (esperado: rechazado) ---'
begin;
set local role anon;
do $$
begin
  insert into businesses (name, slug) values ('Intruso', 'intruso');
  raise exception 'FALLA: un anónimo pudo crear un negocio';
exception when insufficient_privilege then
  raise notice 'OK: rechazado';
end $$;
rollback;

\echo '--- Caso 3: dueño de A NO puede leer la facturación sin ser equipo de plataforma (esperado: 0 filas) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}}';
select count(*) from billing;
commit;

\echo '--- Caso 4: dueño de A intenta auto-descongelarse / tocar plan (esperado: el trigger lo bloquea) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}}';
do $$
begin
  update businesses set is_frozen = true where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'FALLA: el dueño pudo tocar isFrozen';
exception when others then
  raise notice 'OK: rechazado (%)', sqlerrm;
end $$;
rollback;

\echo '--- Caso 5: dueño de A SÍ puede editar su propio nombre (esperado: nombre cambiado) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}}';
update businesses set name = 'Negocio A (editado)' where id = '00000000-0000-0000-0000-00000000000a';
select name from businesses where id = '00000000-0000-0000-0000-00000000000a';
commit;

\echo '--- Caso 6: dueño de A NO puede editar el negocio B (esperado: 0 filas afectadas) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}}';
with actualizado as (
  update businesses set name = 'HACKEADO' where id = '00000000-0000-0000-0000-00000000000b'
  returning id
)
select count(*) as filas_afectadas from actualizado;
rollback;

\echo '--- Caso 7: dueño de A lee sus propios turnos y NO los de B (setup + verificación) ---'
insert into professionals (id, business_id, name) values
  ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000000a', 'Prof A'),
  ('00000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-00000000000b', 'Prof B');
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000cc', 'cliente@example.com', '{}'::jsonb);
insert into appointments (business_id, professional_id, user_id, appointment_date, start_time, status, type) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-0000000000cc', '2026-10-01', '10:00', 'pendiente', 'client'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000001b', '00000000-0000-0000-0000-0000000000cc', '2026-10-01', '11:00', 'pendiente', 'client');

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}}';
select business_id, count(*) from appointments group by business_id;
commit;

\echo '--- Caso 8: el cliente ve SOLO su propio turno en cada negocio en el que reservó (esperado: 2 filas, una por negocio) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000cc","app_metadata":{}}';
select business_id, count(*) from appointments group by business_id;
commit;

\echo '--- Caso 9: el cliente intenta cancelar un turno tocando el precio a la vez (esperado: rechazado por el trigger) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000cc","app_metadata":{}}';
do $$
begin
  update appointments set status = 'cancelada', price = 0
  where business_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000cc';
  raise exception 'FALLA: el cliente pudo tocar el precio al cancelar';
exception when others then
  raise notice 'OK: rechazado (%)', sqlerrm;
end $$;
rollback;

\echo '--- Caso 10: el cliente cancela su turno SIN tocar otra cosa (esperado: status = cancelada) ---'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000cc","app_metadata":{}}';
update appointments set status = 'cancelada', cancelled_by = 'client'
where business_id = '00000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000cc';
select status, cancelled_by from appointments where business_id = '00000000-0000-0000-0000-00000000000a';
commit;

-- ============================================================================
-- Casos 11-12: agregados el 23/09 junto con la corrección del esquema
-- recuperado (ver 20260923000000_fix_recovered_schema.sql) — cubren
-- específicamente lo que esa migración agregó y que estos 10 casos
-- originales no podían probar porque `promotions` no existía todavía.
-- ============================================================================

\echo '--- Caso 11: promotions — el dueño de A puede crear, el dueño de B NO puede tocarla ---'
insert into services (id, business_id, name, duration_minutes, price) values
  ('00000000-0000-0000-0000-00000000002a', '00000000-0000-0000-0000-00000000000a', 'Servicio A', 30, 1000);
insert into auth.users (id, email, raw_app_meta_data) values (
  '00000000-0000-0000-0000-0000000000bb',
  'owner-b@example.com',
  '{"business_id":"00000000-0000-0000-0000-00000000000b","role":"owner"}'::jsonb
);

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000a","role":"owner"}}';
insert into promotions (business_id, service_id, day_of_week, start_time, end_time, discount_type, discount_value)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000002a', 1, '09:00', '12:00', 'percentage', 20);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000bb","app_metadata":{"business_id":"00000000-0000-0000-0000-00000000000b","role":"owner"}}';
-- RLS en UPDATE no tira error si la fila no matchea el USING: la deja
-- afuera en silencio (0 filas afectadas). Por eso acá se chequea el
-- row_count real, no si "hubo una excepción" — un update de 0 filas no
-- levanta ninguna.
do $$
declare
  filas int;
begin
  update promotions set discount_value = 99 where business_id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics filas = row_count;
  if filas > 0 then
    raise exception 'FALLA: el dueño de B pudo editar una promoción del negocio A (% filas)', filas;
  end if;
  raise notice 'OK: rechazado (0 filas afectadas)';
end $$;
rollback;

\echo '--- Caso 12: tickets — el estado "respondido" ya no rompe el CHECK ---'
begin;
insert into tickets (business_id, subject, status)
values ('00000000-0000-0000-0000-00000000000a', 'Smoke test', 'respondido');
select status from tickets where business_id = '00000000-0000-0000-0000-00000000000a';
commit;

\echo '--- Limpieza ---'
delete from promotions where business_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
delete from tickets where business_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
delete from services where business_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
delete from appointments where business_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
delete from professionals where business_id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
delete from businesses where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000cc');

\echo 'Listo. NOTA: esto es un smoke test manual para validar el diseño antes de'
\echo 'seguir. La suite de verdad (equivalente a auditar-rules-emulador.mjs) va'
\echo 'en supabase/tests/ con pgTAP cuando se construya esa fase.'
