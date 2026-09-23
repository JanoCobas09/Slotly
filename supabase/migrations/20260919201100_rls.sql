-- ============================================================================
-- Slotly — Row Level Security (equivalente a firestore.rules)
-- ============================================================================
-- Traducción 1:1 de cada regla de firestore.rules a políticas de RLS. Mismo
-- espíritu que el archivo original: "esta es la ÚNICA barrera real de
-- aislamiento entre negocios [...] el permiso NO se lee de la base, se lee
-- de los custom claims del token".
--
-- Los custom claims viven en auth.users.raw_app_meta_data (JWT), asignados
-- SOLO por Edge Functions con la service role key — exactamente el mismo
-- rol que cumplía el Admin SDK de Firebase. Nunca un documento/fila que el
-- propio usuario pueda editar.
--
-- Diferencia estructural importante respecto a Firestore: acá NO hace falta
-- distinguir "get" de "list" (una policy de SELECT cubre ambos, Postgres
-- filtra fila por fila sin importar cómo se arma la query), y tampoco hace
-- falta el truco de `getAfter()` para tickets+mensaje en el mismo batch: una
-- transacción SQL ve sus propios INSERTs anteriores sin ese problema. Los dos
-- eran "trampas ya pagadas" específicas de Firestore que acá no existen.

-- ============================================================================
-- Helpers — leen los custom claims del JWT (auth.jwt() -> 'app_metadata')
-- ============================================================================

create or replace function auth_business_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'business_id', '')::uuid
$$;

create or replace function auth_role() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'role'
$$;

create or replace function auth_professional_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'professional_id', '')::uuid
$$;

-- El dueño de la plataforma. Puede todo.
create or replace function auth_is_platform() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform')::boolean, false)
$$;

-- Moderador: 'platform' = 'moderator' (string), NO boolean true — mismo
-- motivo que en Firestore: todo lo que exige auth_is_platform() lo deja
-- afuera por defecto, y lo que puede hacer se concede explícito acá abajo.
create or replace function auth_is_moderator() returns boolean
language sql stable as $$
  select (auth.jwt() -> 'app_metadata' ->> 'platform') = 'moderator'
$$;

create or replace function auth_is_platform_team() returns boolean
language sql stable as $$
  select auth_is_platform() or auth_is_moderator()
$$;

create or replace function in_business(target_business_id uuid) returns boolean
language sql stable as $$
  select auth.uid() is not null and auth_business_id() = target_business_id
$$;

create or replace function is_business_owner(target_business_id uuid) returns boolean
language sql stable as $$
  select in_business(target_business_id) and auth_role() = 'owner'
$$;

create or replace function is_business_staff(target_business_id uuid) returns boolean
language sql stable as $$
  select in_business(target_business_id) and auth_role() in ('owner', 'admin')
$$;

-- Staff con rol 'admin', atado a un perfil de profesional. A diferencia del
-- dueño, solo alcanza sus propios turnos/horarios.
create or replace function is_assigned_staff(target_business_id uuid) returns boolean
language sql stable as $$
  select in_business(target_business_id) and auth_role() = 'admin'
$$;

-- Escribe cosas del negocio: su dueño, o la plataforma preparando la cuenta.
create or replace function can_manage(target_business_id uuid) returns boolean
language sql stable as $$
  select is_business_owner(target_business_id) or auth_is_platform()
$$;

-- ============================================================================
-- BUSINESSES
-- ============================================================================
alter table businesses enable row level security;

-- get público: la página de reservas necesita nombre/colores/horarios antes
-- del login. list también público a nivel RLS (Postgres no distingue): el
-- panel global lista TODO igual, para el resto alcanza con lo que ya se
-- expone acá — no hay nada sensible en esta tabla (ver comentario de
-- is_frozen/billing en la migración de esquema).
create policy businesses_select on businesses
  for select using (true);

create policy businesses_insert on businesses
  for insert with check (auth_is_platform());

create policy businesses_delete on businesses
  for delete using (auth_is_platform());

-- El dueño edita marca/configuración; los campos protegidos (comercial,
-- facturación, identidad) se hacen cumplir con un trigger, no acá (ver más
-- abajo) porque RLS no puede comparar columna vieja vs. nueva en una sola
-- expresión.
create policy businesses_update on businesses
  for update using (auth_is_platform() or is_business_owner(id))
  with check (auth_is_platform() or is_business_owner(id));

-- Mismos campos que protegía firestore.rules con
-- request.resource.data.diff(resource.data).affectedKeys().hasAny([...]).
-- trialEndsAt está en la lista por el mismo motivo que en Firestore: es lo
-- que runBilling usa para decidir si cobrar. Sin esto, el dueño se ponía la
-- prueba en 2099 con la consola abierta.
create or replace function protect_business_columns() returns trigger
language plpgsql as $$
begin
  if auth_is_platform() then
    return new;
  end if;
  if new.is_frozen is distinct from old.is_frozen
    or new.plan_id is distinct from old.plan_id
    or new.whatsapp_quota is distinct from old.whatsapp_quota
    or new.slug is distinct from old.slug
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.created_at is distinct from old.created_at
    or new.signup_source is distinct from old.signup_source
    or new.frozen_at is distinct from old.frozen_at
  then
    raise exception 'Solo la plataforma puede modificar esos campos.';
  end if;
  return new;
end;
$$;

create trigger businesses_protect_columns
  before update on businesses
  for each row execute function protect_business_columns();

-- ============================================================================
-- BILLING — solo plataforma, ni el dueño la lee (equipo completo: dueño +
-- moderador leen, solo el dueño de plataforma escribe — igual que Firestore)
-- ============================================================================
alter table billing enable row level security;

create policy billing_select on billing
  for select using (auth_is_platform_team());

create policy billing_all on billing
  for all using (auth_is_platform()) with check (auth_is_platform());

-- ============================================================================
-- PROFESSIONALS — lectura pública, el propio profesional edita su ficha
-- (menos isActive, que es del dueño y cuenta para el tope del plan)
-- ============================================================================
alter table professionals enable row level security;

create policy professionals_select on professionals
  for select using (true);

create policy professionals_insert on professionals
  for insert with check (can_manage(business_id));

create policy professionals_delete on professionals
  for delete using (can_manage(business_id));

create policy professionals_update on professionals
  for update
  using (can_manage(business_id) or (is_assigned_staff(business_id) and auth_professional_id() = id))
  with check (can_manage(business_id) or (is_assigned_staff(business_id) and auth_professional_id() = id));

create or replace function protect_professional_columns() returns trigger
language plpgsql as $$
begin
  if can_manage(new.business_id) then
    return new;
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'Activar o desactivar un profesional es del dueño.';
  end if;
  return new;
end;
$$;

create trigger professionals_protect_columns
  before update on professionals
  for each row execute function protect_professional_columns();

-- ============================================================================
-- STAFF CONTACTS — privado. El dueño gestiona todo su equipo; un profesional
-- solo el suyo. NO va dentro de `professionals` (lectura pública) a propósito.
-- ============================================================================
alter table staff_contacts enable row level security;

create policy staff_contacts_select on staff_contacts
  for select using (is_business_staff(business_id) or auth_is_platform());

create policy staff_contacts_write on staff_contacts
  for all
  using (can_manage(business_id) or (is_business_staff(business_id) and auth_professional_id() = professional_id))
  with check (can_manage(business_id) or (is_business_staff(business_id) and auth_professional_id() = professional_id));

-- ============================================================================
-- SERVICES — lectura pública, solo el dueño/plataforma escribe
-- ============================================================================
alter table services enable row level security;

create policy services_select on services for select using (true);
create policy services_write on services
  for all using (can_manage(business_id)) with check (can_manage(business_id));

-- ============================================================================
-- PROFESSIONAL_SERVICES — lectura pública, solo el dueño/plataforma escribe
-- ============================================================================
alter table professional_services enable row level security;

create policy professional_services_select on professional_services for select using (true);
create policy professional_services_write on professional_services
  for all using (can_manage(business_id)) with check (can_manage(business_id));

-- ============================================================================
-- SCHEDULES — lectura pública. El profesional maneja SUS horarios, el resto
-- es del dueño. No hace falta trigger acá: es igualdad simple contra la fila
-- vieja (using) y la nueva (with check), sin comparar columnas entre sí.
-- ============================================================================
alter table schedules enable row level security;

create policy schedules_select on schedules for select using (true);

create policy schedules_insert on schedules
  for insert with check (can_manage(business_id) or auth_professional_id() = professional_id);

create policy schedules_update on schedules
  for update
  using (can_manage(business_id) or auth_professional_id() = professional_id)
  with check (can_manage(business_id) or auth_professional_id() = professional_id);

create policy schedules_delete on schedules
  for delete using (can_manage(business_id) or auth_professional_id() = professional_id);

-- ============================================================================
-- APPOINTMENTS
-- ============================================================================
alter table appointments enable row level security;

-- Dueño ve toda la agenda; el profesional asignado solo los suyos; el
-- cliente solo los propios; plataforma ve todo.
create policy appointments_select on appointments
  for select using (
    is_business_owner(business_id)
    or auth_is_platform_team()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

-- Un cliente NO inserta turnos directo (pasa por el Edge Function
-- create-appointment, que corre con service role y valida precio, fecha,
-- solapamiento y que el negocio no esté suspendido). El staff SÍ inserta
-- directo para los "servicio sin turno" (walk-in): es su propia agenda.
-- El turno que carga el staff lleva SU uid como user_id -- no puede
-- plantarle un turno a otra cuenta.
create policy appointments_insert on appointments
  for insert with check (
    user_id = auth.uid()
    and (
      auth_is_platform()
      or is_business_owner(business_id)
      or (is_assigned_staff(business_id) and professional_id = auth_professional_id())
    )
  );

-- Dueño/plataforma/profesional asignado: sin restricción de campos (igual
-- que Firestore). El cliente dueño del turno: solo puede cancelar uno vivo,
-- y el trigger de abajo restringe qué columnas puede tocar.
create policy appointments_update on appointments
  for update
  using (
    is_business_owner(business_id)
    or auth_is_platform()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or (auth.uid() is not null and user_id = auth.uid())
  )
  with check (
    is_business_owner(business_id)
    or auth_is_platform()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
    or (auth.uid() is not null and user_id = auth.uid())
  );

-- Los turnos no se borran: se cancelan. Sin policy de DELETE = denegado.

create or replace function protect_appointment_client_cancel() returns trigger
language plpgsql as $$
begin
  -- Dueño, plataforma o el profesional asignado: sin restricción (mismo
  -- criterio que la policy de arriba, este trigger solo frena al CLIENTE).
  if is_business_owner(new.business_id)
    or auth_is_platform()
    or (is_assigned_staff(new.business_id) and auth_professional_id() = new.professional_id)
  then
    return new;
  end if;

  -- A partir de acá, quien escribe es el cliente dueño del turno.
  if old.status not in ('pendiente', 'confirmada') then
    raise exception 'Ese turno ya no se puede cancelar.';
  end if;
  if new.status is distinct from 'cancelada' then
    raise exception 'Un cliente solo puede cancelar su turno, no editarlo.';
  end if;
  if new.professional_id is distinct from old.professional_id
    or new.service_id is distinct from old.service_id
    or new.appointment_date is distinct from old.appointment_date
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.price is distinct from old.price
    or new.client_name is distinct from old.client_name
    or new.client_phone is distinct from old.client_phone
    or new.client_email is distinct from old.client_email
    or new.notes is distinct from old.notes
  then
    raise exception 'Un cliente solo puede tocar el estado y el motivo de cancelación.';
  end if;
  return new;
end;
$$;

create trigger appointments_protect_client_cancel
  before update on appointments
  for each row execute function protect_appointment_client_cancel();

-- ============================================================================
-- NOTIFICATIONS — las escribe el trigger de turnos (service role, bypassa
-- RLS). Desde el browser solo se leen y se marca leída (notification_reads).
-- ============================================================================
alter table notifications enable row level security;

create policy notifications_select on notifications
  for select using (
    is_business_owner(business_id)
    or auth_is_platform_team()
    or (is_assigned_staff(business_id) and auth_professional_id() = professional_id)
  );
-- Sin policy de insert/update/delete: solo el trigger (service role) escribe.

alter table notification_reads enable row level security;

create policy notification_reads_select on notification_reads
  for select using (user_id = auth.uid());

-- Marcar leída: solo la propia, y solo sobre una notificación que ya podría
-- leer (se apoya en la policy de select de notifications vía el FK).
create policy notification_reads_insert on notification_reads
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from notifications n
      where n.id = notification_id
        and (
          is_business_owner(n.business_id)
          or auth_is_platform_team()
          or (is_assigned_staff(n.business_id) and auth_professional_id() = n.professional_id)
        )
    )
  );

-- ============================================================================
-- PUSH SUBSCRIPTIONS — cada quien escribe/borra la suya. Nadie lee desde acá:
-- el envío corre con service role (igual que pushTokens en Firestore, que
-- tenía allow read: if false).
-- ============================================================================
alter table push_subscriptions enable row level security;

create policy push_subscriptions_insert on push_subscriptions
  for insert with check (is_business_staff(business_id) and user_id = auth.uid());

create policy push_subscriptions_delete on push_subscriptions
  for delete using (is_business_staff(business_id) and user_id = auth.uid());

-- ============================================================================
-- ADMINS — registro para UI, NO otorga permiso (el permiso real es el JWT)
-- ============================================================================
alter table admins enable row level security;

create policy admins_select on admins
  for select using (is_business_staff(business_id) or auth_is_platform_team());

create policy admins_write on admins
  for all using (can_manage(business_id)) with check (can_manage(business_id));

-- ============================================================================
-- PENDING ADMINS — sin policies: solo Edge Functions con service role lo
-- tocan (setBusinessAdmin, applyPendingClaims), igual que en Firestore
-- (nunca tuvo un match propio, caía en el "todo lo demás cerrado" del final).
-- ============================================================================
alter table pending_admins enable row level security;

-- ============================================================================
-- TICKETS
-- ============================================================================
alter table tickets enable row level security;

create policy tickets_select on tickets
  for select using (auth_is_platform_team() or in_business(business_id));

-- El '' vacío que protegía Firestore (claims().get('businessId','') != '')
-- no hace falta acá: auth_business_id() es NULL para quien no tiene el
-- claim, y NULL = business_id nunca da true.
create policy tickets_insert on tickets
  for insert with check (auth_is_platform_team() or auth_business_id() = business_id);

-- Cerrar, reabrir. Nadie borra: quedan de historial (sin policy de delete).
create policy tickets_update on tickets
  for update using (auth_is_platform_team() or in_business(business_id));

alter table ticket_messages enable row level security;

create policy ticket_messages_select on ticket_messages
  for select using (auth_is_platform_team() or in_business(business_id));

-- El autor sale de auth.uid(), nunca del cliente. Al ser una transacción
-- SQL normal (no un batch de Firestore), esto funciona aunque el ticket y
-- el primer mensaje se inserten juntos -- no hace falta el equivalente a
-- getAfter().
create policy ticket_messages_insert on ticket_messages
  for insert with check (
    author_id = auth.uid()
    and (auth_is_platform_team() or in_business(business_id))
  );
-- Un mensaje enviado no se edita ni se borra (sin policies de update/delete).

-- ============================================================================
-- PLATAFORMA
-- ============================================================================
alter table platform_config enable row level security;

create policy platform_config_all on platform_config
  for all using (auth_is_platform()) with check (auth_is_platform());

alter table platform_team enable row level security;

create policy platform_team_select on platform_team
  for select using (auth_is_platform_team());
-- Sin policy de write: solo el Edge Function set-platform-moderator
-- (service role) lo toca, igual que setPlatformModerator con el Admin SDK.
