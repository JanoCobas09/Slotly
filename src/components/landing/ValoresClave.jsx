import Icon from '../Icon';

// ============================================================================
// Los cuatro valores fuertes, en el hero de la landing
// ============================================================================
// Lo primero que tiene que entender un dueño en cinco segundos: se llena solo,
// me entero de todo, el cliente no falta, y me sirve aunque crezca. Cada
// tarjeta lleva una mini-pantalla que lo muestra en vez de explicarlo.
//
// Todo lo que dice acá existe de verdad (ver CLAUDE.md): grilla de horarios
// libres sin superposiciones (availabilityEngine + turnos_sin_pisarse), push
// al dueño por turno nuevo/cancelado (handle_nuevo_turno → send-push), mail
// de confirmación + recordatorio 3 hs antes (send-reminders), seña con Mercado
// Pago, y topes de profesionales/sucursales 1 → 3 → sin límite (plans.js).
// No agregar promesas que el sistema no cumpla.
// ============================================================================

function VisualHorarios() {
  const slots = [
    { h: '09:30', estado: 'ocupado' },
    { h: '10:15', estado: 'elegido' },
    { h: '11:00', estado: 'libre' },
    { h: '11:45', estado: 'ocupado' },
    { h: '15:00', estado: 'libre' },
    { h: '15:45', estado: 'libre' },
  ];
  return (
    <div className="valor-visual valor-slots" aria-hidden="true">
      {slots.map((s) => (
        <span key={s.h} className={`valor-slot ${s.estado}`}>{s.h}</span>
      ))}
    </div>
  );
}

function VisualAviso() {
  return (
    <div className="valor-visual valor-push" aria-hidden="true">
      <span className="valor-push-icono"><Icon name="bell" /></span>
      <div>
        <strong>Nuevo turno · 10:15</strong>
        <span>Santiago · Corte + Barba</span>
      </div>
      <span className="valor-push-hora">ahora</span>
    </div>
  );
}

function VisualRecordatorio() {
  return (
    <div className="valor-visual valor-timeline" aria-hidden="true">
      <div><Icon name="check" /> <span>Confirmación</span><em>al reservar</em></div>
      <div><Icon name="mail" /> <span>Recordatorio</span><em>3 hs antes</em></div>
      <div><Icon name="money" /> <span>Seña</span><em>Mercado Pago</em></div>
    </div>
  );
}

function VisualEscala() {
  return (
    <div className="valor-visual valor-escala" aria-hidden="true">
      <div className="valor-escala-paso"><b>1</b><span>profesional</span></div>
      <span className="valor-escala-flecha">→</span>
      <div className="valor-escala-paso"><b>3</b><span>profesionales y sucursales</span></div>
      <span className="valor-escala-flecha">→</span>
      <div className="valor-escala-paso destacado"><b>∞</b><span>sin límite</span></div>
    </div>
  );
}

const VALORES = [
  {
    titulo: 'Reservan solos, a toda hora',
    texto: 'Desde tu link eligen profesional, servicio y horario. Solo ven los que de verdad tenés libres: nada se superpone.',
    Visual: VisualHorarios,
  },
  {
    titulo: 'Te enterás de cada turno',
    texto: 'Cada reserva y cada cancelación te llega al celular en el momento. Sin revisar mensajes ni cuadernos.',
    Visual: VisualAviso,
  },
  {
    titulo: 'Tu cliente no se olvida',
    texto: 'Le llega la confirmación al reservar y un recordatorio antes del turno. Si querés, cobrás seña.',
    Visual: VisualRecordatorio,
  },
  {
    titulo: 'Crece con tu negocio',
    texto: 'Arrancás solo y sumás profesionales, sucursales y encargados cuando los necesitás. Cada uno ve lo suyo.',
    Visual: VisualEscala,
  },
];

export default function ValoresClave() {
  return (
    <ul className="landing-valores">
      {VALORES.map((v) => (
        <li key={v.titulo} className="landing-valor">
          <v.Visual />
          <h3>{v.titulo}</h3>
          <p>{v.texto}</p>
        </li>
      ))}
    </ul>
  );
}
