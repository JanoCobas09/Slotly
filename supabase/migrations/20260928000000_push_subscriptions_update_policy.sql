-- push_subscriptions tenía INSERT y DELETE pero no UPDATE: savePushToken usa
-- upsert(onConflict: 'endpoint') porque el mismo dispositivo puede volver a
-- activar el push sin haberse desuscrito antes (pushManager.getSubscription()
-- devuelve la suscripción existente en vez de crear una nueva) — sin esta
-- policy, ese camino de upsert fallaba con permission-denied en el UPDATE.
create policy push_subscriptions_update on push_subscriptions
  for update
  using (is_business_staff(business_id) and user_id = auth.uid())
  with check (is_business_staff(business_id) and user_id = auth.uid());
