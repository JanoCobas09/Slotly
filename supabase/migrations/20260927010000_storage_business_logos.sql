-- ============================================================================
-- Storage: logos de negocio (reemplaza el bucket de Firebase Storage)
-- ============================================================================
-- Un archivo fijo por negocio, en `{businessId}/logo` (el bucket ya está
-- scopeado a logos, no hace falta repetir "businesses" en el path) — subir
-- uno nuevo pisa el anterior, así no quedan archivos huérfanos. Público: la
-- página de reservas muestra el logo antes del login, igual que el resto
-- del documento del negocio.
insert into storage.buckets (id, name, public, file_size_limit)
values ('business-logos', 'business-logos', true, 5242880) -- 5 MiB
on conflict (id) do nothing;

-- Lectura pública (mismo criterio que el resto de `businesses`).
create policy business_logos_select on storage.objects
  for select using (bucket_id = 'business-logos');

-- Escritura solo del dueño/staff con permiso de gestión sobre ESE negocio, o
-- la plataforma — mismo helper can_manage() que ya usan professionals/services.
-- El primer segmento del path es el businessId: '<id>/logo'.
create policy business_logos_write on storage.objects
  for insert with check (
    bucket_id = 'business-logos'
    and can_manage((storage.foldername(name))[1]::uuid)
  );

create policy business_logos_update on storage.objects
  for update using (
    bucket_id = 'business-logos'
    and can_manage((storage.foldername(name))[1]::uuid)
  );

create policy business_logos_delete on storage.objects
  for delete using (
    bucket_id = 'business-logos'
    and can_manage((storage.foldername(name))[1]::uuid)
  );
