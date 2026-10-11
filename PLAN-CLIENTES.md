# Sección Clientes — auditoría y plan de implementación

Rama: `feat/clientes`. Nada de esto se aplica a producción sin autorización
explícita (migración, Edge Functions, bucket y cron).

## 1. Cómo está armado hoy (auditoría)

- **Stack.** SPA React 19 + Vite + react-router 7, desplegada en Vercel. El
  "backend" es Supabase: Postgres con RLS (la única barrera real entre
  negocios), funciones SQL (`rpc`), Edge Functions en Deno para lo que
  necesita la service role, Storage y Realtime. No hay ORM ni servidor propio.
- **Acceso a datos.** Ningún componente toca Supabase directo: todo pasa por
  `src/lib/repository.js` (tablas, `fromRow`/`toRow` snake↔camel,
  `traducirError`) y `src/lib/functions.js` (Edge Functions). Las
  suscripciones en vivo solo en `BusinessSync.jsx`.
- **Auth.** Solo Google (Supabase Auth, OAuth redirect). El identificador
  estable es `auth.users.id` (Supabase lo ata al `sub` de Google en
  `auth.identities`); el mail y el nombre pueden cambiar. El nombre de Google
  viene en `raw_user_meta_data.full_name`/`name`.
- **Multi-tenant y roles.** Los permisos son custom claims del JWT
  (`app_metadata`): `business_id`, `role` (`owner` | `admin` = profesional
  atado a `professional_id` | `manager` = administrador de una sucursal,
  `branch_id`), `platform` (`true` | `'moderator'`). Helpers SQL:
  `in_business`, `is_business_owner`, `is_assigned_staff`,
  `is_branch_manager`, `can_manage`, `auth_is_platform(_team)`,
  `negocio_privado`.
- **Principio de privacidad.** `businesses.privacidad_clientes` (activado por
  defecto en salud, servicios profesionales y bienestar): la plataforma deja
  de ver los datos del cliente de ese negocio.
- **Turnos (`appointments`).** `type`: `client` (reserva pública, la crea la
  Edge Function `create-appointment` → `create_appointment()` con
  `user_id = uid del que reserva`, verificado por JWT), `manual` (lo carga el
  staff) y `walkin` (bloque sin cliente). **Ojo:** en `manual`/`walkin` el
  `user_id` es el uid del STAFF que lo cargó (lo exige la policy de insert),
  así que `user_id` solo identifica al cliente en los turnos `client`.
  Estados: `pendiente`, `confirmada`, `completada`, `cancelada`,
  `no_asistio`. Los turnos no se borran (no hay policy de DELETE).
- **Storage.** Bucket público `business-logos` (logos y fotos de
  profesionales), path `{businessId}/...`, policies con `can_manage`.
- **Pruebas.** No hay test runner en `package.json`: las suites son scripts
  `supabase/tests/test-*.mjs` que corren contra el stack local
  (`npx supabase start` + `functions serve`) con cuentas reales de cada rol.
  Además `npm run lint` y `npm run build`.

## 2. Diseño

### 2.1 Modelo de datos (migración `20261023000000_clientes.sql`)

| Tabla | Para qué | Claves |
|---|---|---|
| `clientes` | Ficha del cliente **por negocio** | `id`; `unique (business_id, user_id) where user_id is not null`; `unique (id, business_id)` para FKs compuestas |
| `appointments.cliente_id` | Vínculo turno → ficha (columna nueva, nullable) | FK compuesta `(cliente_id, business_id) → clientes(id, business_id)`: imposible apuntar a la ficha de otro negocio |
| `turno_comentarios` | Comentarios internos del turno | FK `appointment_id` (cascade), `business_id` copiado del turno por trigger, `autor_id`, `autor_nombre` |
| `turno_adjuntos` | Metadatos de archivos (el binario va a Storage) | FK `appointment_id`, `ruta_objeto` única, `estado` `pendiente`/`listo` |

`clientes`: `nombre` (editable en el negocio, arranca con el nombre de Google),
`nombre_google` (referencia, se refresca), `email` (último de la cuenta),
`telefono`, `observaciones`, `user_id` (nullable: fichas sin cuenta),
`created_at`, `updated_at`. No se duplican datos del turno: el historial se
lee de `appointments`.

### 2.2 Vínculo cliente ↔ turno

- **Reserva con cuenta** (`type = 'client'`): trigger `BEFORE INSERT` en
  `appointments` hace upsert de la ficha por `(business_id, user_id)` y
  completa `cliente_id`. Nunca pisa `nombre` (solo refresca `nombre_google` y
  `email`). La misma persona en otro negocio tiene OTRA ficha: nada se
  comparte entre negocios.
- **Turnos cargados por el negocio** (`manual`): quedan sin ficha. El staff que
  puede ver ese turno lo vincula a mano a una ficha existente o crea una ficha
  nueva desde el turno (es el staff quien verifica la identidad). Nunca por
  coincidencia de nombre ni de mail. Los `walkin` no se vinculan (no tienen
  cliente). Un turno `client` no se puede re-vincular (su identidad la da la
  cuenta).
- **Históricos**: la migración vincula, de forma idempotente, solo los turnos
  `client` con `user_id` (identidad verificable). Los `manual` históricos
  quedan para vincular a mano.
- No hay fusión automática de fichas (queda como limitación conocida).

### 2.3 Permisos (RLS + funciones `security definer` con chequeo explícito)

| Quién | Fichas | Historial | Comentarios / archivos |
|---|---|---|---|
| Dueño | todas las del negocio; crea, edita | todos los turnos | ver, crear; borrar cualquiera; editar los propios |
| Administrador de sucursal | las que tienen turnos en su sucursal; edita | los de su sucursal | en turnos de su sucursal; editar/borrar los propios |
| Profesional (`admin`) | las que atendió; solo lectura | los suyos | en sus turnos; editar/borrar los propios |
| Plataforma | solo negocios sin privacidad; lectura | ídem | lectura |
| Cliente final | nada (es documentación interna) | — | — |

El `business_id` nunca se toma del navegador como verdad: los triggers lo
copian del turno, las FKs compuestas impiden cruzar negocios y cada función
revalida contra los claims del JWT.

### 2.4 Archivos

- Bucket **privado** `turno-adjuntos`, `file_size_limit` 15 MiB,
  `allowed_mime_types` (JPEG, PNG, WebP, HEIC/HEIF, PDF, DOC, DOCX). Sin SVG ni
  HTML: nada que se pueda ejecutar como código en el navegador.
- Path: `{business_id}/{appointment_id}/{adjunto_id}/{archivo}`.
- Flujo de subida:
  1. `iniciar_adjunto()` (SQL) valida permiso, tipo, tamaño declarado y tope
     por turno, y crea la fila `pendiente` con la ruta.
  2. El navegador pide `createSignedUploadUrl` para esa ruta. La policy de
     INSERT de Storage solo lo permite si existe esa fila `pendiente` del
     mismo usuario.
  3. Sube directo a Storage con XHR (progreso, cancelación). El archivo no
     pasa por ningún servidor nuestro.
  4. Edge Function `confirmar-adjunto`: revisa permiso, lee solo los primeros
     bytes del objeto (Range) para validar el tipo real (firma de archivo), toma el
     tamaño real y marca `listo`. Si no coincide, borra objeto y fila.
- Descarga: `createSignedUrl` de 60 s (originales) o 10 min (miniaturas). La
  policy de SELECT de Storage exige poder ver la fila `listo`.
- Borrado: Edge Function `eliminar-adjunto` (objeto + fila, con permiso).
- Limpieza: Edge Function `limpiar-adjuntos` (para cron diario): borra filas
  `pendiente` de más de 24 h y sus objetos, y objetos sin fila de más de 24 h.
  Nunca toca filas `listo`.
- Fotos: el navegador las redimensiona (lado mayor 2048 px, WebP o JPEG) y
  genera una miniatura de 320 px **antes** de subir. Se guarda la versión
  optimizada, no el original pesado (decisión documentada). Las listas solo
  piden miniaturas, con carga diferida. PDF/DOC/DOCX se suben tal cual.

### 2.5 Rendimiento

- `listar_clientes()` (SQL): búsqueda por nombre/mail/teléfono, filtros y
  orden en el servidor, página de 25, total con `count(*) over()`; los
  contadores salen de una agregación sobre `appointments` con índice
  `(business_id, cliente_id)`. No se guardan contadores duplicados.
- `historial_cliente()` (SQL): página de 20 con filtros (período, estado,
  servicio), cuántos comentarios/archivos tiene cada turno en la misma
  consulta (sin N+1), índice `(cliente_id, appointment_date desc)`.
- Comentarios y archivos se piden recién al abrir un turno, paginados.
- Subidas de a una a la vez por turno (concurrencia 1), límite de 20 archivos por
  turno.
- Sin caché nueva: los datos se piden a demanda; no se suman suscripciones
  realtime.

### 2.6 Interfaz

- Menú: "Clientes" para dueño, administrador de sucursal y profesional.
- `/admin/clientes`: buscador con debounce, filtros (con cuenta / sin cuenta
  / con próximo turno), orden, tabla en escritorio y tarjetas en celular,
  paginación.
- `/admin/clientes/:id`: ficha (datos, métricas, observaciones editables),
  historial paginado con filtros, cada turno abre su detalle con comentarios
  y archivos.
- `DetalleTurnoModal` (Citas, Inicio) suma la sección de comentarios y
  archivos y el acceso a la ficha, o vincular o crear ficha para turnos
  cargados a mano.

## 3. Pruebas

- `supabase/tests/test-clientes.mjs` contra el stack local: vínculo
  automático, sin duplicados, aislamiento entre negocios, permisos por rol,
  orden y paginación del historial, búsqueda y filtros, estado reflejado,
  comentarios y archivos en el turno correcto, rechazo de tipo y tamaño,
  firmas de archivo falsas, acceso a Storage sin permiso o con IDs de otro
  negocio, que la migración no rompa nada y sea idempotente.
- Suites existentes relevantes (`test-appointments`, `test-privacidad`,
  `test-sucursales`, `test-validaciones`), `npm run lint`, `npm run build`.
- Navegador (agent-browser) contra el stack local para los flujos de UI.

## 4. Riesgos e incompatibilidades detectadas

- `user_id` de turnos manuales es el del staff → no sirve como identidad del
  cliente (ver 2.2). Por eso esos turnos se vinculan a mano.
- Datos sensibles (salud): la documentación queda fuera del alcance de la
  plataforma cuando `privacidad_clientes` está activo; los datos igual son
  visibles para quien tenga la service role o el panel de Supabase. Antes de
  publicar para salud conviene revisar la Ley 25.326 (datos sensibles) y el
  consentimiento informado: queda señalado, no resuelto por código.
- Plan gratis de Supabase: 1 GB de Storage en total. Con fotos optimizadas
  (~300–600 KB) alcanza para miles de archivos, pero conviene vigilarlo.
- Las URLs firmadas de subida de Supabase duran 2 h (no configurable); se
  mitiga porque solo sirven para esa ruta exacta y sin sobrescribir.
- Requiere desplegar 3 Edge Functions y programar el cron de limpieza:
  pendiente de autorización.

## 5. Estado de la implementación (11/10/2026)

Hecho en la rama `feat/clientes`, probado contra el stack local. **Nada se
aplicó en producción.**

### Archivos

- Base: `supabase/migrations/20261023000000_clientes.sql`.
- Edge Functions: `supabase/functions/confirmar-adjunto`, `eliminar-adjunto`,
  `limpiar-adjuntos`, y `supabase/functions/_shared/adjuntos.ts`.
- Datos: `src/lib/repository.js` (sección CLIENTES), `src/lib/functions.js`,
  `src/lib/subirAdjunto.js`, `src/utils/archivos.js`, `src/utils/errores.js`.
- Pantallas: `src/pages/admin/ClientesPage.jsx`, `ClienteFichaPage.jsx`,
  `src/components/admin/clientes/*`, `DetalleTurnoModal.jsx`, menú en
  `AdminLayout.jsx`, rutas en `App.jsx`, estilos al final de `index.css`.
- Pruebas: `supabase/tests/test-clientes.mjs`.

### Pruebas ejecutadas

- `test-clientes.mjs`: 83/83. Cubre los 18 puntos pedidos que se pueden
  verificar en la base (los números en cada caso de la suite).
- Suites que ya existían y tocan turnos: appointments 8/8, privacidad 19/19,
  sucursales 32/32, validaciones 41/41, quien-cancela 5/5,
  bloqueos-y-pisadas 21/21, cancellation-notify 5/5, avisos-whatsapp 11/11.
- Migración: aplicada sobre la base local con datos (133 turnos: siguen
  todos, 92 con cuenta quedaron vinculados a 71 fichas sin duplicados) y
  vuelta a correr entera dentro de una transacción: sin errores, 0 turnos
  nuevos por vincular (idempotente).
- Navegador (agent-browser, stack local): listado, búsqueda, paginación,
  ficha, historial, comentario nuevo, subida real de una foto (694 KB →
  WebP de 93 KB, 2048 px, con miniatura) y de un PDF, visor, vincular y
  desvincular desde Citas, vista de celular y error sin conexión con
  reintento.
- `npm run build` sin errores. `npm run lint`: 7 errores, todos de antes de
  este cambio (`api/keepalive.js` y `src/contexts/*`).

### Para publicar (requiere autorización)

1. `npx supabase db push --linked` (aplica la migración; no borra nada).
2. `npx supabase functions deploy confirmar-adjunto eliminar-adjunto limpiar-adjuntos`.
   No necesitan variables nuevas: usan `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY`, que ya existen.
3. Programar la limpieza diaria, con la clave `sb_secret_...` (ver "Hallazgo
   importante de claves" en CLAUDE.md), en el SQL editor:

   ```sql
   select cron.schedule('limpiar-adjuntos', '30 6 * * *', $$
     select net.http_post(
       url := 'https://pwigjpqiwzyakwwzwthz.supabase.co/functions/v1/limpiar-adjuntos',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select service_role_key from app_settings limit 1),
                                     'Content-Type', 'application/json'),
       body := '{}'::jsonb)
   $$);
   ```
4. Merge de `feat/clientes` a `main` (Vercel despliega el front).

No hay variables de entorno nuevas en el front.

### Limitaciones conocidas

- No hay fusión de fichas duplicadas (por ejemplo, una ficha sin cuenta y la
  misma persona reservando después con Google). Hoy se resuelve vinculando
  los turnos manuales a la ficha correcta.
- Al cargar un turno a mano no se elige la ficha en el mismo formulario: se
  vincula después desde el detalle del turno.
- La validación de DOCX llega hasta "es un ZIP" (no se descomprime en el
  servidor).
- HEIC fuera de Safari no se puede previsualizar ni optimizar en el
  navegador: se guarda tal cual, sin miniatura.
- Dar de baja un negocio deja sus archivos en Storage hasta la limpieza
  diaria (las filas se borran en cascada; `limpiar-adjuntos` borra los
  objetos sin fila después de 24 h).
- Privacidad: con `privacidad_clientes` la plataforma no ve la documentación
  desde la app, pero sí quien tenga la service role o el panel de Supabase.
  Para salud, revisar Ley 25.326 (datos sensibles) y consentimiento antes de
  ofrecerlo.
