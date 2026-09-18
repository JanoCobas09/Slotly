import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/Icon';

// Mismo número que la landing y el panel. Si cambia, cambia en los tres.
const WHATSAPP = '5492257529684';
const mensaje = encodeURIComponent(
  'Hola! Entré con mi cuenta y me dice que todavía no tengo un negocio asociado. Quiero saber cómo activarlo.'
);
const LINK_WA = `https://wa.me/${WHATSAPP}?text=${mensaje}`;

/**
 * Adónde va alguien que inició sesión y no tiene ningún negocio asociado.
 *
 * Antes se lo devolvía a la landing sin decirle nada: entraba, se logueaba bien,
 * y volvía al mismo lugar. Quedaba pensando que no había funcionado — y es
 * justamente el curioso que entró a probar, o sea el lead que menos conviene
 * perder en silencio.
 *
 * El destino por defecto de ese login pasó a ser /onboarding (alta
 * self-service, con prueba gratis) — ver LoginPage. Esta pantalla queda como
 * salida para quien prefiere que se lo armen a mano en vez de completarlo
 * solo, y como fallback por si alguien llega acá por un link viejo.
 */
export default function CuentaSinNegocio() {
  const { user } = useAuth();

  return (
    <div className="empty-state" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="empty-state-icon"><Icon name="building" /></div>
      <h2>Tu cuenta todavía no tiene un negocio</h2>

      {user?.email && (
        <p className="text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
          Entraste como <strong>{user.email}</strong>.
        </p>
      )}

      <p>
        Podés armarlo vos en un par de minutos, con prueba gratis, o pedirnos
        que te lo dejemos listo nosotros.
      </p>

      <div style={{ marginTop: 'var(--space-lg)', display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/onboarding" className="btn btn-primary btn-lg">
          Empezar mi prueba gratis →
        </Link>
        <a href={LINK_WA} target="_blank" rel="noreferrer" className="btn btn-outline btn-lg">
          Prefiero que lo armen ustedes
        </a>
      </div>

      <div
        style={{
          marginTop: 'var(--space-xl)',
          paddingTop: 'var(--space-md)',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <p className="text-sm text-secondary" style={{ marginBottom: 4 }}>
          <strong>¿Venías a reservar un turno?</strong>
        </p>
        <p className="text-sm text-secondary">
          Pedile al negocio el link que te compartieron: cada uno tiene su
          propia dirección.
        </p>
      </div>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <Link to="/" className="btn btn-ghost btn-sm">
          ← Volver al inicio
        </Link>
      </div>
    </div>
  );
}
