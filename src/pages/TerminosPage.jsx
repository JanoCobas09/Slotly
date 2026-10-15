import { Link } from 'react-router-dom';

// Términos y condiciones públicos (/terminos). Los pide (opcional) la pantalla
// de consentimiento de Google y dan seriedad a la verificación de la app.
// Tienen que decir lo que el sistema HACE: si cambia el modelo de cobro, la
// prueba, la suspensión o el borrado (ver CLAUDE.md, "Modelo de venta"),
// actualizar acá y la fecha de abajo. Borrador redactado sin asesoramiento
// legal: conviene que lo revise un abogado.
const ACTUALIZADOS = '15 de octubre de 2026';
const CONTACTO = 'slotly.turnos@gmail.com';

export default function TerminosPage() {
  return (
    <div className="legal-page">
      <h1>Términos y condiciones</h1>
      <p className="text-sm text-muted">Última actualización: {ACTUALIZADOS}</p>

      <p>
        Estos términos regulan el uso de Slotly, un sistema de turnos y reservas online para negocios
        (peluquerías, consultorios, talleres, estudios y otros rubros). Al crear una cuenta, entrar con
        Google o reservar un turno, aceptás estos términos y la{' '}
        <Link to="/privacidad">Política de privacidad</Link>. Si tenés dudas, escribinos a{' '}
        <a href={`mailto:${CONTACTO}`}>{CONTACTO}</a>.
      </p>

      <h2>1. Qué es Slotly</h2>
      <p>
        Slotly le da a cada negocio un link propio donde sus clientes reservan turnos, y un panel para
        organizar la agenda, el equipo, los servicios, los clientes y los avisos. Slotly es la
        herramienta: el turno es siempre entre el cliente y el negocio, que es quien presta el servicio.
      </p>

      <h2>2. Cuentas</h2>
      <ul>
        <li>Se entra con una cuenta de Google. Cuidá el acceso a esa cuenta: lo que se haga con ella en Slotly se considera hecho por vos.</li>
        <li>El dueño de un negocio puede dar acceso a su equipo (profesionales y administradores de sucursal). Cada uno ve y hace solo lo que su rol permite, y el dueño es responsable de a quién le da acceso.</li>
        <li>Los datos que cargues tienen que ser verdaderos: nombre del negocio, contacto, y en una reserva, tu nombre y teléfono.</li>
      </ul>

      <h2>3. Para los negocios</h2>
      <ul>
        <li>Sos responsable de lo que publicás en tu link (servicios, precios, horarios, fotos y textos) y de cumplir con los turnos que tus clientes reservan.</li>
        <li>
          Los datos de tus clientes son tuyos. Slotly los guarda y los procesa por tu cuenta para que puedas
          atenderlos, y vos sos responsable de usarlos solo para eso y de cumplir la Ley 25.326 de
          Protección de Datos Personales (por ejemplo, con los datos de salud en un consultorio).
        </li>
        <li>Las reglas de reserva y cancelación (con cuánta anticipación se reserva o se cancela, si se pide seña) las define cada negocio en su configuración.</li>
      </ul>

      <h2>4. Para quienes reservan</h2>
      <ul>
        <li>El turno es con el negocio. Si necesitás cambiarlo o tenés un problema con la atención, hablalo con el negocio: sus datos de contacto están en su link.</li>
        <li>Podés cancelar desde "Mis turnos" hasta el límite que fije cada negocio; después, tenés que avisarle directamente.</li>
        <li>Para evitar abusos, hay un tope de turnos por persona (uno por día y unos pocos a futuro en cada negocio).</li>
      </ul>

      <h2>5. Prueba gratis, planes y pago</h2>
      <ul>
        <li>Los negocios pueden empezar con un período de prueba gratis. Después, el uso se abona por mes según el plan elegido (los planes se diferencian, por ejemplo, en la cantidad de profesionales y sucursales).</li>
        <li>Slotly no hace cobros automáticos con tarjeta: el abono se paga por los medios que se acuerden con Slotly.</li>
        <li>Si el abono no se paga, la cuenta se suspende: el link de reservas deja de tomar turnos hasta que se regularice.</li>
        <li>Una cuenta creada por su cuenta en la prueba gratis que nunca registró un pago se borra, con sus datos, si sigue suspendida 7 días después de vencida la prueba.</li>
        <li>Los precios y planes vigentes están en la página principal. Si cambian, te avisamos antes de que se apliquen.</li>
      </ul>

      <h2>6. Señas con Mercado Pago</h2>
      <p>
        Si un negocio pide seña, el pago se hace con Mercado Pago, directo desde el cliente a la cuenta
        del negocio. Slotly no recibe, no retiene ni administra ese dinero. Las comisiones las cobra
        Mercado Pago, y las devoluciones las decide y las hace el negocio, según sus propias reglas.
      </p>

      <h2>7. Google Calendar</h2>
      <p>
        Conectar Google Calendar es opcional. Si lo hacés, Slotly agrega y mantiene tus turnos en tu
        calendario y usa los horarios ocupados de tus calendarios para no ofrecerlos, como se explica en
        la <Link to="/privacidad">Política de privacidad</Link>. Lo podés desconectar cuando quieras. El uso
        de tu cuenta de Google también se rige por las condiciones de Google.
      </p>

      <h2>8. Avisos</h2>
      <p>
        Slotly manda confirmaciones, recordatorios y avisos por mail y por notificaciones del navegador.
        Hacemos todo lo posible para que lleguen, pero no podemos garantizarlo (pueden caer en spam o el
        teléfono puede tener las notificaciones apagadas). El turno vale aunque un aviso no llegue.
      </p>

      <h2>9. Uso permitido</h2>
      <p>
        No se puede usar Slotly para actividades ilegales, para molestar o engañar a otras personas,
        para cargar contenido ajeno sin permiso, ni para intentar entrar a cuentas o datos de otros o
        afectar el funcionamiento del sistema. Si eso pasa, podemos suspender o cerrar la cuenta.
      </p>

      <h2>10. Disponibilidad y responsabilidad</h2>
      <p>
        Trabajamos para que Slotly funcione siempre, pero puede haber cortes por mantenimiento, fallas de
        internet o de los servicios que usamos. En la medida que lo permita la ley, Slotly no responde por
        daños indirectos, como turnos o ventas perdidas, ni por lo que pase en la atención entre el
        negocio y su cliente. Nada de esto limita los derechos que te da la Ley 24.240 de Defensa del
        Consumidor.
      </p>

      <h2>11. Propiedad</h2>
      <p>
        Slotly, su nombre, su diseño y su código son de sus desarrolladores. Lo que cada negocio carga
        (su nombre, fotos, textos y datos de clientes) sigue siendo suyo.
      </p>

      <h2>12. Baja</h2>
      <p>
        Un negocio puede pedir la baja cuando quiera, escribiéndonos. Al darse de baja se borran sus
        datos y los de sus turnos. Quien reserva puede pedir que borremos su cuenta de la misma forma.
      </p>

      <h2>13. Cambios en estos términos</h2>
      <p>
        Si cambian, actualizamos la fecha de arriba; si el cambio es importante, lo avisamos en la app
        antes de que se aplique.
      </p>

      <h2>14. Ley aplicable</h2>
      <p>
        Estos términos se rigen por las leyes de la República Argentina.
      </p>

      <p className="mt-lg">
        <Link to="/privacidad">Política de privacidad</Link>{' · '}<Link to="/">Volver a Slotly</Link>
      </p>
    </div>
  );
}
