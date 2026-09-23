-- professional_services.customPrice/customDuration: la UI (ProfessionalsPage,
-- ServicesPage) siempre los escribe (hoy en null — no hay pantalla que los
-- edite a otra cosa) y varios lugares los leen de forma defensiva
-- (availabilityEngine.js, BookingPage.jsx, NuevoTurnoModal.jsx). Ninguno de
-- los dos — ni el original en Firebase ni create_appointment acá — los usa
-- de verdad para calcular precio/duración: es un campo que quedó a mitad de
-- camino desde antes de esta migración. No se "completa" la feature (no es
-- lo que se pidió), solo se agregan las columnas para que la escritura no
-- rompa con "column does not exist".
alter table public.professional_services
  add column custom_price numeric,
  add column custom_duration integer;
