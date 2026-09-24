# Slotly — contexto del proyecto

> Este archivo se carga automáticamente al abrir una sesión de Claude Code en
> esta carpeta. Leelo primero y no vuelvas a explorar lo que ya está acá.
>
> **La carpeta se llama `BarberOS-clone` por historia. El proyecto es
> Slotly, un producto nuevo y completamente distinto** — no una
> continuación ni un rename de BarberOS. `cavanna11/BarberOS` fue
> únicamente el punto de partida técnico (se clonó su código como semilla
> para no arrancar de cero) y **quedó retirado para siempre** (18/09/2026):
> no se vuelve a pushear ahí, no se lo trata como versión previa de Slotly.
> El único repo vigente es `JanoCobas09/Slotly`, rama `main`. Si ves texto o
> código que todavía dice "BarberOS"/"barbería" es residuo de esa semilla
> técnica, no una referencia a usar ni parte de la identidad del producto.

---

## Qué es

SaaS multi-tenant de turnos y reservas, genérico por rubro (no exclusivo de
barberías: odontología, talleres, entrenadores, psicología, o cualquier
profesión que el dueño escriba a mano). Cada negocio tiene su link público
donde los clientes reservan, su panel de administración, y todo se gestiona
desde un panel global de plataforma.

**Generalización a multi-rubro (17/09/2026 en adelante).** El producto nació
exclusivamente para barberías y se generalizó sin reescribir el core. Puntos
clave para no repetir el análisis:

- `src/config/professionPresets.js` — 7 categorías (`beauty`, `healthcare`,
  `wellness`, `automotive`, `education`, `professional_services`,
  `pet_services`) + fallback `general`, cada una con terminología, tema de
  color, ícono propio (`scissors`, `stethoscope`, `leaf`, `car`, `dumbbell`,
  `briefcase`, `paw`, `building`) y servicios sugeridos. Un negocio nunca
  queda sin categoría: texto libre no reconocido → `general`, nunca un
  estado roto. `resolveBusinessContext()` expone el ícono resuelto
  (`.icon`); se ve en el selector de rubro del alta, en las tarjetas del
  panel global y en el header del cliente (`Header.jsx`).
- `src/lib/resolveBusinessContext.js` — mezcla el preset con lo que el
  negocio haya personalizado. Un negocio sin `business.context` (cualquier
  barbería dada de alta antes de esto) resuelve a `beauty`: misma experiencia
  de siempre, sin migrar datos.
- `src/hooks/useBusinessContext.js` — hook de consumo. Cualquier componente
  que necesite texto o color según el rubro lo usa acá, nunca hardcodea
  "barbero"/"turno"/"cliente" de nuevo.
- **Regla:** configuración antes que hardcode. No agregar `if profession ===
  'x'` disperso ni un archivo por profesión nueva — todo entra como una fila
  más en `professionPresets.js`, o cae en `general` si no amerita categoría
  propia.
- `maxBarbers` (en `plans.js`) es el nombre viejo de `maxProfessionals`, y
  `esBarbero()` (en `firestore.rules`) se renombró a `esStaffAsignado()` —
  mismo comportamiento, nombre genérico. **Verificado contra el emulador**
  (las 4 suites, 202/202 casos) el 17/09/2026: el rename y los mensajes de
  error generalizados en `createAppointment` no rompieron nada.
- Los `customerFields` de cada categoría (dato del vehículo, de la mascota,
  motivo de consulta...) se piden de verdad en el paso 5 de `BookingPage` y
  viajan en `notes` (un parámetro que `createAppointment` ya aceptaba y
  escribía en Firestore, pero que ningún cliente llenaba). El staff los ve en
  `AppointmentsPage` y `AgendaDelDia`.
- Lo que sigue pendiente: terminar de barrer comentarios internos que todavía
  dicen "barbero"/"barbería" (bajo impacto, no afectan al producto). Si vas a
  correr el emulador de nuevo: los puertos por defecto (8080 Firestore, 4000
  UI) pueden estar ocupados por otros procesos de la máquina si hay varios
  proyectos corriendo — remapealos en `firebase.json` (`emulators.*.port`) y
  en los `127.0.0.1:8080` hardcodeados al inicio de cada script de
  `scripts/*-emulador.mjs` si hace falta, y revertí ambos al terminar.

**Slotly es el producto. SACIA es el estudio que lo desarrolla.** No mezclar.

### Modelo de venta: dos puertas de alta (18/09/2026 en adelante)

Hasta acá el onboarding era 100% manual: el cliente se contactaba, se cerraba
la venta, y la plataforma preparaba la cuenta desde `/super-admin` →
"Nuevo negocio". **Esa puerta sigue existiendo tal cual** (para quien prefiere
que se lo armen, o no tiene Gmail), pero ahora convive con una segunda:
**alta self-service** con prueba gratis, para quien quiere arrancar solo.

- **Manual** (`super-admin/NewBusinessModal.jsx` → `repository.js/createBusiness`,
  protegido en `firestore.rules` con `allow create: if isPlatform()`): la
  plataforma completa el formulario y entrega la cuenta lista.
- **Self-service** (`client/OnboardingPage.jsx` → Cloud Function
  `createBusinessSelfService`): quien entra con Google por primera vez y
  todavía no tiene negocio (antes caía en `/cuenta` sin más opción) ahora
  arranca ahí un asistente — mismas preguntas que el alta manual (rubro,
  color, plan) — y se convierte en dueño de un negocio nuevo con
  **~48 hs de prueba gratis** (aproximadas a 2 días corridos: el trial
  reutiliza el motor de facturación diario, que compara fechas calendario,
  no timestamps — no hay corrida más frecuente que una vez por día).
  `/cuenta` (`CuentaSinNegocio.jsx`) sigue existiendo como salida para quien
  prefiere WhatsApp en vez de autoservicio.

  Por qué esto SÍ necesita una Cloud Function (a diferencia del alta manual,
  que escribe directo a Firestore protegida por Rules): acá quien crea el
  negocio y quien se vuelve su dueño son la misma persona. El rol (`role:
  'owner'` + `businessId` en los custom claims) solo lo puede otorgar el
  Admin SDK — nunca un documento de Firestore, nunca el browser. Ver sección
  5a de `functions/index.js`.

  **Qué pasa si nunca se paga:** al vencer el trial, el motor de facturación
  normal (`runBilling`, ver más abajo) la suspende igual que a cualquier
  cuenta impaga. Si sigue suspendida **7 días** sin haber registrado nunca un
  pago (`billing.lastPaymentDate`), se borra sola —
  `procesarFacturacion` llama a `borrarNegocioInterno` (el mismo motor de
  borrado de `deleteBusiness`, factorizado para esto). **Esto SOLO alcanza a
  negocios con `signupSource: 'self_service'` que jamás pagaron ni un peso**:
  un cliente real que se atrasa con una factura nunca se toca por acá, eso lo
  decide una persona a mano desde el panel global.

  **Habilitar una cuenta** (self-service o manual) es el mismo camino que ya
  existía: el cliente avisa por WhatsApp que pagó, la plataforma registra el
  pago desde `/super-admin` (`recordPayment`, que descongela solo si la deuda
  queda en cero) o usa el botón "Habilitar" a mano. No hubo que construir
  nada nuevo para esta parte.

  **App Check (reCAPTCHA v3).** `createBusinessSelfService` es el único
  callable con `enforceAppCheck: true`: de todos, es el único que cualquier
  cuenta de Google puede llamar sin tener ya un negocio, así que es el que
  más conviene frenar de bots. Requiere generar un site key en
  [google.com/recaptcha/admin](https://google.com/recaptcha/admin) (tipo
  "reCAPTCHA v3"), registrarlo en Firebase Console → App Check → agregar app
  web, y poner ese site key en `VITE_RECAPTCHA_SITE_KEY` (local y Vercel).
  **Sin esa variable, el alta self-service rechaza toda llamada con
  "Tenés que iniciar sesión"** (así es como Firebase reporta un App Check
  faltante cuando `enforceAppCheck` está activo — no es un bug, es el
  comportamiento esperado sin la clave puesta). Verificado localmente
  desactivando `enforceAppCheck` de forma temporal (nunca commiteado): el
  resto de la lógica —negocio, slug, billing, claims, tema, horarios por
  defecto— funciona de punta a punta. Sin site key real no hay forma de
  probar la verificación de App Check en sí, ni siquiera con el emulador.

Consecuencias que siguen ordenando el diseño:

- No hay checkout de tarjeta ni cobro automático en ningún lado — ni acá ni
  en el alta manual. "Elegir un plan" en el asistente self-service anota una
  intención, no cobra nada.
- El CTA de la landing sigue yendo a **WhatsApp**: la puerta self-service se
  abre recién después de loguearse, no es el camino principal de venta.
- El alta (cualquiera de las dos) tiene que dejar la cuenta lista para tomar
  turnos — de ahí que el alta self-service ya cargue horarios por defecto
  (`HORARIO_POR_DEFECTO`, mismo horario que `DEFAULT_BUSINESS_HOURS` de
  `plans.js`, duplicado en `functions/index.js` por el mismo motivo que
  `timeToMinutes`/`slugify`/`PLANS`: `functions/` se despliega aparte de
  `src/` y no puede importar de ahí).

---

## Datos clave

| | |
|---|---|
| Repo | `github.com/JanoCobas09/Slotly` (rama `main`) — único vigente |
| Producción | **pendiente de configurar.** El deploy viejo (`barberos.sacia.tech`, Vercel, auto-deploy desde `cavanna11/BarberOS`) quedó congelado en su último commit — no recibe más cambios y no hay que tratarlo como el sitio real. Hay que armar un proyecto de Vercel nuevo apuntando a este repo cuando se vaya a producción. |
| Backend | **En migración de Firebase a Supabase** (19/09/2026 en adelante, rama `migration/supabase`) — ver "Migración a Supabase" más abajo. Mientras dure, `main` sigue sobre Firebase (proyecto `barberos-1d60e`, región `southamerica-east1`) y es la versión funcional del día a día; la migración no vive ahí hasta que esté terminada y probada. |
| Dueño de plataforma | `cavannaprogramacion@gmail.com` — claim `platform: true` ya asignado en Firebase. En Supabase hay que volver a asignarlo (ver la migración). |
| Consola Firestore (mientras `main` siga en Firebase) | `console.firebase.google.com/project/barberos-1d60e/firestore` |

Repos viejos, **ambos abandonados, no pushear ahí nunca más**:
- `cavanna11/BarberOS` — el origen de esta clonación. Se dejó de usar por
  decisión explícita (18/09/2026): de acá en adelante todo pasa por
  `JanoCobas09/Slotly`.
- `cavanna11/saciaTurnos` — más viejo todavía (tenía commits de un ex socio).

---

## Migración a Supabase (19/09/2026 en adelante)

Decisión del usuario: reemplazar Firebase entero (Firestore, Auth, Functions,
Messaging) por Supabase. Sin datos reales en juego (confirmado: todo lo que
hay hoy es de prueba), así que se va **directo, sin correr los dos en
paralelo** — apenas esté terminada y probada, esta rama se mergea a `main` y
Firebase se apaga. Vive en la rama `migration/supabase`, carpeta `supabase/`.

**Hecho y verificado — Fases 1 a 5 completas (23/09/2026):**

- **Fase 1 (esquema + RLS).** Las 14 colecciones de Firestore pasan a 17
  tablas relacionadas (`supabase/migrations/..._schema.sql`, más
  `..._fix_recovered_schema.sql`, auditado campo por campo contra lo que
  `src/` usa de verdad). `/slugs/{slug}` no se migró (era un mapa aparte
  solo porque Firestore no permite resolver un slug sin exponer `list()`;
  acá es una columna UNIQUE). RLS (`..._rls.sql`) traduce cada regla de
  `firestore.rules` con las mismas funciones helper (`isBusinessOwner` →
  `is_business_owner()`, etc.); los campos protegidos de `businesses` y la
  restricción de qué puede tocar un cliente al cancelar pasan a triggers
  `BEFORE UPDATE`. `supabase/rls_smoke_test.sql`, 12/12 casos.
- **Fase 2 (Auth).** `AuthContext.jsx` y `LoginPage.jsx` reescritos sobre
  `@supabase/supabase-js`, mismo contrato externo (`user.role`,
  `businessId`, `isPlatformOwner`...). Google OAuth es redirect completo
  (`signInWithOAuth`), no popup — el destino post-login se guarda en
  `sessionStorage` antes de salir. `test-claims.mjs`, 16/16 casos.
- **Fase 3 (Edge Functions).** Las 15 Cloud Functions invocables de
  `functions/index.js` traducidas a Edge Functions/funciones de Postgres —
  la única que falta a propósito es `enviarPushDePrueba`, que se resolvió
  recién en Fase 5 (no tenía sentido antes de que existiera Web Push).
  Incluye `process_billing()` (cron diario) y los triggers
  `handle_nuevo_turno`/`handle_turno_cancelado` (reemplazan
  `onNuevoTurno`/`onTurnoCancelado`). El scheduling de pg_cron para
  `run-billing`/`send-reminders` queda documentado y comentado en las
  migraciones — se activa recién en Fase 8 contra el proyecto real.
  `test-owner-accounts.mjs` 13/13, `test-billing.mjs` 10/10,
  `test-reminders.mjs` 8/8, `test-appointments.mjs` 6/6.
- **Fase 4 (datos + Realtime).** `repository.js`/`functions.js`
  reescritos sobre Supabase, mismo contrato externo exacto — `fromRow()`/
  `toRow()` traducen snake_case↔camelCase en un solo lugar.
  `BusinessSync.jsx` no necesitó ningún cambio (ya era agnóstico de
  Firestore). Realtime reemplaza `onSnapshot` con un adaptador
  (`liveTable`/`liveRow`) que reconstruye el estado completo a partir de
  los eventos incrementales de `postgres_changes` — Supabase no manda "la
  lista completa" como Firestore. Verificado en el navegador contra el
  stack local, no solo con scripts.
- **Fase 5 (Web Push).** Reemplaza FCM por Web Push estándar (VAPID):
  `public/sw.js` genérico, `lib/push.js` reescrito con el mismo contrato,
  dos Edge Functions nuevas (`send-push`, invocada por los triggers vía
  `pg_net`; `enviar-push-de-prueba`, el botón de la campanita).
  `test-push.mjs`, 9/9 casos (la entrega real a un dispositivo no se puede
  probar en este entorno: Chrome headless auto-deniega el permiso de
  notificaciones sin gesto de usuario real).

**Hallazgo importante de RLS (no obvio, costó una sesión entera
diagnosticarlo):** en Postgres, `UPDATE`/`DELETE` bajo RLS necesitan poder
"ver" la fila vía ALGUNA policy de `SELECT` antes de tocarla — su propia
policy de `USING` no alcanza sola, sin importar cuán permisiva sea (un
`DELETE ... USING (true)` sin ninguna policy de SELECT en la tabla borra 0
filas, no tira error). Afecta especialmente a cualquier `upsert()` con
`onConflict`: el `ON CONFLICT` necesita esa misma visibilidad para
detectar si ya existe una fila, así que hasta un `DO NOTHING` rebota con
"row-level security policy" si falta la policy de SELECT. Dos tablas lo
sufrieron (`push_subscriptions`, que no tenía NINGUNA policy de SELECT
a propósito — "nadie lee desde acá" — y `notification_reads`, que tenía
SELECT pero no UPDATE). Antes de agregar una policy de escritura
(`UPDATE`/`DELETE`/`upsert`) a una tabla nueva, verificar que también
tenga una de SELECT que cubra esas mismas filas — o, si de verdad no debe
haber lectura posible, usar `ignoreDuplicates: true` (`ON CONFLICT DO
NOTHING`) en vez de un upsert normal.

**Hallazgo importante de claves (24/09/2026, costó que los cron/triggers
fallaran en silencio con 401 durante horas — cero mails de recordatorio,
cero push):** un proyecto de Supabase nuevo (creado con el sistema de API
keys actual) tiene DOS claves de "service role" distintas. El dashboard y
el endpoint de siempre (`/v1/projects/<ref>/api-keys`) muestran la
"legacy" (JWT `eyJhbGci...`, `"id": "service_role"`) — esa sigue
funcionando para PostgREST (`supabaseAdmin()`, cualquier `.from(tabla)`
con la service role key), pero `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
**dentro de una Edge Function** ya no es esa: es la nueva,
`sb_secret_xxxxxxxxxxxxxxxxxxxxxxxx` (mismo endpoint con `?reveal=true`,
el objeto con `"type": "secret"`). Cualquier Edge Function que compare el
Bearer contra esa variable (send-push, run-billing, send-reminders — las
"solo el propio proyecto") rechaza silenciosamente el JWT legacy con 401,
aunque sea una key genuina y válida. El síntoma es indistinguible de una
key mal copiada — verificar siempre llamando a una función real, no solo
revisando que el string esté bien pegado. `app_settings.service_role_key`
y los dos `cron.job` tienen que llevar la `sb_secret_...`, no el JWT.

**Estado: migración completa y en producción (24/09/2026).** Fases 1 a 8
hechas: proyecto real de Supabase (`pwigjpqiwzyakwwzwthz`, región
`sa-east-1`), deploy en Vercel (`slotly-turnos.vercel.app`, rama `main`),
Google OAuth con un proyecto de Google Cloud propio (nunca el de
`barberos-1d60e`, que es de un tercero), cron activo (facturación diaria,
recordatorios cada 15 min), dueño de plataforma asignado. El login por
usuario/contraseña se sacó de la pantalla pública a pedido (solo queda
Google) — el alta manual de super-admin todavía puede crear un dueño con
contraseña, pero esa cuenta hoy no tiene desde dónde loguearse; sin
resolver todavía. `src/lib/firebase.js` ya no se importa en ningún lado
(Fase 6) pero el archivo y la dependencia `firebase` de `package.json`
siguen ahí a propósito, tal como decía el plan original.

**Mails post-lanzamiento (24/09/2026).** Además de la confirmación al
reservar (`create-appointment`) y el recordatorio 3hs antes
(`send-reminders`), ahora `handle_turno_cancelado` también dispara — vía
`pg_net`, fire-and-forget, mismo patrón que ya usaba para el push — la Edge
Function `notify-cancellation`, que le manda un mail al dueño (fila en
`admins` con `role='owner'`) cuando el CLIENTE cancela un turno (no cuando
cancela el staff, que ya lo sabe). Cubierto por
`supabase/tests/test-cancellation-notify.mjs` (5/5). No existe todavía una
forma de que el cliente EDITE/reprograme un turno (solo cancelar) — si se
agrega esa feature, extender el mismo trigger. `ConfirmationPage.jsx` ahora
avisa al cliente que revise spam si no ve el mail de confirmación.

**Instalación del panel + feedback de push (24/09/2026, solo para el
dueño/staff — el cliente nunca instala nada).** `beforeinstallprompt` se
escucha a nivel de módulo en `lib/installPrompt.js`, importado desde
`main.jsx` para registrarse ANTES de que exista ningún componente — si
solo se escuchara dentro de `AdminLayout` (que recién monta después del
login), un disparo mientras el dueño todavía está en `/login` se perdería
para siempre en esa carga de página (el evento sale una sola vez por
carga). `useInstallPrompt()` expone ese estado compartido. `AdminLayout`
muestra dos cosas, ambas solo si `!instalada` y solo para `isOwner`: un
banner descartable (`InstalarAppBanner.jsx`, "ahora no" persiste en
localStorage) y una entrada fija en el sidebar ("Instalar app") que sigue
ahí después de cerrar el banner — es el lugar fácil de encontrar. En iOS
(nunca dispara `beforeinstallprompt`) se muestran instrucciones manuales
("Compartir → Agregar a inicio"). Verificado en vivo con agent-browser
usando el bypass de login de dev: el evento nativo se capturó, el banner y
la entrada del sidebar aparecieron, y "cerrar sugerencia" persistió entre
recargas dejando la entrada del sidebar como único rastro. Además, activar
notificaciones push desde la campanita ahora también muestra un toast
flotante de 3s (`components/Toast.jsx`) — antes la confirmación solo vivía
dentro del panel desplegable, que se podía cerrar antes de leerla.

**Trampa de esta máquina:** Windows tenía reservado (`netsh interface ipv4
show excludedportrange protocol=tcp`) el rango `54140-54739` completo — justo
donde caen TODOS los puertos por defecto del stack local de Supabase
(54321-54329). Remapeados a `55321-55329` en `supabase/config.toml`. Mismo
síntoma que el remapeo de puertos del emulador de Firebase (más abajo en este
archivo), causa distinta: ahí era otro proceso ocupando el puerto, acá es
Windows reservándolo de antemano para Hyper-V/WSL2.

Para levantar el stack local: `npx supabase start` (requiere Docker Desktop
corriendo). Studio queda en `http://127.0.0.1:55323`.

---

## Levantar el proyecto en otra máquina

Git trae el código, **pero no trae lo que hace falta para que arranque**:

```bash
git clone https://github.com/JanoCobas09/Slotly.git
cd Slotly
npm install
```

Después, y esto es lo que siempre se olvida:

**1. Crear `.env` en la raíz.** Está en `.gitignore` a propósito (tiene el
client secret de Google). Sin él la app arranca, pero muestra la pantalla de
"Falta la configuración de Firebase".

- Las siete `VITE_*` están en **Vercel → Settings → Environment Variables**.
- El `GOOGLE_CLIENT_SECRET` (sin prefijo `VITE_`) está en Google Cloud Console →
  Credenciales. El frontend no lo usa; queda para cuando haga falta del lado
  del servidor.
- Estructura de referencia: `.env.example`.

**2. CLI de Firebase**, solo si vas a desplegar reglas o functions:

```bash
npm install -g firebase-tools
firebase login
```

`firebase login` abre el navegador y necesita interacción humana: **no lo puede
correr un agente**. Si `firebase projects:list` da `HTTP 401`, la credencial
guardada venció aunque `firebase login:list` siga mostrando la cuenta: se
arregla con `firebase login --reauth`.

`firebase.json` y `.firebaserc` **ya están en el repo**. No corras
`firebase init`: es interactivo y te los va a querer reescribir. `firebase.json`
declara `firestore`, `functions` y los emuladores, y **no declara Hosting a
propósito** — producción es Vercel, y con Hosting configurado un `firebase
deploy` pelado publicaría un sitio paralelo compitiendo con el de Vercel.

**3.** `npm run dev` → http://localhost:5173

**No hay estado local que migrar.** Los datos viven en Firestore, así que la
notebook ve exactamente lo mismo que la máquina de escritorio apenas entrás con
Google.

---

## Estado: qué funciona hoy

- Datos en **Firestore**. Ya no queda nada operativo en `localStorage`.
- Login con **Firebase Auth** (`signInWithPopup`). Permisos por custom claims.
- **Security Rules desplegadas y verificadas** contra el proyecto real.
- Multi-tenancy por slug: `/:businessSlug`.
- Panel global: alta de barberías, facturación, suspensión, tickets.
- Panel por barbería: staff, servicios, horarios, agenda, admins, soporte.
- Reserva pública con motor de disponibilidad. **Se mira sin cuenta**: el link
  muestra equipo, servicios y grilla; el login se pide recién al cargar los
  datos (paso 5), y al volver sigue donde estaba. El staff también agenda a
  mano desde Citas (para el cliente que pide por WhatsApp).
- El barbero (rol `admin`) edita su propia ficha y horarios, atiende su agenda
  (confirmar / completar / no asistió / cancelar / agendar) y abre tickets.
- El cliente puede cancelar solo hasta `minCancelHours` antes (Configuración);
  después tiene que escribir a la barbería. Se hace cumplir en el front.
- **Agenda del día** (`AgendaDelDia`): el inicio del panel, para dueño y
  barbero, es un calendario vertical del día — hora grande a la izquierda,
  cliente/servicio/teléfono a la derecha, acciones en cada turno, navegación
  por día y filtro por barbero. Pensado para leerse en el celular.
- **Notificaciones in-app** (campanita en el topbar): `onNuevoTurno` y
  `onTurnoCancelado` (triggers de Firestore en Functions) escriben en
  `businesses/{id}/notifications`; el dueño ve todas, el barbero las suyas;
  se marcan leídas por `leidaPor.{uid}`. Con permiso, también avisa por
  notificación del navegador. Cuando llegue WhatsApp, sale del mismo trigger.
  No se notifica lo que cargó el propio staff (`type` walkin/manual) ni lo
  que canceló el staff (`cancelledBy !== 'client'`).
- **Mobile**: todo el panel, la reserva y la landing verificados a 375px sin
  desborde horizontal. En el celular las citas son tarjetas (no tabla), las
  tablas de gestión esconden columnas secundarias (`.oculta-mobile`), las
  grillas inline de dos columnas pasan a una, y el stepper de reserva se
  reparte el ancho.
- Sistema de tickets de soporte (chat barbería ↔ plataforma).
- Landing pública de venta en la raíz.
- Identidad visual de SACIA aplicada.

---

## ✅ Blaze activo, Functions desplegadas

Desplegadas en `southamerica-east1`: `setBusinessAdmin`, `revokeBusinessAdmin`,
`applyPendingClaims`, `createAppointment`, `createOwnerWithPassword`,
`resetOwnerPassword`, `setPlatformModerator`, `deleteBusiness`, `getBusySlots`, los triggers
`onNuevoTurno` / `onTurnoCancelado` y `runBilling` (3 AM, hora de Buenos
Aires). Quedó puesta la política que borra imágenes de contenedor de más de un
día, para que no se acumule costo de almacenamiento.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://southamerica-east1-barberos-1d60e.cloudfunctions.net/setBusinessAdmin
```

`400`/`401` = desplegada y validando. `404` = se cayó el deploy.

El checklist post-Blaze está completo: el fallback de permisos de
`AuthContext` se sacó en la auditoría de seguridad. Sin claims, sos cliente.

### Moderadores

Equipo de soporte con acceso al panel global. Un moderador **ve todo y atiende
tickets**; **no** da de alta cuentas, no registra pagos, no cambia planes, no
suspende, no nombra moderadores y no lee el contacto personal del staff.

Lleva el claim `platform: 'moderator'` y NO `platform: true` a propósito: todo
lo que exige `platform === true` —Rules y functions— lo deja afuera por defecto,
y lo que puede hacer se le concede explícitamente con `esEquipoPlataforma()`.
Es la diferencia entre "tiene lo que se le dio" y "tiene todo salvo lo que se le
sacó".

Se nombran desde `/super-admin` → **Equipo** (pestaña que solo ve el dueño).
`setPlatformModerator` los crea, los quita (y les corta las sesiones), y usa el
mismo mecanismo de pendientes que los admins de barbería para quien nunca entró.

En el frontend: `user.isModerator`, `user.isPlatformTeam` (dueño o moderador).
El panel esconde lo que no puede hacer; la barrera real son las Rules.

### Entrar sin Gmail

En el alta se elige **cómo entra el dueño**: con su cuenta de Google, o con un
usuario y contraseña que genera la plataforma. Lo segundo es para el barbero que
no usa Gmail o no quiere mezclarlo con lo personal.

`createOwnerWithPassword` crea la cuenta y devuelve la contraseña **una sola
vez**: Firebase guarda el hash, no el texto. Si se pierde, se genera otra con
`resetOwnerPassword` (que además corta las sesiones abiertas con la vieja).

Crear cuentas es exclusivo de la plataforma. Un dueño puede dar de alta barberos
con `setBusinessAdmin`, pero no fabricar usuarios.

**Requiere habilitar el proveedor** en Firebase → Authentication → Sign-in
method → Email/Password. Sin eso, el login con contraseña falla con
`auth/operation-not-allowed` aunque la cuenta exista.

Los permisos no cambian en nada: son los mismos custom claims, y no saben con
qué proveedor entró la persona.

### Quien entra y no tiene negocio

Originalmente esto no tenía salida propia: el curioso que entraba a la
landing, tocaba "Iniciar Sesión" y se logueaba con Google volvía a la landing
**sin ningún mensaje**. Quedaba pensando que había fallado, y era justo el
lead más caliente.

Primero se arregló con `/cuenta` (solo WhatsApp). Ahora (ver "Modelo de venta"
más arriba) el destino por defecto es `/onboarding`, el alta self-service con
prueba gratis; `/cuenta` quedó como salida para quien prefiere que se lo
armen a mano.

Ojo con el detalle que casi rompe esto la primera vez: `Header` es compartido
entre la landing y la página de cada negocio. Si el link a `/login` no lleva
`state.from`, un cliente parado en `/su-negocio` que toca "Iniciar Sesión"
también terminaría en `/onboarding` en vez de volver a reservar. Por eso
`Header` y `MyAppointments` pasan su `pathname`, y `LoginPage` descarta `/` y
`/login` como orígenes — volver ahí es justamente el problema que esto
resuelve.

### Límite de barberos por plan

`maxBarbers` (en `config/plans.js`) ahora se hace cumplir: al llegar al tope, el
botón de agregar se deshabilita y aparece un aviso con el link para ampliar. Se
cuentan solo los ACTIVOS, así que desactivar a alguien que se fue libera el
lugar. Se compara al agregar y no al editar, para que una barbería que quedó por
encima del tope —porque le bajaron el plan— pueda seguir administrando a los que
tiene en vez de quedar trabada.

**Es un límite comercial, no una barrera de seguridad**: vive en la interfaz y
alguien con la consola abierta podría saltearlo. Igual que cualquier tope de
plan en una app de browser. Lo que protege los datos son las Rules, y la
cantidad de barberos no es un dato a proteger. Si algún día se cobra por
barbero de verdad, hay que moverlo a una Cloud Function.

### Cuentas de prueba

En el alta hay un campo **"Días de prueba sin cargo"**. Con un valor mayor a
cero, el negocio queda con `trialEndsAt` y el primer vencimiento cae ese mismo
día. Mientras dure, `runBilling` no le suma deuda ni lo suspende. Al día
siguiente entra a cobrarse por el camino normal y, si no paga, **se suspende
sola y el link deja de tomar turnos** — que es justamente lo que corta la
prueba.

El panel muestra un banner con los días restantes y, al vencer, uno que invita a
escribir por WhatsApp.

Con 0 días la cuenta se cobra desde el arranque, con el primer vencimiento a un
mes. **Nunca des una cuenta de regalo sin días de prueba**: con cualquiera de los
tres planes acumula deuda al mes y se congela sola.

```bash
node scripts/test-billing-emulador.mjs
```

11 casos: cobro, acumulación de varios vencimientos, suspensión, reactivación al
saldar, prueba vigente y prueba vencida.

### Quién puede asignar permisos

- **Plataforma**: todo. Designar dueños, mover gente entre negocios.
- **Dueño de una barbería**: solo dentro de SU `businessId` y solo rol `admin`
  (barbero). No puede designar otros dueños — el dueño es quien paga la cuenta,
  así que quién lo es es una decisión comercial y no se delega al tenant.

Lo hacen cumplir `assertCanManageAdmins` y `assertTargetEnAlcance` en
`functions/index.js`. **El segundo no es paranoia:** `setCustomUserClaims`
REEMPLAZA todos los claims, no los mergea. Sin ese chequeo, el dueño de una
barbería podía llamar `setBusinessAdmin` con el mail de la plataforma y borrarle
el claim `platform`, dejando el panel global sin nadie que pudiera entrar.

Para verificarlo sin tocar producción (20 casos, incluidos todos los rechazos):

```bash
firebase emulators:start --only auth,firestore,functions
node scripts/test-claims-emulador.mjs
```

Y para las Security Rules, 40 casos de aislamiento (dos barberías, dueño,
barbero, cliente, anónimo) contra el emulador:

```bash
node scripts/auditar-rules-emulador.mjs
```

Pasan 38. Los 2 que "fallan" son a propósito: el precio del turno (lo resuelve
`createAppointment`, y el caso queda esperando `denegado` recién después del
paso 3 del checklist) y el alcance del barbero, que sigue sin decidirse.


### Validación de turnos (`createAppointment`)

El motor de disponibilidad del browser pinta la grilla, pero no puede ser la
única autoridad: con la consola abierta se saltea. Verificado contra el
emulador, escribiendo directo a Firestore se podía crear un turno con `price: 0`,
con fecha en 2020, con un profesional inexistente y **en una barbería suspendida
por deuda** — que es justamente la palanca de cobro.

`createAppointment` revalida todo del lado del servidor. El precio y la duración
salen del documento del servicio, nunca del cliente. El solapamiento se chequea
dentro de una transacción, porque dos personas mirando la misma grilla pueden
confirmar con milisegundos de diferencia.

```bash
node scripts/test-reservas-emulador.mjs
```

35 casos: precio falsificado, fecha pasada, profesional y servicio inexistentes,
servicio que ese profesional no hace, fuera de horario, en el descanso, día que
no trabaja, teléfono inválido, un turno por día, doble reserva, negocio
suspendido, sin sesión, tope de turnos a futuro y `getBusySlots`.

**Tope por cuenta.** Además de un turno por día, una cuenta no puede tener más
de `MAX_TURNOS_ACTIVOS` (3) turnos activos de hoy en adelante en la misma
barbería. Es lo que hace inútil llenarle la agenda al barbero con una sola
cuenta. Los pasados no cuentan aunque hayan quedado `pendiente`; los cancelados
tampoco. Se cuenta en la misma transacción, con una sola lectura por `userId`
filtrada en memoria — a propósito: un `where` por uid + rango de fecha pediría
un índice compuesto que el emulador no exige y producción sí.

**`getBusySlots`.** Devuelve `{ ocupados: [{ startTime, endTime }] }` de un
profesional en un día. Existe porque al cerrar la agenda a los clientes en las
Rules (correcto: tiene datos de otros), la grilla del cliente quedó ciega —
mostraba libre lo que ya estaba tomado y cada reserva moría en "ese horario ya
fue tomado". `BookingPage` la llama al elegir profesional y día. No expone ni
un campo más que las horas.

**Turno agendado por el staff.** `NuevoTurnoModal` (botón "Agendar turno" en
Citas) escribe directo a Firestore, NO por la function: la function cuenta los
turnos del uid que llama, y frenaría al barbero en el cuarto que cargue. Las
Rules ya permiten al staff crear en su propia agenda. Nace `pendiente` y se
confirma acto seguido. Lleva `type: 'manual'` y `userId` del que lo cargó.

---

## Seguridad — modelo y auditoría (17/09/2026)

**Modelo.** Los permisos son custom claims escritos solo por Functions con el
Admin SDK; las Rules los verifican en cada lectura y escritura; el frontend
solo esconde. Ya **no hay fallback** de permisos en `AuthContext`: sin claims,
sos cliente. Todo lo que un cliente puede escribir sobre la agenda pasa por
`createAppointment`. Los datos públicos (negocio, staff, catálogo, horarios)
no tienen nada personal; lo personal (contacto del staff, facturación, turnos)
está cerrado por rol.

**Qué se auditó y qué se arregló:**

- **Prueba gratis editable por el dueño (alta).** `runBilling` lee
  `trialEndsAt` del documento público del negocio, y ese campo no estaba en la
  lista de campos que el dueño no puede tocar: con la consola abierta se ponía
  la prueba en 2099 y no pagaba nunca. Protegido en Rules (`trialEndsAt`,
  `createdAt`, `maxBarbers`).
- **Robo de permisos pendientes (alta).** La API pública de Firebase Auth deja
  crear cuentas de email+contraseña con cualquier mail, sin verificarlo.
  `applyPendingClaims` entregaba el rol pendiente a quien tuviera ese mail en
  el token, y `setBusinessAdmin` se lo daba directo a una cuenta ya existente.
  Ahora los dos exigen `email_verified` (Google verifica; las cuentas que crea
  la plataforma nacen verificadas; las de un intruso, no).
- El staff no puede crear turnos con el `userId` de otra cuenta (le aparecían
  en "Mis citas" a esa persona).
- El cliente solo cancela turnos vivos (`pendiente`/`confirmada`); antes podía
  pasar uno `completada` a `cancelada` y tocar la caja.
- `clientEmail` del turno sale del token, no del cuerpo de la llamada.
- Contraseñas que crea la plataforma: mínimo 8 (era 6).
- Cabeceras en Vercel: HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy. Sin CSP todavía (Firebase + fuentes de Google lo hacen
  delicado; hacerlo en modo report-only primero).
- Dependencias: `functions/` subido a firebase-admin 14 y firebase-functions 7,
  con `overrides` de `uuid` → **0 vulnerabilidades** en las dos raíces.
- Verificado: no hay secretos en el repo ni en su historia (`.env` y
  `serviceAccountKey.json` ignorados; la API key web es pública por diseño);
  el bypass de login de desarrollo no está en el bundle de producción; no hay
  `innerHTML`/`eval`; los `from` del login son estado interno, no URL.

**Lo que hace falta hacer a mano en la consola de Firebase (Authentication →
Settings):**

1. **User actions → desactivar "Enable create (sign-up)"**: nadie se registra
   solo, las cuentas las crea la plataforma o entran con Google. Es la
   barrera de primer orden contra el robo de pendientes (el `email_verified`
   es la de segundo).
2. **Activar "Email enumeration protection"**: sin eso, el endpoint de login
   dice si un mail existe o no.
3. **Password policy**: mínimo 8, mayúscula y número, para las cuentas con
   contraseña.

**Lo que queda, en orden:**

- **App Check (reCAPTCHA v3)** sobre los callables: hoy `getBusySlots` es
  pública y `createAppointment` exige login pero no que la llamada venga de
  la web real. `maxInstances: 10` acota el costo, no el abuso.
- **Cancelación del cliente**: `minCancelHours` se hace cumplir solo en el
  front (las Rules no pueden comparar strings de fecha con `request.time`).
  Si importa, mover la cancelación a un callable.
- **Bloquear cliente** desde el panel, para la cuenta que se porta mal.
- CSP en report-only.

Cómo repetir la auditoría técnica: las cuatro suites del emulador (92 casos
de Rules cubren aislamiento, auto-beneficio, robo de pendientes y batches),
`npm audit --omit=dev` en la raíz y en `functions/`,
`git grep -nE "AIza|PRIVATE KEY|GOCSPX"`, y `grep -c "ACCESO R" dist/assets/*.js`
después de un build (tiene que dar 0).

---

## Arquitectura — mapa mínimo

```
src/
├── lib/
│   ├── firebase.js       Init. Exporta firebaseListo y faltanVariables.
│   └── repository.js     ⭐ ÚNICO lugar que habla con Firestore
├── contexts/
│   ├── BusinessSync.jsx  ⭐ ÚNICO lugar que abre suscripciones onSnapshot
│   ├── BusinessContext   Estado (reducer). Ya casi no persiste nada.
│   ├── AuthContext       Login + claims, con fallback transitorio
│   └── BookingContext    Wizard de reserva (estado de UI, no datos)
├── hooks/
│   ├── useCurrentBusiness.js  Resuelve qué negocio corresponde
│   └── useTenantData.js       Lectura del contexto, sin lógica
├── config/
│   ├── platform.js       PLATFORM_OWNERS (comodidad de UI, NO seguridad)
│   ├── plans.js          Planes comerciales — fuente única de precios
│   ├── seedData.js       Estado inicial vacío
│   └── theme.js          Tema white-label por negocio
├── pages/
│   ├── LandingPage.jsx   Landing pública
│   ├── client/           Reserva en /:businessSlug
│   ├── admin/            Panel del negocio
│   └── super-admin/      Panel global
└── utils/
    ├── availabilityEngine.js   ⚠️ NO TOCAR — anda
    └── statsCalculator.js      ⚠️ NO TOCAR — anda
```

### Reglas de oro

1. **Ningún componente habla con Firestore directo.** Todo por `repository.js`.
2. **Las suscripciones viven solo en `BusinessSync`.** Si cada hook abriera su
   listener, el mismo documento se cobraría una vez por componente montado.
3. **`availabilityEngine.js` y `statsCalculator.js` reciben arrays por
   argumento y no saben de dónde salen.** Mantenerlos así.
4. **El filtro del frontend NO es seguridad.** Lo que aísla los negocios son
   las Security Rules + custom claims. Nunca presentarlo como protección.

### Modelo de datos en Firestore

```
/slugs/{slug}                     → { businessId }        ⚠️ lectura pública
/businesses/{id}                  → marca, horarios, isFrozen, trialEndsAt,
                                     signupSource, frozenAt  ⚠️ pública
  /private/billing                → deuda, abono, lastPaymentDate 🔒 solo plataforma
  /professionals /services /schedules /professionalServices   ⚠️ públicas
  /staffContacts/{profId}         🔒 teléfono y mail del staff — NO va en
                                     /professionals, que es de lectura pública
  /appointments                   🔒 staff + dueño del turno
  /notifications                  🔒 dueño todas; barbero las suyas. Las
                                     escribe un trigger; el browser solo
                                     marca leídas
  /pushTokens/{token}             🔒 cada quien escribe/borra el suyo; NADIE
                                     lee del browser, solo el trigger (Admin
                                     SDK) que manda el push
  /admins/{email}                 🔒 registro para UI, NO otorga permiso
/tickets/{id}                     🔒 su barbería + plataforma
  /messages/{id}
/platform/{doc}                   🔒 solo plataforma
/pendingAdmins/{email}            🔒 claims de quien no entró todavía
```

**Por qué la facturación va aparte:** el documento del negocio es de lectura
pública (la página de reservas necesita nombre, colores y horarios antes del
login). Si `debt` viviera ahí, cualquier cliente la leería.

**Por qué `/slugs` existe:** resolver `/barberia-x` sin ese mapa obligaría a
permitir listar toda la colección `businesses` — y ahí cualquiera se baja la
cartera de clientes.

**Por qué `/tickets` es de primer nivel y no subcolección:** para que el panel
global los liste con una query simple, sin `collectionGroup` ni su índice.

---

## Trampas ya pagadas (no volver a descubrirlas)

- **Firestore lee del caché.** Un `getDocs` que devuelve 0 documentos NO prueba
  que la base exista ni que las reglas permitan. Verificar con
  `getDocsFromServer` o por REST.
- **Los custom claims tardan hasta 1 hora** en aparecer en el token. Después de
  asignar uno hay que llamar `getIdToken(true)` o cerrar y abrir sesión.
- **Vite congela las `VITE_*` al compilar.** Agregarlas en Vercel no alcanza:
  hace falta un build nuevo.
- **`vercel.json` valida contra un esquema estricto** y rechaza propiedades
  extra. No poner comentarios `//` como en `package.json`.
- **Es una SPA:** sin la reescritura de `vercel.json`, toda ruta que no sea la
  raíz da 404 de Vercel.
- **Firestore no borra en cascada.** Al eliminar un profesional o servicio hay
  que limpiar a mano lo que cuelga (`replaceMatching(..., [])`).
- **El bypass de login (`import.meta.env.DEV`) ya no sirve para nada** que toque
  Firestore: no es sesión de Firebase, las Rules lo rechazan.
- **La consola del navegador acumula errores entre navegaciones.** Antes de
  diagnosticar, recargar limpio.
- **En alguna máquina de desarrollo la carpeta del proyecto puede quedar
  anidada** (ej. `codesSYNC/BarberOS/BarberOS`, herencia de un sync de iCloud
  en la máquina original). `firebase.json` vive en la carpeta del proyecto de
  verdad, no en la de afuera — corrido desde el nivel equivocado, cualquier
  `firebase deploy` falla con *"Not in a Firebase app directory"*. Verificá
  con `ls firebase.json` antes de desplegar, sea cual sea la ruta en tu
  máquina.
- **Los reemplazos por script fallan con CRLF.** Varios archivos tienen finales
  de línea Windows; usar la herramienta Edit o verificar siempre el resultado.
- **En Rules, `request.query.limit` es `null` si la query no puso límite**, y
  `null <= 100` es un error de tipos que cuenta como denegado. Peor: condicionar
  un `list` al límite no verifica de quién son los datos. La regla de
  `appointments` tenía las dos cosas — un cliente logueado con un `limit` se
  llevaba nombre y teléfono de todos los turnos del negocio, y "Mis Citas"
  fallaba para todos. Para listados de a-uno-mismo la condición va sobre
  `resource.data`, no sobre la forma de la query.
- **Que una regla permita la consulta correcta no prueba que la app la haga.**
  `subscribeMyAppointments` existió desde el principio, la auditoría probó que
  las Rules la permiten, y nadie la llamaba: `BusinessSync` pedía la agenda
  entera para el cliente, las Rules se la negaban, y "Mis citas" estuvo vacío
  para todos hasta que un usuario real lo notó. Ahora la suscripción se arma por
  rol (dueño todo, barbero lo suyo, cliente lo suyo, anónimo lo público). Si
  agregás una regla con `resource.data`, revisá quién hace la consulta.
- **En un batch, `get()` en las Rules ve el estado ANTERIOR al batch.** El
  ticket y su primer mensaje se escriben juntos; la regla del mensaje hacía
  `get(ticket).data.businessId`, el ticket todavía no existía, y `.data` de
  null revienta → denegado. Nadie podía abrir un ticket. Para leer otro doc
  del mismo batch es `getAfter()`. La suite de rules ahora prueba el batch tal
  como lo manda la app (`commit` en `auditar-rules-emulador.mjs`).
- **Las suites comparten `biz-test` en el emulador.** Un seed a mano (o la
  suite de claims) que deje horarios o servicios de más rompe "día que no
  trabaja" y "servicio que no hace" en la de reservas. Cada suite limpia sus
  subcolecciones al arrancar; si agregás una, hacé lo mismo.
- **`new Date().toISOString()` es UTC.** A partir de las 21:00 en Argentina
  ya es mañana: el walk-in y "Hoy" del panel caían en el día equivocado. Para
  fechas locales, `toDateString(new Date())` de `dateUtils`.
- **Los Timestamps de Firestore no son fechas de JS.** `new Date(timestamp)` da
  `Invalid Date`. Es `timestamp.toDate()`.
- **El primer deploy de un trigger de Firestore falla con "Permission denied
  while using the Eventarc Service Agent".** Es la primera vez que el
  proyecto usa Eventarc y los permisos tardan unos minutos en propagarse.
  Esperar 2 minutos y repetir `firebase deploy --only functions:<nombre>`.
- **Dos `match` sobre la misma ruta se SUMAN.** Si cualquiera permite, pasa.
  Había un `match /notifications` viejo (log de WhatsApp que nunca existió)
  que le daba lectura a todo el staff, y anulaba el nuevo que filtra por
  barbero. Antes de agregar un match, `grep "match /"` para ver si ya existe.
- **Los turnos guardan la fecha en `appointmentDate`, NO en `date`.** Todo el
  código lo usa así (`BookingPage`, `AppointmentsPage`, `DashboardPage`,
  `MyAppointments`, `availabilityEngine`). Sembrar datos de prueba con `date`
  hace que el motor de disponibilidad no bloquee los slots y parezca un bug de
  doble reserva que no existe.
- **En las Functions, nunca `admin.firestore.FieldValue`.** El emulador envuelve
  `firebase-admin` en un proxy para interceptar `initializeApp` y en el camino
  pierde los namespaces perezosos: llega `undefined` y revienta recién en
  runtime, adentro del callable. Usar siempre los submódulos
  (`require('firebase-admin/firestore')`). Este bug estaba en el código desde
  el principio y no se veía porque las functions nunca se habían ejecutado.
- **Listar un módulo en `manualChunks` lo mete en el bundle aunque nadie lo
  importe.** Así entraba `firebase/storage`, para una feature que todavía no
  existe. Agregar ahí solo lo que de verdad se usa.
- **Un `npm run dev` con HMR arrastra módulos viejos.** Después de tocar
  `src/lib/firebase.js` la consola puede mostrar errores de la versión anterior
  (se reconocen por el `?t=` en la URL del stack). Abrir pestaña nueva antes de
  diagnosticar; `vite.config.js` sí reinicia el server solo.

---

## Verificación rápida sin abrir el navegador

La API key es pública por diseño (va en el bundle).

```bash
KEY=AIzaSyA2utnIdWsuBuxBhzGis_e1quOtbB11nUQ
BASE="https://firestore.googleapis.com/v1/projects/barberos-1d60e/databases/(default)/documents"

# Sin login: 404 = la regla permitió (doc no existe) | 403 = denegado
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/businesses/x?key=$KEY"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/businesses?key=$KEY"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/tickets/x?key=$KEY"
```

Esperado: `404`, `403`, `403`. (Esto habla directo con Firestore, no con
ningún dominio — sigue funcionando igual aunque no haya producción de Slotly
desplegada todavía.)

Qué está desplegado en producción (reemplazar `TU-DOMINIO` por el dominio real
una vez que exista un deploy de Vercel apuntando a este repo — hoy no hay
ninguno):

```bash
B=$(curl -s https://TU-DOMINIO/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://TU-DOMINIO$B" | grep -c "TEXTO_A_BUSCAR"
```

---

## Próximos pasos, en orden

### Manual — nadie más lo puede hacer

1. **Trámite de Meta para WhatsApp** — tarda 1-2 semanas, conviene arrancarlo en
   paralelo con lo demás. Hasta entonces la landing lo marca "pronto".
2. **Ensayo en producción.** Todas las suites corren contra emulador; el
   recorrido completo en producción real (alta con días de prueba → dueño
   carga servicios/barberos/horarios → cliente reserva desde incógnito → se ve
   en el panel y en "Mis citas") nunca se hizo.
2b. **Clave VAPID para notificaciones push (FCM)** — Firebase Console →
    Project Settings → Cloud Messaging → "Certificados push web" → generar
    par de claves. Copiar la clave pública a `VITE_FIREBASE_VAPID_KEY` (local
    y en Vercel) y volver a desplegar. Sin esto el botón "Activar
    notificaciones push" de la campanita (`CampanaNotificaciones.jsx`) falla
    con un mensaje claro, no rompe nada — pero nadie recibe push hasta que
    esté. Messaging no tiene emulador: no se puede probar en local con
    `VITE_USE_EMULATORS=true`, solo contra un deploy real (o `npm run dev`
    apuntando a Firebase real). Una vez activo el push en un dispositivo,
    aparece un botón "Mandarme una notificación de prueba" (callable
    `enviarPushDePrueba`) para validar que llega sin tener que esperar un
    turno real o cancelar uno a propósito — manda SOLO a los tokens de quien
    lo aprieta, nunca a otra cuenta, así que no hace falta restringirlo a un
    rol puntual.
2c. **Site key de reCAPTCHA v3 para App Check** — sin esto, el alta
    self-service (`/onboarding`) no funciona ni en producción ni contra el
    emulador: `createBusinessSelfService` exige `enforceAppCheck` y rechaza
    toda llamada con "Tenés que iniciar sesión" (así reporta Firebase un App
    Check faltante). Generar un site key en
    [google.com/recaptcha/admin](https://google.com/recaptcha/admin) (tipo
    "reCAPTCHA v3", con el dominio de producción), registrarlo en Firebase
    Console → App Check → agregar app web, y poner ese site key en
    `VITE_RECAPTCHA_SITE_KEY` (local y Vercel). Ver "Modelo de venta" más
    arriba para el detalle completo.

Ya resueltos y verificados: Email/Password habilitado, alcance del barbero
cerrado en Rules. El dominio `barberos.sacia.tech` estaba autorizado en
Firebase Auth (Authentication → Settings → Authorized domains) porque era el
deploy viejo de `cavanna11/BarberOS` — cuando exista el dominio real de
Slotly hay que agregarlo ahí también (no hace falta sacar el viejo, un
dominio de más autorizado no es un agujero de seguridad, solo ruido).

### Producto — hace falta decidir antes de programar

3. **Días de demo.** La landing dice `DIAS_DEMO = 10`; en el alta se tipean cada
   vez. Elegir un número y usar siempre ese.
4. **Planes.** Lo único que el sistema hace cumplir es `maxBarbers`. La landing
   ya lo refleja: cada tarjeta muestra solo lo que la diferencia (barberos,
   cuota de avisos "pronto", soporte) y lo común va en un bloque aparte
   (`FEATURES_COMUNES`). Cuando lleguen los avisos por WhatsApp, la cuota es la
   segunda diferencia real. No restar funciones al Básico para diferenciar.
5. **Seña por Mercado Pago.** No empezado. El modelo correcto es OAuth de
   Mercado Pago ("Conectar con Mercado Pago" en Configuración): el dueño
   autoriza con su cuenta, MP le da a la plataforma un token de SU cuenta y la
   plata va directo a él, sin que nadie tipee credenciales. Hace falta antes:
   una aplicación creada en el panel de desarrolladores de MP (client_id +
   client_secret como secrets de Functions, redirect URL), y decidir monto de
   seña (fijo o %), qué pasa si no paga en N minutos (se libera el turno) y
   si se devuelve al cancelar. Se construye recién con las credenciales, para
   probarlo de verdad.
6. **Abuso de reservas.** Hecho: un turno por día y tope de 3 a futuro por
   cuenta. Falta, por orden: bloquear cliente desde el panel (para la cuenta que
   se porta mal), y App Check con reCAPTCHA v3 sobre los callables para frenar
   scripts. Ninguno hace falta para la demo con amigos.

### Técnico, cuando haya tiempo

7. Sacar el SDK de Firebase del camino crítico de la landing. **El split por
   rutas ya está hecho**: lo que falta es otra cosa. Hoy quien entra a ver
   precios baja 265 kB gzip, de los cuales 164 kB son Firebase, que la landing
   no usa. Sin él serían 101 kB — 62% menos. `App.jsx` importa `LoginPage` eager
   y los tres contexts importan firebase a nivel de módulo, así que hay que
   desmontar los providers de la raíz y montarlos dentro de las rutas de app.
8. Revisar `src/components/landing/HeroMotionMockup.jsx` y
   `FloatingActionWidget.jsx` (generados por Antigravity, sin auditar).
9. Monitoreo global de turnos: hoy la pestaña del panel global solo muestra el
   negocio activo. Necesita `collectionGroup` + regla nueva.
10. ~~Sacar el fallback de permisos de `AuthContext`~~ Hecho en la auditoría
    de seguridad.
11. Los 3 errores de lint que quedan son `react-refresh/only-export-components`
   en los contexts: mover los hooks a otro archivo toca todos los imports y no
   cambia el comportamiento. Con eso el lint queda en cero y se puede poner CI.
12. ~~Borrado en cascada~~ Hecho: `deleteBusiness` (solo dueño de plataforma,
    con el nombre exacto como confirmación) borra negocio, subcolecciones,
    slug, tickets, pendientes, y les vacía los claims a todos los usuarios
    del negocio. Botón "Eliminar barbería" en el panel global.
    `deleteBusinessRecord` de repository.js quedó sin uso.
13. Subir logo por barbería (Firebase Storage).
14. ~~PWA.~~ Hecho: `public/manifest.webmanifest` + íconos + Service Worker
    (`public/firebase-messaging-sw.js`, registrado desde `src/lib/push.js`
    solo en producción — en dev un SW propio genera más lío de caché que
    beneficio). Instalable en el celular del dueño/staff. El push de verdad
    (FCM) manda desde el mismo trigger `onNuevoTurno`/`onTurnoCancelado` que
    ya escribía la notificación in-app; falta la clave VAPID real (ítem 2b) y
    probarlo en un deploy — el manifest, los íconos, el SW y la lógica de
    Rules/Functions ya están, verificados con `npm run build` + `npm run
    lint`, pero un push real necesita el proyecto de Firebase de verdad.

---

## Cómo probar sin tocar producción

```bash
firebase emulators:start --only auth,firestore,functions
node scripts/test-claims-emulador.mjs      # permisos y cuentas con contraseña
node scripts/test-reservas-emulador.mjs    # validación de turnos
node scripts/test-billing-emulador.mjs     # cobro, suspensión y prueba gratis
node scripts/auditar-rules-emulador.mjs    # aislamiento entre barberías
```

Hoy: claims 64, reservas 35, facturación 11, rules 92. Todo en verde.

---

## Qué NO hacer

- ❌ NO construir checkout de tarjeta ni cobro automático — el alta
  self-service (ver "Modelo de venta") existe, pero "elegir un plan" ahí
  anota una intención, nunca cobra
- ❌ NO dejar que `createBusinessSelfService` (o cualquier función nueva que
  otorgue un rol) escriba el claim desde un documento de Firestore en vez del
  Admin SDK — es la escalada de privilegios que todo este modelo evita
- ❌ NO leer Firestore desde un componente: siempre por `repository.js`
- ❌ NO abrir `onSnapshot` fuera de `BusinessSync`
- ❌ NO tocar `availabilityEngine.js` ni `statsCalculator.js`
- ❌ NO commitear `.env` ni `serviceAccountKey.json`
- ❌ NO presentar el filtro del frontend como aislamiento de seguridad
- ❌ NO inventar testimonios, logos de clientes ni métricas en la landing:
  todavía no hay clientes
- ❌ NO usar violeta ni azul para la identidad de SACIA/el preset `beauty`: su
  paleta es naranja `#e03d00` sobre casi-blanco. Las demás categorías de
  `professionPresets.js` sí usan otros colores a propósito (ver
  generalización a multi-rubro, más arriba) — esta regla es sobre la marca
  de SACIA/barbería, no un límite global de la paleta del producto

---

## Identidad visual

**Dirección de marca: "Warm Utility"** (19/09/2026 en adelante). Software
profesional con calidez, no el azul/violeta/gradiente/glassmorphism que usa
cualquier SaaS genérico armado con IA. La diferenciación sale de color,
tipografía, proporciones y espaciado — no de efectos visuales.

- Marca: petróleo/teal `#28706f` · hover `#1f5957` · variante clara `#5aafa0`
  (sidebar oscuro, resaltes) · acento terracota `#c87957`
- Fondos: `#fafaf7` base cálido, `#f2efe8` secciones alternadas, `#ffffff`
  tarjetas
- Texto: `#202524` / `#565c59` / `#9aa19b`
- Tipografías: **Plus Jakarta Sans** (todo el texto, pesos 400 a 800) —
  elegida en vez de Inter/Roboto/Poppins a propósito, para no sumarse al
  look de cualquier SaaS generado por IA — y **Space Mono** (etiquetas en
  mayúscula, tracking amplio)
- Radio de esquinas: 6/8/8/12px según el elemento (ya venía así, no hizo
  falta tocarlo). Sombras sutiles, pocos niveles. **Sin degradados en la
  marca** — había tres lugares (`.avatar`/círculo de iniciales, encabezado de
  resumen, barra de progreso de WhatsApp) que mezclaban `--primary` y
  `--secondary` en diagonal; se aplanaron a color sólido.

Esta es la identidad de **plataforma**: lo que ve la landing, el login, y
cualquier pantalla sin un negocio activo (`resolveBusinessContext(null)`
resuelve al preset `general`, que usa estos mismos valores — ver
`professionPresets.js`). Cada negocio pisa esto con su propio tema desde
`/admin/configuracion`, o hereda el preset de su rubro (ver "Generalización a
multi-rubro" más arriba). La única excepción deliberada es el preset
`beauty`, que conserva el naranja histórico de SACIA — ver la regla "NO usar
violeta ni azul..." en la sección "Qué NO hacer".

Todo sale de variables CSS en `:root` de `src/index.css`, con el mismo juego
de valores replicado en `defaultTheme` de `src/config/theme.js` (el comentario
de ese archivo lo recuerda: "si cambiás uno, cambiá el otro"). Cambiar ahí,
no en los componentes.

---

## Documentos del repo

| Archivo | Confiabilidad |
|---|---|
| `CLAUDE.md` (este) | ✅ al día |
| `FIREBASE_SETUP.md` | ✅ guía de migración, sirve de referencia |
| `ROADMAPdesde2352026.md` | ⚠️ actualizado, pero el histórico de sprints tiene ruido |
| `PROJECT_CONTEXT.md` | ❌ **desactualizado**, describe el diseño original de un solo negocio |
| `BRIEF-BARBEROS.md` | ❌ **histórico de la era BarberOS/`cavanna11`** — marca, dominio y número de WhatsApp viejos. No usar como fuente de nada vigente. |

Ante cualquier duda, **el código manda sobre los documentos**.
