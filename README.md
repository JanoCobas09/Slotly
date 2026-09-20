# Slotly

SaaS multi-tenant de turnos y reservas, genérico por rubro: no es solo para
barberías, sirve para cualquier negocio que atienda con turnos (salud,
talleres, entrenadores, servicios profesionales, mascotas...). Cada negocio
tiene su propio link público donde los clientes reservan, su panel de
administración, y todo se gestiona desde un panel global de plataforma.

Desarrollado por [SACIA](https://sacia.tech).

> Slotly es un producto nuevo e independiente, no una continuación de
> BarberOS. El código partió de un clon de `cavanna11/BarberOS` como semilla
> técnica (para no arrancar de cero), pero ese repo quedó retirado para
> siempre — este (`JanoCobas09/Slotly`) es el único vigente.

---

## Modelo

Dos formas de dar de alta un negocio:

- **Manual**: el cliente se contacta, se cierra la venta, y la cuenta se
  prepara desde `/super-admin` → "Nuevo negocio" — crea el negocio, su link
  público y el acceso del dueño en un solo paso.
- **Self-service**: quien entra con Google por primera vez y no tiene negocio
  arma el suyo solo (`/onboarding`), con ~48 hs de prueba gratis. Si nunca
  paga, la cuenta se suspende sola al vencer la prueba y se borra sola si
  sigue suspendida una semana más — nunca toca una cuenta que alguna vez pagó.

Ninguna de las dos cobra con tarjeta ni tiene checkout: "elegir un plan"
anota una intención, el cobro real es manual (WhatsApp → la plataforma
registra el pago desde el panel global).

Cuatro niveles de acceso:

| Rol | Alcance |
|---|---|
| **Dueño de plataforma** | Panel global: alta de cuentas, cobros, suspensiones, soporte |
| **Dueño de negocio** | Su negocio: staff, servicios, agenda, horarios, sus admins |
| **Staff / profesional** | Solo sus propios turnos |
| **Cliente** | Reserva por el link público del negocio |

### Rubro configurable, no una lista cerrada

Cada negocio elige su categoría (`src/config/professionPresets.js`: belleza,
salud, bienestar, automotor, educación/entrenamiento, servicios
profesionales, mascotas) o escribe la suya si no encaja — nunca queda sin
terminología, tema de color, ícono y servicios sugeridos propios. Un negocio
sin categoría (cualquier barbería del alta original) sigue viendo la misma
experiencia de siempre, sin migrar nada.

---

## Stack

React 19 · Vite 7 · React Router 7 · Firebase (Auth, Firestore, Functions,
Cloud Messaging) · CSS puro con variables (tema white-label por negocio).

La persistencia es 100% Firestore. Los permisos son custom claims escritos
solo por Cloud Functions con el Admin SDK — las Security Rules
(`firestore.rules`) son la barrera real, el frontend solo esconde.

PWA instalable con notificaciones push (FCM): el dueño/staff recibe un aviso
en su celular cuando entra o se cancela un turno.

---

## Correr en local

```bash
npm install
cp .env.example .env.local   # completar las variables de Firebase (ver abajo)
npm run dev
```

En desarrollo, con `VITE_USE_EMULATORS=true` y el emulador de Firebase
corriendo, el login muestra sesiones de prueba reales (por rol) sin pasar por
Google. Ese bloque está detrás de `import.meta.env.DEV` y no existe en el
build de producción.

```bash
firebase emulators:start --only auth,firestore,functions
node scripts/seed-local-demo.mjs        # negocios y cuentas de prueba
```

```bash
npm run build    # producción
npm run lint
```

Ver `.env.example` para la lista completa de variables (Firebase, VAPID para
push, site key de reCAPTCHA para el alta self-service).

---

## Cómo está organizado

```
src/
├── lib/
│   ├── firebase.js       Init de Firebase + App Check
│   ├── repository.js     Único lugar que habla con Firestore
│   ├── functions.js      Único lugar que llama Cloud Functions
│   └── push.js           Registro de notificaciones push (FCM)
├── contexts/
│   ├── BusinessSync.jsx  Único lugar que abre suscripciones onSnapshot
│   ├── AuthContext       Login + claims
│   └── BookingContext    Wizard de reserva pública
├── hooks/
│   ├── useCurrentBusiness.js   Resuelve qué negocio corresponde
│   └── useBusinessContext.js   Terminología/tema/ícono ya resueltos por rubro
├── config/
│   ├── platform.js           Dueños de la plataforma
│   ├── plans.js               Planes comerciales — fuente única de precios y topes
│   └── professionPresets.js   Categorías de rubro: terminología, tema, servicios sugeridos
├── pages/
│   ├── LandingPage.jsx    Landing pública
│   ├── client/            Reserva pública en /:businessSlug + alta self-service
│   ├── admin/              Panel del negocio
│   └── super-admin/        Panel global de plataforma
└── utils/
    ├── availabilityEngine.js   Cálculo de horarios disponibles
    └── statsCalculator.js      Métricas del dashboard

functions/
└── index.js   Permisos (custom claims), facturación diaria, alta self-service,
                validación de turnos, notificaciones push — todo lo que no
                puede vivir en el browser
```

**Reglas de oro:**
- Ningún componente lee Firestore directo: todo pasa por `repository.js`.
- Ninguna suscripción `onSnapshot` fuera de `BusinessSync`.
- `availabilityEngine.js` y `statsCalculator.js` reciben arrays por argumento
  y no saben de dónde salen — no romper eso.
- Nada de `if profession === 'x'` disperso: un rubro nuevo entra como una fila
  en `professionPresets.js`, nunca como código nuevo.

---

## Seguridad

Las Security Rules (`firestore.rules`) más los custom claims son lo que aísla
un negocio de otro — nunca el frontend. Los permisos solo los otorga el Admin
SDK desde Cloud Functions: ni un documento de Firestore ni el browser pueden
escribir un rol.

---

## Documentación

| Archivo | Contenido |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Contexto completo del proyecto — arquitectura, decisiones, trampas ya resueltas. Fuente principal. |
| [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) | Guía de referencia de la configuración de Firebase |
| [`firestore.rules`](firestore.rules) | Reglas de seguridad — la barrera real entre negocios |

Ante cualquier duda entre este README y el código, **el código manda**.
