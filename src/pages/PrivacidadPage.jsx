import { Link } from 'react-router-dom';

// Política de privacidad pública (/privacidad). La pide Google para aprobar el
// permiso de Google Calendar (pantalla de consentimiento OAuth): tiene que
// decir qué datos de Google se usan, para qué, y el compromiso de "Uso
// Limitado". Si cambia lo que Slotly hace con los datos, actualizar acá y la
// fecha de abajo.
const ACTUALIZADA = '14 de octubre de 2026';
const CONTACTO = 'slotly.turnos@gmail.com';

export default function PrivacidadPage() {
  return (
    <div className="legal-page">
      <h1>Política de privacidad</h1>
      <p className="text-sm text-muted">Última actualización: {ACTUALIZADA}</p>

      <p>
        Slotly es un sistema de turnos y reservas online para negocios (peluquerías, consultorios,
        talleres, estudios y otros rubros). Esta política explica qué datos usa Slotly, para qué y
        qué podés hacer con ellos. Si tenés dudas, escribinos a <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
      </p>

      <h2>Qué datos usamos</h2>
      <ul>
        <li>
          <strong>Cuenta:</strong> al entrar con Google recibimos tu nombre, tu correo y tu foto de
          perfil. Los usamos para identificarte y mostrarte tus turnos.
        </li>
        <li>
          <strong>Turnos:</strong> cuando reservás, guardamos el nombre y el teléfono que cargás, el
          servicio, el día y la hora, y los datos extra que pida el negocio. Los ve el negocio donde
          reservaste, para atenderte.
        </li>
        <li>
          <strong>Negocios:</strong> los datos que el negocio carga sobre sí mismo (nombre, dirección,
          horarios, servicios, precios, su equipo) y la información de sus clientes que agrega en el
          panel (fichas, notas y archivos).
        </li>
        <li>
          <strong>Notificaciones:</strong> si las activás, guardamos el permiso del navegador para
          mandarte avisos.
        </li>
        <li>
          <strong>Pagos:</strong> si el negocio cobra seña, el pago lo procesa Mercado Pago. Slotly no
          ve ni guarda los datos de tu tarjeta.
        </li>
      </ul>

      <h2>Google Calendar</h2>
      <p>
        Los profesionales y dueños de negocios pueden conectar su Google Calendar desde el panel. Es
        opcional y se puede desconectar en cualquier momento. Si lo conectás, Slotly pide permiso
        para <strong>ver y editar los eventos de tus calendarios</strong> y para{' '}
        <strong>ver la lista de tus calendarios</strong>, y los usa solamente para:
      </p>
      <ul>
        <li>
          <strong>Agregar tus turnos a tu calendario</strong>, y actualizarlos o borrarlos cuando se
          mueven o se cancelan en Slotly. Esos eventos incluyen el servicio, el nombre y el teléfono
          del cliente y las notas del turno, para que tengas a mano la información de tu agenda.
        </li>
        <li>
          <strong>Saber en qué horarios estás ocupado</strong>, para no ofrecerlos a quienes reservan.
          Slotly mira los calendarios de los que sos dueño (de la lista de tus calendarios toma solo
          cuáles son); no los que otras personas comparten con vos. De tus otros eventos lee solo
          cuándo empiezan y cuándo terminan, si están marcados como "ocupado" y si rechazaste la
          invitación. No guarda su título, su descripción ni sus invitados, y nunca se los muestra a
          nadie: en el panel del negocio aparecen solo como "Ocupado".
        </li>
      </ul>
      <p>
        Slotly no usa los datos de tu calendario para publicidad, no los vende, no los comparte con
        terceros y no los usa para entrenar modelos de inteligencia artificial. Las personas del
        equipo de Slotly no los leen, salvo que nos lo pidas para resolver un problema, o que la ley
        lo exija.
      </p>
      <p>
        El uso y la transferencia a cualquier otra aplicación de la información recibida de las APIs
        de Google cumple con la{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Política de Datos del Usuario de los Servicios de API de Google
        </a>, incluidos los requisitos de Uso Limitado.
      </p>
      <p>
        Al desconectar el calendario, Slotly borra de tu calendario los eventos de los turnos que
        vienen, deja de tener acceso y elimina el permiso guardado. También podés sacarle el acceso a
        Slotly desde <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">tu cuenta de Google</a>.
      </p>

      <h2>Con quién se comparten los datos</h2>
      <p>
        Solo con los servicios que Slotly necesita para funcionar, que los procesan en su nombre:
        Supabase (base de datos y servidores), Vercel (la página web), Google (inicio de sesión,
        Google Calendar si lo conectás, y el correo con el que se mandan las confirmaciones y los
        recordatorios) y Mercado Pago (solo si el negocio cobra seña). No vendemos datos personales.
      </p>

      <h2>Cuánto tiempo se guardan</h2>
      <p>
        Mientras tu cuenta o la del negocio esté activa. Cuando un negocio se da de baja, se borran
        sus datos y los de sus turnos.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Podés pedir ver, corregir o borrar tus datos escribiendo a{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>. Si reservaste en un negocio, también podés
        pedírselo directamente a ese negocio. En Argentina, la Agencia de Acceso a la Información
        Pública es el órgano de control de la Ley 25.326 de Protección de Datos Personales.
      </p>

      <h2>Cambios</h2>
      <p>
        Si cambia esta política, actualizamos la fecha de arriba. Si el cambio es importante, lo
        avisamos en la app.
      </p>

      <p className="mt-lg"><Link to="/">← Volver a Slotly</Link></p>
    </div>
  );
}
