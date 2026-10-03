-- ============================================================================
-- Los turnos que quedaron 'pendiente' pasan a 'confirmada'
-- ============================================================================
-- Desde 20261018000000_turnos_nacen_confirmados.sql ya no nace ninguno
-- pendiente; los de antes pasan a confirmados (pedido explícito del usuario,
-- 03/10/2026) para que la agenda quede pareja.
--
-- El trigger que frena al CLIENTE (protect_appointment_client_cancel) no
-- reconoce a la migración como negocio — corre sin sesión — y rechazaría el
-- cambio de estado: se apaga solo para este update. Los demás triggers no
-- molestan: turnos_sin_pisarse no mira un pendiente→confirmada (los dos son
-- vivos) y el resto solo reacciona a cancelaciones o a la seña.
alter table appointments disable trigger appointments_protect_client_cancel;
update appointments set status = 'confirmada' where status = 'pendiente';
alter table appointments enable trigger appointments_protect_client_cancel;
