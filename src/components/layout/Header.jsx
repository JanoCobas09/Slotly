import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import Icon from '../Icon';

export default function Header() {
  const location = useLocation();
  const { isAuthenticated, logout } = useAuth();
  const { business, slug } = useCurrentBusiness();
  // Aplica el tema (color de marca) del negocio activo. Header está montado
  // tanto en la landing como en toda página de cliente, así que es el punto
  // que garantiza que el tema se pinte apenas se resuelve el negocio.
  const { icon: rubroIcon } = useBusinessContext();

  // Los links del cliente siempre viven bajo el slug del negocio actual.
  const home = slug ? `/${slug}` : '/';

  return (
    <header className="header">
      <Link to={home} className="header-logo">
        {slug && business ? (
          business.logoUrl ? (
            <img src={business.logoUrl} alt={business.name} className="header-logo-photo" />
          ) : (
            <span className="header-logo-icon">
              <Icon name={rubroIcon} size="18" />
            </span>
          )
        ) : (
          <img src="/img/slotly-icon.svg" alt="Slotly" width="32" height="32" className="header-logo-img" />
        )}
        <span>{business?.name || 'Slotly'}</span>
      </Link>

      {!slug && (
        <nav className="header-nav">
          {/* `to="/#id"` en vez de `href="#id"` a propósito: un anchor
              plano solo funciona parado en la landing — en cualquier otra
              página (ej. /login) no hay ningún elemento con ese id y el
              click no hace nada. El Link navega a "/" y LandingPage se
              encarga de hacer scroll una vez montada (ver su useEffect). */}
          <Link to="/#inicio">Inicio</Link>
          <Link to="/#problema">El día a día</Link>
          <Link to="/#funciones">Funciones</Link>
          <Link to="/#como-arranca">Cómo arranca</Link>
          <Link to="/#precios">Precios</Link>
          <Link to="/#dudas">Dudas</Link>
        </nav>
      )}

      <div className="header-actions">
        {isAuthenticated ? (
          <>
            {slug && (
              <Link to={`${home}/mis-citas`} className="btn btn-ghost btn-sm">
                <Icon name="calendar" /> Mis Citas
              </Link>
            )}
            <button onClick={logout} className="btn btn-ghost btn-sm">
              Salir
            </button>
          </>
        ) : (
          <Link
            to="/login"
            state={{ from: location.pathname }}
            className="btn btn-secondary btn-sm"
          >
            Iniciar Sesión
          </Link>
        )}
      </div>
    </header>
  );
}
