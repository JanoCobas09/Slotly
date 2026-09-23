-- ============================================================================
-- Habilita Supabase Realtime en las tablas que Fase 4 suscribe en vivo
-- ============================================================================
-- Reemplaza a onSnapshot de Firestore: sin agregar la tabla a esta
-- publicación, ningún cambio llega por WebSocket y las pantallas quedan
-- desactualizadas hasta que se recarga la página. RLS sigue aplicando
-- normalmente sobre los eventos de Realtime (Supabase evalúa las policies
-- por cada mensaje antes de mandarlo al canal correspondiente).
alter publication supabase_realtime add table
  businesses,
  billing,
  professionals,
  services,
  schedules,
  professional_services,
  promotions,
  appointments,
  admins,
  notifications,
  notification_reads,
  platform_team,
  tickets,
  ticket_messages,
  platform_config;
