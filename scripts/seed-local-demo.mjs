// Script temporal: siembra 3 negocios de prueba (distintos rubros) + un
// dueño de plataforma + un cliente, todo contra el emulador local. No toca
// producción. Se borra al terminar de usarlo.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8180';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PROJECT = 'barberos-1d60e';
initializeApp({ projectId: PROJECT });
const auth = getAuth();
const db = getFirestore();

async function upsertUser(email, password, claims) {
  let user;
  try {
    user = await auth.createUser({ email, password, emailVerified: true });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      user = await auth.getUserByEmail(email);
      await auth.updateUser(user.uid, { password, emailVerified: true });
    } else {
      throw err;
    }
  }
  await auth.setCustomUserClaims(user.uid, claims);
  return user;
}

// ── 1. Dueño de plataforma ──────────────────────────────────────────────
const platform = await upsertUser('audit-owner@example.com', 'AuditPass123!', { platform: true });

// ── 2. Cliente genérico (sin claims) ────────────────────────────────────
const client = await upsertUser('cliente-demo@example.com', 'ClienteDemo123!', {});

// ── 3. Negocios de prueba, un rubro cada uno ────────────────────────────
const NEGOCIOS = [
  {
    slug: 'taller-don-ricardo',
    name: 'Taller Don Ricardo',
    ownerEmail: 'taller-owner@example.com',
    ownerName: 'Ricardo Gomez',
    context: { professionCategory: 'automotive', customProfession: null },
    theme: { primaryColor: '#374151', secondaryColor: '#f59e0b', accentColor: '#f59e0b' },
    professional: { name: 'Ricardo Gomez', specialty: 'Mecánico general' },
    services: [
      { name: 'Diagnóstico', durationMinutes: 45, price: 8000 },
      { name: 'Cambio de aceite', durationMinutes: 30, price: 15000 },
      { name: 'Service completo', durationMinutes: 120, price: 45000 },
    ],
  },
  {
    slug: 'consultorio-dra-perez',
    name: 'Consultorio Dra. Pérez',
    ownerEmail: 'salud-owner@example.com',
    ownerName: 'Dra. Pérez',
    context: { professionCategory: 'healthcare', customProfession: null },
    theme: { primaryColor: '#0f766e', secondaryColor: '#14b8a6', accentColor: '#0f766e' },
    professional: { name: 'Dra. Pérez', specialty: 'Clínica general' },
    services: [
      { name: 'Consulta', durationMinutes: 30, price: 12000 },
      { name: 'Control', durationMinutes: 20, price: 8000 },
    ],
  },
  {
    slug: 'barberia-clasica',
    name: 'Barbería Clásica',
    ownerEmail: 'barberia-owner@example.com',
    ownerName: 'Mateo Rossi',
    // Sin `context`: simula una barbería dada de alta ANTES de la
    // generalización, para probar que resuelve a 'beauty' sin migrar nada.
    context: null,
    theme: { primaryColor: '#e03d00', secondaryColor: '#ff5c1a', accentColor: '#ff5c1a' },
    professional: { name: 'Mateo Rossi', specialty: 'Barbero senior' },
    services: [
      { name: 'Corte de pelo', durationMinutes: 30, price: 9000 },
      { name: 'Corte + Barba', durationMinutes: 45, price: 13000 },
    ],
  },
];

const BUSINESS_HOURS = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '', endTime: '', isActive: false },
];

const results = [];

for (const biz of NEGOCIOS) {
  const bizRef = db.collection('businesses').doc();
  const bizId = bizRef.id;

  const owner = await upsertUser(biz.ownerEmail, 'DemoPass123!', {
    businessId: bizId,
    role: 'owner',
  });

  const batch = db.batch();
  batch.set(bizRef, {
    id: bizId,
    name: biz.name,
    slug: biz.slug,
    logoUrl: null,
    primaryColor: biz.theme.primaryColor,
    secondaryColor: biz.theme.secondaryColor,
    accentColor: biz.theme.accentColor,
    phone: '+54 11 1234-5678',
    email: `hola@${biz.slug}.com`,
    address: 'Av. Siempre Viva 123',
    city: 'Buenos Aires',
    country: 'Argentina',
    currency: 'ARS',
    timezone: 'America/Argentina/Buenos_Aires',
    slotInterval: 30,
    minCancelHours: 2,
    onlineBookingEnabled: true,
    welcomeMessage: `Reservá en ${biz.name}`,
    socialLinks: { instagram: '', whatsapp: '' },
    planId: 'basico',
    whatsappQuota: 100,
    isFrozen: false,
    trialEndsAt: null,
    businessHours: BUSINESS_HOURS,
    ...(biz.context ? { context: biz.context } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`slugs/${biz.slug}`), { businessId: bizId });
  batch.set(db.doc(`businesses/${bizId}/private/billing`), {
    planId: 'basico',
    monthlyFee: 12000,
    debt: 0,
    lastPaymentDate: null,
    nextBillingDate: '2026-10-18',
  });
  batch.set(db.doc(`businesses/${bizId}/admins/${biz.ownerEmail}`), {
    email: biz.ownerEmail,
    name: biz.ownerName,
    role: 'owner',
    professionalId: null,
    addedAt: FieldValue.serverTimestamp(),
  });

  const profRef = db.collection(`businesses/${bizId}/professionals`).doc();
  batch.set(profRef, {
    name: biz.professional.name,
    specialty: biz.professional.specialty,
    bio: '',
    avatarUrl: null,
    displayOrder: 1,
    isActive: true,
  });

  batch.set(db.doc(`businesses/${bizId}/staffContacts/${profRef.id}`), {
    phone: '+54 11 1234-5678',
    email: biz.ownerEmail,
  });

  for (const day of BUSINESS_HOURS) {
    const schedRef = db.collection(`businesses/${bizId}/schedules`).doc();
    batch.set(schedRef, {
      professionalId: profRef.id,
      dayOfWeek: day.dayOfWeek,
      startTime: day.startTime,
      endTime: day.endTime,
      breakStart: day.isActive ? '13:00' : '',
      breakEnd: day.isActive ? '14:00' : '',
      isActive: day.isActive,
    });
  }

  const serviceIds = [];
  for (const [i, svc] of biz.services.entries()) {
    const svcRef = db.collection(`businesses/${bizId}/services`).doc();
    batch.set(svcRef, {
      name: svc.name,
      description: '',
      durationMinutes: svc.durationMinutes,
      price: svc.price,
      category: '',
      imageUrl: null,
      displayOrder: i + 1,
      isActive: true,
    });
    serviceIds.push(svcRef.id);
  }

  for (const serviceId of serviceIds) {
    const psRef = db.collection(`businesses/${bizId}/professionalServices`).doc();
    batch.set(psRef, {
      professionalId: profRef.id,
      serviceId,
      customPrice: null,
      customDuration: null,
    });
  }

  await batch.commit();

  results.push({
    name: biz.name,
    slug: biz.slug,
    url: `http://localhost:5173/${biz.slug}`,
    ownerEmail: biz.ownerEmail,
    ownerPassword: 'DemoPass123!',
  });
}

console.log('OK', JSON.stringify({
  platform: { email: 'audit-owner@example.com', password: 'AuditPass123!' },
  client: { email: 'cliente-demo@example.com', password: 'ClienteDemo123!' },
  negocios: results,
}, null, 2));
