// ============================================================================
// Capa de acceso a Supabase (Postgres + Storage + Realtime)
// ============================================================================
// Ningún componente habla con Supabase directamente: todo pasa por acá. Eso
// mantiene en un solo lugar la forma de los objetos, los nombres de las
// tablas y las reglas de escritura — mismo criterio que tenía este archivo
// contra Firestore.
//
// El contrato externo (nombres de función, forma de los objetos que
// devuelve cada uno) es EL MISMO que la versión de Firestore a propósito:
// ningún componente ni hook fuera de este archivo necesita cambiar. Por eso
// todo lo que sale de una tabla pasa por `fromRow()`, que traduce las
// columnas snake_case de Postgres (`business_id`, `start_time`...) a los
// mismos nombres camelCase que ya usaba toda la app (`businessId`,
// `startTime`...). Al escribir, `toRow()` hace el camino inverso.
//
// Estructura (tiene que coincidir con las policies de RLS en
// supabase/migrations/*_rls.sql):
//
//   businesses            → marca, horarios, isFrozen        público
//   billing               → deuda, abono, vencimientos       solo plataforma
//   professionals / services / schedules / professional_services / promotions   públicas
//   blocked_days          → días que el negocio no atiende      pública
//   appointments          → privado (staff + dueño del turno)
//   notifications (+ notification_reads)  → privado, por rol
//   push_subscriptions    → Web Push (Fase 5 — stubs acá abajo)
//   admins                → registro para UI, no otorga permiso
//   tickets / ticket_messages → negocio propio + plataforma
//   platform_config / platform_team → solo plataforma
//
// Por qué la facturación va aparte: `businesses` es de lectura pública (la
// página de reservas necesita nombre, colores y horarios antes del login).
// Si la deuda viviera ahí, cualquier cliente podría leerla — por eso es una
// tabla propia con su RLS separada.

import { supabase } from './supabase';

// ============================================================================
// fromRow / toRow — el único lugar que sabe que Postgres usa snake_case
// ============================================================================

/** 'business_id' → 'businessId'. */
function toCamel(s) {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** 'businessId' → 'business_id'. */
function toSnake(s) {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// La única tabla con renombres de verdad (no solo case): ticket_messages
// nació con otros nombres de columna en el esquema recuperado (`body` en vez
// de `text`, `sender_role` en vez de `author_role`). Se preserva el nombre
// que ya usa TicketChat.jsx en vez de tocar el componente.
const RENOMBRES = {
  ticket_messages: { body: 'text', sender_role: 'authorRole' },
};

/** Fila de Postgres (snake_case) → objeto JS (camelCase). No toca `null`. */
function fromRow(table, row) {
  if (!row) return row;
  const renombres = RENOMBRES[table] || {};
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[renombres[k] || toCamel(k)] = v;
  }
  return out;
}

const rows = (table, arr) => (arr || []).map((r) => fromRow(table, r));

/** Objeto JS (camelCase) → payload de insert/update (snake_case). */
function toRow(table, obj) {
  const renombres = RENOMBRES[table] || {};
  const inversas = Object.fromEntries(Object.entries(renombres).map(([k, v]) => [v, k]));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue; // no pisar con undefined
    out[inversas[k] || toSnake(k)] = v;
  }
  return out;
}

// ============================================================================
// Suscripciones en vivo (reemplazan onSnapshot)
// ============================================================================
// Supabase Realtime no manda "la lista completa actualizada" como onSnapshot:
// manda eventos incrementales (INSERT/UPDATE/DELETE) sobre la tabla. Estos
// dos helpers arman el mismo contrato que ya tenía este archivo — `cb` recibe
// siempre el estado completo y actualizado — con una carga inicial (SELECT)
// más un canal que va aplicando los deltas sobre una copia en memoria.
let contadorCanal = 0;

function liveTable(table, { filterCol, filterVal, orderCol, ascending = true } = {}, cb, onError) {
  let alive = true;
  let estado = [];

  const ordenar = (arr) => {
    if (!orderCol) return arr;
    return [...arr].sort((a, b) => {
      if (a[orderCol] === b[orderCol]) return 0;
      const cmp = a[orderCol] < b[orderCol] ? -1 : 1;
      return ascending ? cmp : -cmp;
    });
  };
  const emitir = () => { if (alive) cb(rows(table, ordenar(estado))); };

  (async () => {
    let q = supabase.from(table).select('*');
    if (filterCol) q = q.eq(filterCol, filterVal);
    const { data, error } = await q;
    if (error) return onError(error);
    if (!alive) return;
    estado = data || [];
    emitir();
  })();

  const filtro = filterCol ? `${filterCol}=eq.${filterVal}` : undefined;
  // Los DELETE van en un listener aparte y SIN filtro: Supabase Realtime no
  // entrega eventos de borrado a una suscripción filtrada (el registro viejo
  // solo trae la clave primaria, no hay `business_id` contra el cual
  // filtrar). Antes, con todo en un solo listener filtrado, las bajas no
  // llegaban nunca: al reemplazar los servicios de un profesional
  // (replaceMatching = borrar + insertar) la pantalla sumaba los nuevos sin
  // sacar los viejos y mostraba duplicados hasta recargar. Sin filtro llegan
  // los borrados de cualquier negocio, pero solo se saca lo que ya estaba en
  // `estado`, que es únicamente lo de este.
  const canal = supabase
    .channel(`live-${table}-${contadorCanal++}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: filtro }, (payload) => {
      estado = [...estado.filter((r) => r.id !== payload.new.id), payload.new];
      emitir();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: filtro }, (payload) => {
      estado = estado.map((r) => (r.id === payload.new.id ? payload.new : r));
      emitir();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
      const id = payload.old?.id;
      if (!id || !estado.some((r) => r.id === id)) return;
      estado = estado.filter((r) => r.id !== id);
      emitir();
    })
    .subscribe((status, err) => { if (err) onError(err); });

  return () => {
    alive = false;
    supabase.removeChannel(canal);
  };
}

/** Como liveTable, pero para un único registro por columna=valor (ej. id). */
function liveRow(table, matchCol, matchVal, cb, onError) {
  let alive = true;
  const emitir = (row) => { if (alive) cb(row ? fromRow(table, row) : null); };

  (async () => {
    const { data, error } = await supabase.from(table).select('*').eq(matchCol, matchVal).maybeSingle();
    if (error) return onError(error);
    if (!alive) return;
    emitir(data);
  })();

  const canal = supabase
    .channel(`live-${table}-${matchVal}-${contadorCanal++}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter: `${matchCol}=eq.${matchVal}` }, (payload) => {
      emitir(payload.eventType === 'DELETE' ? null : payload.new);
    })
    .subscribe((status, err) => { if (err) onError(err); });

  return () => {
    alive = false;
    supabase.removeChannel(canal);
  };
}

// ============================================================================
// NEGOCIOS
// ============================================================================

/**
 * Alta de un negocio (camino manual, plataforma). El alta self-service tiene
 * su propio camino atómico del lado del servidor — ver
 * create-business-self-service en supabase/functions — porque ahí quien crea
 * el negocio se vuelve su dueño y el rol solo lo puede dar el Admin SDK. Acá
 * en cambio la plataforma ya tiene el permiso: RLS deja escribir directo.
 *
 * `slugs` no existe como tabla propia (existía en Firestore solo porque no
 * se podía resolver un slug sin exponer `list()` de todo `businesses`) —
 * acá el slug es una columna UNIQUE en la misma fila.
 */
export async function createBusiness({ business, billing, ownerAdmin }) {
  const { data: negocio, error } = await supabase
    .from('businesses')
    .insert(toRow('businesses', business))
    .select('id')
    .single();
  if (error) throw error;
  const businessId = negocio.id;

  const { error: billingErr } = await supabase
    .from('billing')
    .insert({ business_id: businessId, debt: billing?.debt ?? 0, ...toRow('billing', billing || {}) });
  if (billingErr) throw billingErr;

  if (ownerAdmin?.email) {
    const { error: adminErr } = await supabase.from('admins').insert({
      ...toRow('admins', ownerAdmin),
      email: ownerAdmin.email.toLowerCase(),
      business_id: businessId,
    });
    if (adminErr) throw adminErr;
  }

  return businessId;
}

/** ¿Está libre este slug? */
export async function isSlugAvailable(slug) {
  const { data } = await supabase.from('businesses').select('id').eq('slug', slug).maybeSingle();
  return !data;
}

/** Resuelve el slug público a un businessId. Funciona sin estar logueado. */
export async function getBusinessIdBySlug(slug) {
  const { data } = await supabase.from('businesses').select('id').eq('slug', slug).maybeSingle();
  return data?.id ?? null;
}

/** Escucha un negocio puntual. Devuelve la función para desuscribirse. */
export function subscribeBusiness(businessId, cb, onError) {
  return liveRow('businesses', 'id', businessId, cb, onError);
}

/** Escucha TODOS los negocios. Solo el dueño de plataforma puede listar (RLS). */
export function subscribeAllBusinesses(cb, onError) {
  return liveTable('businesses', {}, cb, onError);
}

/**
 * Campos que el dueño de una barbería NO puede tocar: RLS + el trigger
 * businesses_protect_columns rechazan la escritura si vienen incluidos
 * (ver protect_business_columns() en la migración de RLS), así que además
 * se filtran acá antes de mandar para no gastar un viaje al servidor en un
 * update que va a rebotar.
 */
const CAMPOS_SOLO_PLATAFORMA = ['isFrozen', 'planId', 'whatsappQuota', 'slug', 'id', 'trialEndsAt', 'signupSource', 'frozenAt'];

export async function updateBusiness(businessId, cambios, { esPlataforma = false } = {}) {
  const payload = { ...cambios };
  if (!esPlataforma) {
    for (const campo of CAMPOS_SOLO_PLATAFORMA) delete payload[campo];
  }
  delete payload.createdAt;
  const { error } = await supabase.from('businesses').update(toRow('businesses', payload)).eq('id', businessId);
  if (error) throw error;
}

export async function setBusinessFrozen(businessId, isFrozen) {
  const { error } = await supabase.from('businesses').update({ is_frozen: isFrozen }).eq('id', businessId);
  if (error) throw error;
}

// Borrar un negocio es `deleteBusiness` en lib/functions.js: en cascada, con
// la service role key. Desde el browser no se puede hacer entero (Auth).

// ============================================================================
// FOTO DEL NEGOCIO (logo)
// ============================================================================
// Un solo archivo fijo por negocio (bucket `business-logos`, ver la
// migración de Storage — mismo criterio de permiso que el resto de
// `businesses`: solo el dueño/staff con gestión o la plataforma escriben).
// Subir uno nuevo pisa el anterior a propósito, así no quedan archivos
// huérfanos cada vez que el dueño cambia la foto.

const LOGO_PATH = (businessId) => `${businessId}/logo`;

/**
 * Sube la foto del negocio y devuelve su URL pública. No guarda `logoUrl` en
 * la tabla: eso lo hace quien llama (junto con el resto del formulario, o
 * solo, según convenga a la pantalla), igual que con cualquier otro campo de
 * `updateBusiness`.
 */
export async function uploadBusinessLogo(businessId, file) {
  const path = LOGO_PATH(businessId);
  const { error } = await supabase.storage.from('business-logos').upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('business-logos').getPublicUrl(path);
  return data.publicUrl;
}

/** Borra el archivo del bucket. Quien llama todavía tiene que limpiar `logoUrl`. */
export async function removeBusinessLogo(businessId) {
  const { error } = await supabase.storage.from('business-logos').remove([LOGO_PATH(businessId)]);
  // Ya no estaba (por ejemplo, se borró desde otra pestaña): no es un error
  // real, el resultado que quería quien llama ya se cumplió.
  if (error && !/not.?found/i.test(error.message || '')) throw error;
}

// ============================================================================
// FOTO DE CADA PROFESIONAL
// ============================================================================
// Mismo bucket que el logo, en `{businessId}/professionals/{profId}`: el
// primer segmento del path sigue siendo el negocio, así que la misma policy
// de Storage (can_manage sobre ese negocio) cubre esto sin migración nueva.
// Un archivo fijo por profesional: subir otra pisa la anterior.

const FOTO_PROF_PATH = (businessId, profId) => `${businessId}/professionals/${profId}`;

/**
 * Sube la foto de un profesional y devuelve su URL pública. Lleva `?v=` con
 * la hora de subida: el path es siempre el mismo, y sin eso el navegador (y
 * la CDN) seguirían mostrando la foto vieja después de cambiarla.
 */
export async function uploadProfessionalPhoto(businessId, profId, file) {
  const path = FOTO_PROF_PATH(businessId, profId);
  const { error } = await supabase.storage.from('business-logos').upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('business-logos').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

/** Borra la foto del bucket. Quien llama todavía tiene que limpiar `avatarUrl`. */
export async function removeProfessionalPhoto(businessId, profId) {
  const { error } = await supabase.storage.from('business-logos').remove([FOTO_PROF_PATH(businessId, profId)]);
  if (error && !/not.?found/i.test(error.message || '')) throw error;
}

// ============================================================================
// FACTURACIÓN (privada — solo dueño de plataforma)
// ============================================================================

export function subscribeBilling(businessId, cb, onError) {
  return liveRow('billing', 'business_id', businessId, cb, onError);
}

export async function getBilling(businessId) {
  const { data, error } = await supabase.from('billing').select('*').eq('business_id', businessId).maybeSingle();
  if (error) throw error;
  return fromRow('billing', data);
}

export async function updateBilling(businessId, cambios) {
  const { error } = await supabase
    .from('billing')
    .upsert({ business_id: businessId, ...toRow('billing', cambios) }, { onConflict: 'business_id' });
  if (error) throw error;
}

/** Registra un cobro y descuenta de la deuda. Descongela si queda en cero. */
export async function recordPayment(businessId, monto, fecha) {
  const actual = (await getBilling(businessId)) || {};
  const nuevaDeuda = Math.max(0, (actual.debt || 0) - monto);

  await updateBilling(businessId, {
    debt: nuevaDeuda,
    lastPaymentDate: fecha,
  });

  if (nuevaDeuda === 0) await setBusinessFrozen(businessId, false);
  return nuevaDeuda;
}

export async function upgradePlan(businessId, { planId, whatsappQuota, monthlyFee }) {
  // La cuota vive en la tabla pública porque la UI del negocio la muestra;
  // el abono en la privada porque es plata. Dos updates, no una transacción:
  // si el segundo fallara, quedaría un estado raro pero no roto (se puede
  // reintentar) — mismo riesgo que ya aceptaba el batch de Firestore, que
  // tampoco era atómico entre colecciones con reglas distintas.
  const { error: err1 } = await supabase.from('businesses').update({ plan_id: planId, whatsapp_quota: whatsappQuota }).eq('id', businessId);
  if (err1) throw err1;
  const { error: err2 } = await supabase
    .from('billing')
    .upsert({ business_id: businessId, monthly_fee: monthlyFee, plan_id: planId }, { onConflict: 'business_id' });
  if (err2) throw err2;
}

// ============================================================================
// SUBCOLECCIONES DEL NEGOCIO (ahora tablas propias, filtradas por business_id)
// ============================================================================

/** 'professionalServices' → 'professional_services'. El resto ya coincide. */
const nombreTabla = (name) => toSnake(name);

/** Escucha una "subcolección" del negocio (professionals, services, etc.). */
export function subscribeSubcollection(businessId, name, cb, onError) {
  return liveTable(nombreTabla(name), { filterCol: 'business_id', filterVal: businessId }, cb, onError);
}

export async function addToSubcollection(businessId, name, data) {
  const payload = { ...toRow(nombreTabla(name), data), business_id: businessId };
  delete payload.id; // lo genera la base — a diferencia de Firestore, acá nunca lo elige quien llama
  const { data: fila, error } = await supabase.from(nombreTabla(name)).insert(payload).select('id').single();
  if (error) throw error;
  return fila.id;
}

export async function updateInSubcollection(businessId, name, id, cambios) {
  const { error } = await supabase
    .from(nombreTabla(name))
    .update(toRow(nombreTabla(name), cambios))
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function removeFromSubcollection(businessId, name, id) {
  const { error } = await supabase.from(nombreTabla(name)).delete().eq('id', id).eq('business_id', businessId);
  if (error) throw error;
}

// ============================================================================
// DÍAS BLOQUEADOS
// ============================================================================

/**
 * Bloquea uno o varios días (fechas 'YYYY-MM-DD'). Sin `rango`, el día
 * entero; con `rango` ({ startTime, endTime }, 'HH:MM'), solo ese horario de
 * cada día. Quien llama ya filtra lo que estaba bloqueado igual (los índices
 * únicos de la tabla harían fallar el lote entero por un repetido).
 */
export async function blockDays(businessId, fechas, rango = null) {
  if (!fechas.length) return;
  const filas = fechas.map((date) => ({
    business_id: businessId,
    date,
    start_time: rango?.startTime || null,
    end_time: rango?.endTime || null,
  }));
  const { error } = await supabase.from('blocked_days').insert(filas);
  if (error) throw error;
}

/** Saca bloqueos puntuales (un día entero o un rango), por id. */
export async function removeBlocks(businessId, ids) {
  if (!ids.length) return;
  const { error } = await supabase.from('blocked_days').delete().eq('business_id', businessId).in('id', ids);
  if (error) throw error;
}

/**
 * Reemplaza en bloque las filas de una "subcolección" que cumplen un filtro.
 * Se usa para reasignar horarios de un profesional o los servicios que
 * presta, donde lo natural es "estos son los que quedan".
 */
export async function replaceMatching(businessId, name, campo, valor, nuevos) {
  const tabla = nombreTabla(name);
  const columnaFiltro = toSnake(campo);

  const { error: delErr } = await supabase.from(tabla).delete().eq('business_id', businessId).eq(columnaFiltro, valor);
  if (delErr) throw delErr;

  if (nuevos.length === 0) return;
  const payload = nuevos.map((item) => {
    const fila = { ...toRow(tabla, item), business_id: businessId };
    delete fila.id;
    return fila;
  });
  const { error: insErr } = await supabase.from(tabla).insert(payload);
  if (insErr) throw insErr;
}

// ============================================================================
// TURNOS
// ============================================================================

/** Turnos del negocio. El staff los ve todos. */
export function subscribeAppointments(businessId, cb, onError) {
  return liveTable('appointments', { filterCol: 'business_id', filterVal: businessId }, cb, onError);
}

/**
 * Turnos de UN profesional. Es lo que ve un barbero: RLS le permite listar
 * solo los suyos (is_assigned_staff), así que acá se agrega el mismo filtro
 * — no por seguridad (RLS ya la garantiza), sino para no traer de más.
 */
export function subscribeAppointmentsDeProfesional(businessId, professionalId, cb, onError) {
  return liveTable('appointments', { filterCol: 'professional_id', filterVal: professionalId }, cb, onError);
}

/** Turnos de un cliente puntual. RLS ya limita esto a sus propios turnos. */
export function subscribeMyAppointments(businessId, userId, cb, onError) {
  return liveTable('appointments', { filterCol: 'user_id', filterVal: userId }, cb, onError);
}

// La creación de turnos de cliente pasa por la Edge Function create-appointment
// (ver lib/functions.js) — el precio, la duración y la disponibilidad se
// revalidan siempre del lado del servidor. `createAppointment` acá abajo es
// solo para el turno que carga el propio staff a mano (walk-in/manual):
// RLS ya permite al staff insertar en su propia agenda directamente.
export async function createAppointment(businessId, data) {
  const payload = { ...toRow('appointments', data), business_id: businessId, status: 'pendiente' };
  delete payload.id;
  const { data: fila, error } = await supabase.from('appointments').insert(payload).select('id').single();
  if (error) throw error;
  return fila.id;
}

export async function updateAppointment(businessId, id, cambios) {
  const { error } = await supabase
    .from('appointments')
    .update(toRow('appointments', cambios))
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw error;
}

/** Cancelar. Los turnos no se borran nunca: así queda historial. */
export async function cancelAppointment(businessId, id, motivo = '', quien = 'staff') {
  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelada',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: motivo,
      // 'client' o 'staff'. El trigger handle_turno_cancelado avisa a la
      // barbería solo cuando canceló el cliente.
      cancelled_by: quien,
    })
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw error;
}

// ============================================================================
// NOTIFICACIONES AL STAFF
// ============================================================================
// Las crea un trigger de Postgres cuando entra o se cancela un turno (ver
// handle_nuevo_turno/handle_turno_cancelado en la migración de facturación).
// Desde acá solo se leen y se marcan leídas.
//
// `leidaPor` no es una columna: en Firestore era un mapa {uid: true} dentro
// del propio documento; acá es la tabla aparte `notification_reads`
// (notification_id, user_id). Como ningún componente mira el estado de
// lectura de OTRO usuario (CampanaNotificaciones.jsx solo chequea
// `n.leidaPor?.[uid]` del uid propio), alcanza con reconstruir un mapa de
// una sola clave por notificación: la del que está mirando.

/** Todas las del negocio (dueño), o solo las del profesional (barbero). */
export function subscribeNotifications(businessId, { professionalId = null } = {}, cb, onError) {
  let alive = true;
  let base = [];
  let leidas = new Set(); // ids de notificación leídas por MI uid

  const emitir = () => {
    if (!alive) return;
    const conLectura = base
      .map((n) => fromRow('notifications', n))
      .map((n) => ({ ...n, leidaPor: leidas.has(n.id) ? { [uidActual]: true } : {} }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    cb(conLectura.slice(0, 60));
  };

  let uidActual = null;
  (async () => {
    const { data: sesion } = await supabase.auth.getUser();
    uidActual = sesion?.user?.id ?? null;

    let q = supabase.from('notifications').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(60);
    if (professionalId) q = q.eq('professional_id', professionalId);
    const { data, error } = await q;
    if (error) return onError(error);
    if (!alive) return;
    base = data || [];

    if (uidActual && base.length) {
      const { data: reads } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .eq('user_id', uidActual)
        .in('notification_id', base.map((n) => n.id));
      leidas = new Set((reads || []).map((r) => r.notification_id));
    }
    emitir();
  })();

  const filtroNegocio = `business_id=eq.${businessId}`;
  const canal = supabase
    .channel(`live-notifications-${businessId}-${professionalId || 'all'}-${contadorCanal++}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: filtroNegocio }, (payload) => {
      if (professionalId && payload.new && payload.new.professional_id !== professionalId) return;
      if (payload.eventType === 'INSERT') base = [payload.new, ...base].slice(0, 60);
      else if (payload.eventType === 'UPDATE') base = base.map((r) => (r.id === payload.new.id ? payload.new : r));
      else if (payload.eventType === 'DELETE') base = base.filter((r) => r.id !== payload.old.id);
      emitir();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_reads' }, (payload) => {
      const row = payload.new || payload.old;
      if (!uidActual || row?.user_id !== uidActual) return;
      if (payload.eventType === 'DELETE') leidas.delete(row.notification_id);
      else leidas.add(row.notification_id);
      emitir();
    })
    .subscribe((status, err) => { if (err) onError(err); });

  return () => {
    alive = false;
    supabase.removeChannel(canal);
  };
}

export async function markNotificationRead(businessId, id, uid) {
  // `ignoreDuplicates` (ON CONFLICT DO NOTHING), no un upsert normal: no hay
  // nada que actualizar en una fila que ya existe (leída es leída, no tiene
  // un campo que cambie), y notification_reads no tiene policy de UPDATE —
  // marcar como leída una notificación YA leída (doble click, "marcar
  // todas" sobre una lista que incluye alguna ya leída) rebotaba con
  // "row-level security policy" al intentar el camino de UPDATE del
  // upsert. DO NOTHING no lo necesita.
  const { error } = await supabase
    .from('notification_reads')
    .upsert({ notification_id: id, user_id: uid }, { onConflict: 'notification_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}

// ============================================================================
// PUSH (Web Push, VAPID)
// ============================================================================
// Un registro por dispositivo, con el endpoint como PK: registrar el mismo
// dispositivo dos veces pisa la fila en vez de duplicarla, y "apagar
// notificaciones en este dispositivo" es simplemente borrar por endpoint.
// Nadie lee la suscripción de OTRO desde el browser (RLS: SELECT acotado a
// `user_id = auth.uid()`) — el envío en sí lo hace la Edge Function
// send-push con la service role key. El dueño ve todas las reservas
// nuevas, el staff asignado a un profesional ve las suyas — mismo criterio
// que ya usan las notificaciones in-app.
//
// La policy de SELECT propia (acotada a la fila del propio usuario) hizo
// falta por algo no obvio: sin NINGUNA policy de SELECT, ni UPDATE ni
// DELETE encuentran filas para operar, sin importar cuán permisiva sea su
// propia policy — es comportamiento documentado de Postgres (UPDATE/DELETE
// necesitan poder "ver" la fila vía alguna policy de SELECT antes de
// tocarla). Verificado contra el stack local: sin esa policy, hasta un
// `upsert(onConflict: 'endpoint')` con DO NOTHING rebotaba con
// "row-level security policy" — Postgres necesita leer para resolver el
// conflicto. Con la policy de SELECT agregada (ver
// 20260928030000_push_subscriptions_select_own.sql), el upsert de acá
// abajo funciona normal.

/** `subscription` es el `.toJSON()` de un PushSubscription: {endpoint, keys:{p256dh, auth}}. */
export async function savePushToken(businessId, subscription, { uid, role, professionalId = null }) {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: subscription.endpoint,
      business_id: businessId,
      user_id: uid,
      role,
      professional_id: professionalId,
      p256dh: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

export async function removePushToken(businessId, endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('business_id', businessId);
  if (error) throw error;
}

// ============================================================================
// CONTACTO DEL STAFF
// ============================================================================
// `professionals` es de LECTURA PÚBLICA: la página de reservas necesita
// nombre, especialidad y foto antes del login. Por eso el teléfono y el
// mail personales no van ahí — irían de regalo a cualquiera con el link.
//
// Van en `staff_contacts`, una fila por profesional. Se lee bajo demanda
// desde el panel y no por suscripción: lo consultan dos pantallas y casi
// nunca cambia, así que un listener permanente sería pagar de más por dato
// que casi nadie mira.

/** { [professionalId]: { phone, email } }. Vacío si nunca se cargó nada. */
export async function getStaffContacts(businessId) {
  const { data, error } = await supabase.from('staff_contacts').select('*').eq('business_id', businessId);
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.professional_id, { phone: r.phone || '', email: r.email || '' }]));
}

export async function saveStaffContact(businessId, professionalId, { phone = '', email = '' }) {
  const { error } = await supabase
    .from('staff_contacts')
    .upsert({ professional_id: professionalId, business_id: businessId, phone, email }, { onConflict: 'professional_id' });
  if (error) throw error;
}

/** ON DELETE CASCADE ya lo hace solo al borrar el profesional; esto queda para borrarlo aparte si hiciera falta. */
export async function removeStaffContact(businessId, professionalId) {
  const { error } = await supabase.from('staff_contacts').delete().eq('professional_id', professionalId).eq('business_id', businessId);
  if (error) throw error;
}

// ============================================================================
// ADMINS DEL NEGOCIO
// ============================================================================

export function subscribeAdmins(businessId, cb, onError) {
  return liveTable('admins', { filterCol: 'business_id', filterVal: businessId }, cb, onError);
}

/**
 * Registra un admin para la UI. NO otorga acceso por sí solo: el permiso real
 * son los custom claims, que asigna la Edge Function `set-business-admin`.
 */
export async function saveAdminRecord(businessId, admin) {
  const email = admin.email.toLowerCase();
  const { error } = await supabase
    .from('admins')
    .upsert({ ...toRow('admins', admin), email, business_id: businessId }, { onConflict: 'business_id,email' });
  if (error) throw error;
}

export async function removeAdminRecord(businessId, email) {
  const { error } = await supabase.from('admins').delete().eq('business_id', businessId).eq('email', email.toLowerCase());
  if (error) throw error;
}

// ============================================================================
// EQUIPO DE LA PLATAFORMA
// ============================================================================
// Moderadores: gente de soporte con acceso al panel global. Lo escribe solo
// la Edge Function set-platform-moderator; acá solo se lee.

export function subscribePlatformTeam(cb, onError) {
  return liveTable('platform_team', {}, cb, onError);
}

// ============================================================================
// TICKETS DE SOPORTE
// ============================================================================
// Tabla de primer nivel para que el panel global los liste todos sin
// necesitar una query recursiva. Cada ticket lleva business_id y RLS se
// encarga de que una barbería solo vea los suyos.

export const TICKET_ESTADOS = {
  abierto: 'Abierto',
  respondido: 'Respondido',
  cerrado: 'Cerrado',
};

/** Todos los tickets de la plataforma, del más movido al más viejo. */
export function subscribeAllTickets(cb, onError) {
  return liveTable('tickets', { orderCol: 'last_message_at', ascending: false }, cb, onError);
}

/** Tickets de una barbería. */
export function subscribeBusinessTickets(businessId, cb, onError) {
  return liveTable('tickets', { filterCol: 'business_id', filterVal: businessId, orderCol: 'last_message_at', ascending: false }, cb, onError);
}

export function subscribeTicketMessages(ticketId, cb, onError) {
  return liveTable('ticket_messages', { filterCol: 'ticket_id', filterVal: ticketId, orderCol: 'created_at', ascending: true }, cb, onError);
}

/** Abre un ticket con su primer mensaje. */
export async function createTicket({ businessId, businessName, subject, category, message, author }) {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      business_id: businessId,
      business_name: businessName,
      subject,
      category,
      status: 'abierto',
      last_message_by: 'business',
      unread_for_platform: true,
      unread_for_business: false,
    })
    .select('id')
    .single();
  if (error) throw error;

  const { error: msgErr } = await supabase.from('ticket_messages').insert({
    ticket_id: ticket.id,
    business_id: businessId,
    author_id: author.id,
    author_name: author.name,
    sender_role: 'business',
    body: message,
  });
  if (msgErr) throw msgErr;

  return ticket.id;
}

/** Responde un ticket. `role` es 'platform' o 'business'. */
export async function addTicketMessage(ticketId, { text, author, role }) {
  // Se necesita el business_id del ticket para el mensaje (RLS lo exige
  // igual que en el resto de las tablas hijas): una sola lectura, no hace
  // falta que quien llama la pase.
  const { data: ticket, error: getErr } = await supabase.from('tickets').select('business_id').eq('id', ticketId).single();
  if (getErr) throw getErr;

  const ahora = new Date().toISOString();

  const { error: msgErr } = await supabase.from('ticket_messages').insert({
    ticket_id: ticketId,
    business_id: ticket.business_id,
    author_id: author.id,
    author_name: author.name,
    sender_role: role,
    body: text,
  });
  if (msgErr) throw msgErr;

  const { error: updErr } = await supabase
    .from('tickets')
    .update({
      last_message_at: ahora,
      last_message_by: role,
      status: role === 'platform' ? 'respondido' : 'abierto',
      unread_for_platform: role === 'business',
      unread_for_business: role === 'platform',
    })
    .eq('id', ticketId);
  if (updErr) throw updErr;
}

export async function setTicketStatus(ticketId, status) {
  const { error } = await supabase.from('tickets').update({ status }).eq('id', ticketId);
  if (error) throw error;
}

/** Marca como leído para quien lo está mirando. */
export async function markTicketRead(ticketId, role) {
  const campo = role === 'platform' ? 'unread_for_platform' : 'unread_for_business';
  const { error } = await supabase.from('tickets').update({ [campo]: false }).eq('id', ticketId);
  if (error) throw error;
}

// ============================================================================
// CONFIGURACIÓN GLOBAL DE PLATAFORMA
// ============================================================================
// Fila única (id = true) con toda la config en una columna jsonb — mismo
// criterio que el documento `platform/{name}` de Firestore, donde `name` era
// distintos documentos según la config. Acá hay un solo documento posible
// (platform_config.id es un boolean con check(id), solo puede ser `true`),
// así que `name` queda como una clave dentro del jsonb en vez de una fila
// aparte.

export function subscribePlatformConfig(name, cb, onError) {
  return liveRow('platform_config', 'id', true, (row) => cb(row?.data?.[name] ?? null), onError);
}

export async function savePlatformConfig(name, data) {
  const { data: actual } = await supabase.from('platform_config').select('data').eq('id', true).maybeSingle();
  const nuevo = { ...(actual?.data || {}), [name]: { ...(actual?.data?.[name] || {}), ...data } };
  const { error } = await supabase.from('platform_config').upsert({ id: true, data: nuevo });
  if (error) throw error;
}
