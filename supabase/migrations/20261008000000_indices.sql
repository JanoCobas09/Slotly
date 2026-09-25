-- ============================================================================
-- Índices: sacar los duplicados, agregar los que faltan en claves foráneas
-- ============================================================================
-- Auditoría de eficiencia (supabase inspect db index-stats + catálogo). No
-- cambia ningún resultado de ninguna consulta: solo cómo las resuelve Postgres.

-- Duplicados: cuestan en cada escritura y no los usa nadie.
--   businesses_slug_idx: la restricción UNIQUE de `slug` ya crea su propio
--   índice (businesses_slug_key) — este era una copia exacta.
drop index if exists businesses_slug_idx;
--   appointments_business_idx: (business_id) lo cubre entero el índice
--   compuesto appointments_business_date_idx (business_id, appointment_date).
drop index if exists appointments_business_idx;

-- Claves foráneas sin índice que la app sí recorre:
--   notifications.appointment_id: ON DELETE CASCADE desde appointments. Sin
--   índice, CADA turno borrado (incluidas las señas vencidas que borra el
--   cron cada minuto) recorre la tabla de notificaciones entera.
create index if not exists notifications_appointment_idx on notifications (appointment_id);
--   notifications.professional_id: la campanita del profesional filtra por esto.
create index if not exists notifications_professional_idx on notifications (professional_id);
--   professional_services.service_id: Servicios reasigna profesionales
--   borrando por service_id, y borrar un servicio cascadea por acá.
create index if not exists professional_services_service_idx on professional_services (service_id);
--   appointments.service_id: borrar un servicio tiene que verificar que
--   ningún turno lo use.
create index if not exists appointments_service_idx on appointments (service_id);
