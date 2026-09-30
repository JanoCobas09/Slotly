import Icon from '../Icon';

// ============================================================================
// Los cuatro valores fuertes, en el hero de la landing
// ============================================================================
// Lo primero que tiene que entender un dueño en cinco segundos: se llena solo,
// me entero de todo, el cliente no falta, y me sirve aunque crezca. Manda la
// imagen: cada valor es una mini-escena y una sola línea corta. Si hace falta
// explicar más, eso va en "Funciones", no acá.
//
// Todo lo que dice acá existe de verdad (ver CLAUDE.md): grilla de horarios
// libres sin superposiciones (availabilityEngine + turnos_sin_pisarse), push
// al dueño por turno nuevo/cancelado (handle_nuevo_turno → send-push), mail
// de confirmación + recordatorio 3 hs antes (send-reminders), y topes de
// profesionales/sucursales 1 → 3 → sin límite (plans.js).
// No agregar promesas que el sistema no cumpla.
// ============================================================================

function EscenaHorarios() {
  const slots = [
    ['09:30', 'ocupado'], ['10:15', 'elegido'], ['11:00', ''],
    ['11:45', 'ocupado'], ['15:00', ''], ['15:45', ''],
  ];
  return (
    <div className="escena-hoja">
      <span className="escena-hoja-titulo"><Icon name="calendar" /> Vie 7 · con Mateo</span>
      <div className="escena-slots">
        {slots.map(([h, estado]) => <span key={h} className={estado}>{h}</span>)}
      </div>
    </div>
  );
}

function EscenaAviso() {
  return (
    <div className="escena-pila">
      <div className="escena-notif atras">
        <span className="escena-notif-icono"><Icon name="bell" /></span>
        <div><strong>Canceló un turno</strong><span>Lucía · 16:30</span></div>
      </div>
      <div className="escena-notif">
        <span className="escena-notif-icono"><Icon name="bell" /></span>
        <div><strong>Nuevo turno · 10:15</strong><span>Santiago · Corte + Barba</span></div>
      </div>
    </div>
  );
}

function EscenaRecordatorio() {
  return (
    <div className="escena-mensajes">
      <span className="escena-burbuja"><Icon name="check" /> Turno confirmado</span>
      <span className="escena-burbuja segunda"><Icon name="clock" /> Te esperamos hoy a las 10:15</span>
    </div>
  );
}

function EscenaEscala() {
  const barras = [
    { alto: 34, n: '1', icono: 'user' },
    { alto: 62, n: '3', icono: 'users' },
    { alto: 92, n: '∞', icono: 'building' },
  ];
  return (
    <div className="escena-barras">
      {barras.map((b) => (
        <div key={b.n} className="escena-barra-col">
          <span className="escena-barra" style={{ height: `${b.alto}%` }}>
            <Icon name={b.icono} />
          </span>
          <b>{b.n}</b>
        </div>
      ))}
    </div>
  );
}

const VALORES = [
  { titulo: 'Reservan solos', texto: 'Solo en tus horarios libres', Escena: EscenaHorarios },
  { titulo: 'Te avisa cada turno', texto: 'Al instante, en tu celular', Escena: EscenaAviso },
  { titulo: 'Nadie se olvida', texto: 'Confirmación y recordatorio solos', Escena: EscenaRecordatorio },
  { titulo: 'Crece con vos', texto: 'De un profesional a varias sucursales', Escena: EscenaEscala },
];

export default function ValoresClave() {
  return (
    <ul className="landing-valores">
      {VALORES.map((v) => (
        <li key={v.titulo} className="landing-valor">
          <div className="landing-valor-escena" aria-hidden="true"><v.Escena /></div>
          <h3>{v.titulo}</h3>
          <p>{v.texto}</p>
        </li>
      ))}
    </ul>
  );
}
