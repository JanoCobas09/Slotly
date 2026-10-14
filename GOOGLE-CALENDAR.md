# Google Calendar — puesta en marcha y verificación de Google

Qué hace (detalle técnico en `CLAUDE.md` ítem 5w): cada profesional conecta
su Google Calendar (Configuración para el dueño, "Mi configuración" para el
profesional). Desde ahí:

- Cada turno se **crea, mueve y borra** solo en su calendario (y en su celular).
- Lo que tenga **ocupado** en su calendario no se ofrece para reservar.

Todo el código ya está hecho y probado (`supabase/tests/test-google-calendar.mjs`,
58/58 contra un Google falso). Falta lo que solo podés hacer vos, en este orden.

---

## 1. Google Cloud (unos 20 minutos)

Usá el **mismo proyecto de Google Cloud de Slotly** que ya tiene el login con Google.

1. **Habilitar la API:** APIs y servicios → Biblioteca → buscar
   **Google Calendar API** → Habilitar.
2. **Cliente OAuth:** Google Auth Platform → Clientes → el cliente
   "Aplicación web" que ya usa el login (o uno nuevo del mismo tipo).
   En **URIs de redireccionamiento autorizados** agregar:
   ```
   https://slotly-turnos.vercel.app/api/google-calendar/callback
   ```
   (Vercel la reenvía a la Edge Function `gcal-oauth-callback`; así la
   dirección es del dominio de la app y no de `supabase.co`.)
   Copiá el **ID de cliente** y el **secreto**.
3. **Acceso a datos:** Google Auth Platform → Acceso a datos → Agregar o
   quitar permisos → agregar
   `https://www.googleapis.com/auth/calendar.events`
   ("Ver y editar eventos en todos tus calendarios").
4. **Marca (Branding):**
   - Nombre: Slotly · Logo · Mail de asistencia: slotly.turnos@gmail.com
   - Página principal: `https://slotly-turnos.vercel.app`
   - Política de privacidad: `https://slotly-turnos.vercel.app/privacidad`
   - Dominios autorizados: `slotly-turnos.vercel.app` (más los que ya tenga el login).
5. **Público (Audience):** que esté **"En producción"**, NO "En prueba".
   En prueba solo pueden conectarse los mails que cargues a mano y la
   conexión se corta sola a los 7 días.

## 2. Supabase (lo hago yo con tu OK, o lo corrés vos)

```bash
npx supabase secrets set \
  GOOGLE_CLIENT_ID=<id de cliente> \
  GOOGLE_CLIENT_SECRET=<secreto> \
  GOOGLE_REDIRECT_URI=https://slotly-turnos.vercel.app/api/google-calendar/callback
npx supabase db push --linked
npx supabase functions deploy gcal-conexion sincronizar-google get-busy-slots create-appointment
npx supabase functions deploy gcal-oauth-callback --no-verify-jwt
```

Y push a `main` (Vercel publica la tarjeta, la página `/privacidad` y el
reenvío del callback).

Se puede publicar todo esto **antes** de cargar los secrets: la tarjeta
aparece y "Conectar" responde "todavía no está configurado". Nada más cambia.

## 3. Ya anda (hasta 100 usuarios)

Desde acá ya se puede usar. Mientras Google no verifique la app:

- Al conectar, Google muestra **"Google no verificó esta app"**. Se sigue con
  **Configuración avanzada → Ir a Slotly**. La tarjeta del panel ya lo explica
  (cuando Google apruebe, poner `GOOGLE_VERIFICO_LA_APP = true` en
  `src/components/admin/GoogleCalendarCard.jsx` y el aviso desaparece).
- Tope de **100 cuentas** que conecten, en total.

## 4. Verificación de Google (en paralelo; de 1 a 6 semanas)

Google Auth Platform → Centro de verificación → **Enviar para verificación**.
Te va a pedir:

### a) Dominio verificado
Verificar `slotly-turnos.vercel.app` en
[Google Search Console](https://search.google.com/search-console) (propiedad
de tipo "Prefijo de URL", con el archivo HTML que te dan: se pone en
`public/` y se publica). Lo verifica la misma cuenta de Google dueña del
proyecto de Cloud.

Si Google rechaza un subdominio de `vercel.app`, hay que comprar un dominio
propio (`.com.ar` en NIC Argentina es barato), apuntarlo a Vercel y repetir
el paso 1 con el dominio nuevo. Avisame y cambio las direcciones.

> Ojo: el login con Google vuelve a `pwigjpqiwzyakwwzwthz.supabase.co` (es de
> Supabase Auth). Google podría objetarlo en la revisión porque ese dominio no
> es tuyo. Si pasa, se resuelve con el dominio propio + Custom Domain de
> Supabase, o reenviando también ese callback por Vercel. Lo vemos si aparece.

### b) Justificación del permiso (pegala tal cual, Google revisa en inglés)

> Slotly is an appointment booking platform for small businesses (hair salons,
> clinics, workshops). Business owners and their staff can optionally connect
> their Google Calendar from the Slotly dashboard.
>
> We request `https://www.googleapis.com/auth/calendar.events` for two
> user-facing features:
>
> 1. **Write:** when a customer books, reschedules or cancels an appointment
>    in Slotly, we create, update or delete the corresponding event in the
>    professional's primary calendar, so their real agenda (including on their
>    phone) always matches Slotly. Events are identified by the appointment ID
>    and marked with a private extended property.
> 2. **Read busy times:** when a customer views available time slots, we read
>    the start and end times of the professional's events for that day (and
>    whether each event is marked busy and not declined) so we do not offer
>    times when the professional is already busy. We do not store or display
>    the title, description, location or attendees of these events.
>
> Data is never sold, used for advertising, shared with third parties, or used
> to train AI models. Users can disconnect at any time from the dashboard,
> which deletes upcoming Slotly events from their calendar and revokes the
> token. Our privacy policy (https://slotly-turnos.vercel.app/privacidad)
> describes this use and our compliance with the Google API Services User
> Data Policy, including the Limited Use requirements.

### c) Video demo (2 a 3 minutos, subido a YouTube como "No listado")

Google pide que se vea la **pantalla de permiso con el nombre de la app** y la
**barra de direcciones con el client_id**, y que se vea **cada uso** del
permiso. Grabá la pantalla de la compu (con la barra de direcciones visible),
en este orden. Textos en pantalla o narración en inglés:

1. **(0:00)** Abrir `https://slotly-turnos.vercel.app`. *"Slotly is an
   appointment booking platform for small businesses."*
2. **(0:10)** Iniciar sesión como dueño de un negocio de prueba → Configuración
   → bajar hasta la tarjeta **Google Calendar**.
3. **(0:25)** Tocar **Conectar** en un profesional. Se abre la pantalla de
   Google: **pausar 3 segundos** sobre la barra de direcciones (se ve
   `client_id=...`) y sobre la lista de permisos ("Ver y editar eventos...").
   *"We request the calendar.events scope."* Aceptar.
4. **(0:45)** Vuelve a Slotly con "Conectado · mail". *"The professional's
   calendar is now connected."*
5. **(0:55)** En otra pestaña, abrir el link público de reserva, reservar un
   turno para mañana a las 10:00.
6. **(1:15)** Abrir Google Calendar: el evento del turno ya está.
   *"Write: each booking creates an event in the professional's calendar."*
7. **(1:30)** En Google Calendar crear un evento "Dentista" mañana de 15 a 16.
   Volver al link de reserva, elegir mañana: **las 15:00 y 15:30 no aparecen**.
   *"Read: busy times from the calendar are not offered to customers. Only
   start and end times are used."*
8. **(1:55)** En el panel de Slotly, cancelar el turno de las 10:00 → en Google
   Calendar el evento desaparece. *"Cancellations are removed automatically."*
9. **(2:15)** En la tarjeta, **Desconectar**. *"Users can disconnect at any
   time; upcoming events are removed and access is revoked."*

### d) Si Google pide un permiso más acotado

Puede pasar. La alternativa es: escribir los turnos en un calendario aparte
"Slotly" que crea la app (`calendar.app.created`) y leer solo
libre/ocupado (`calendar.freebusy`). Es un cambio contenido en
`supabase/functions/_shared/google.ts`; lo hacemos si lo piden.
