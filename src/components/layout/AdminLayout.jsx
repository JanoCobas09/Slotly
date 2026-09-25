import { useState } from 'react';
import CampanaNotificaciones from '../admin/CampanaNotificaciones';
import InstalarAppBanner from '../admin/InstalarAppBanner';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { useBusinessContext } from '../../hooks/useBusinessContext';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { capitalize } from '../../utils/text';
import Icon from '../Icon';

// Items visibles solo para el dueño (owner)
const ownerNavItems = [
  { to: '/admin',               icon: 'home',      label: 'Inicio',           end: true },
  { to: '/admin/dashboard',     icon: 'dashboard', label: 'Dashboard' },
  { to: '/admin/profesionales', icon: 'users',      label: 'Profesionales' },
  { to: '/admin/servicios',     icon: 'services',   label: 'Servicios' },
  { to: '/admin/promociones',   icon: 'tag',        label: 'Promociones' },
  { to: '/admin/citas',         icon: 'calendar',   label: 'Citas' },
  { to: '/admin/dias-bloqueados', icon: 'lock',     label: 'Días bloqueados' },
  { to: '/admin/admins',        icon: 'shield',     label: 'Administradores' },
  { to: '/admin/configuracion', icon: 'settings',   label: 'Configuración' },
  { to: '/admin/soporte',       icon: 'chat',       label: 'Soporte' },
];

// Items para el staff asignado a un profesional → solo sus citas
const adminNavItems = [
  { to: '/admin',         icon: 'home',     label: 'Hoy', end: true },
  // La tabla con confirmar / completar / no asistió / cancelar y "Agendar
  // turno". Sin esta entrada el staff no tenía forma de llegar.
  { to: '/admin/citas',   icon: 'calendar', label: 'Mi Agenda' },
  { to: '/admin/ajustes', icon: 'settings', label: 'Mi Configuración' },
  { to: '/admin/soporte', icon: 'chat',     label: 'Soporte' },
];

const ROLE_COLORS = {
  owner: 'var(--primary)',
  admin: 'var(--success)',
};

// Mismo número que la landing y el widget flotante. Si cambia, cambia en los tres.
const LINK_SOPORTE = 'https://wa.me/5492257660073?text=' +
  encodeURIComponent('Hola! Te escribo por mi cuenta de Slotly.');

/**
 * Días que faltan para que termine la prueba. Negativo si ya venció, null si la
 * cuenta no es de prueba.
 *
 * Se compara en 'YYYY-MM-DD' y no con Date para no arrastrar la zona horaria del
 * browser: si el barbero tiene el reloj en otro huso, un turno de diferencia no
 * puede cambiarle el cartel.
 */
function diasDePruebaRestantes(trialEndsAt) {
  if (!trialEndsAt) return null;
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const ms = new Date(`${trialEndsAt}T00:00:00`) - new Date(`${hoyISO}T00:00:00`);
  return Math.round(ms / 86400000);
}

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mostrarPasosIOS, setMostrarPasosIOS] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { business, isPlatformOwner: platformOwner } = useCurrentBusiness();
  const { terminology, icon: rubroIcon } = useBusinessContext();
  // Solo el dueño instala el panel — el cliente reserva desde el navegador,
  // el barbero/staff usa el celular del negocio o el suyo sin necesitarlo.
  const { instalable, conPromptNativo, esIOS, instalar } = useInstallPrompt();

  const isOwner = user?.role === 'owner';
  const navItems = isOwner ? ownerNavItems : adminNavItems;
  const roleLabels = {
    owner: 'Dueño/a',
    admin: capitalize(terminology.professionalNoun),
  };
  const roleInfo = {
    text: roleLabels[user?.role] || roleLabels.admin,
    color: ROLE_COLORS[user?.role] || ROLE_COLORS.admin,
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleInstalarSidebar = async () => {
    if (conPromptNativo) {
      await instalar();
      return;
    }
    if (esIOS) setMostrarPasosIOS(true);
  };

  return (
    <div className="admin-layout">
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          {business ? (
            <span className="header-logo-icon">
              <Icon name={rubroIcon} size="20" />
            </span>
          ) : (
            <img src="/img/slotly-icon.svg" alt="Slotly" width="32" height="32" />
          )}
          <span>{business?.name || 'Slotly'}</span>
        </div>

        {/* Badge de rol */}
        <div style={{ padding: '0 var(--space-md) var(--space-md)', textAlign: 'center' }}>
          <span
            className="badge"
            style={{ background: roleInfo.color + '22', color: roleInfo.color, fontSize: '11px', fontWeight: 700 }}
          >
            {roleInfo.text}
          </span>
        </div>

        <nav className="admin-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="nav-icon"><Icon name={item.icon} /></span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          {/* Solo el dueño: mismo criterio que el resto de esta sección — el
              barbero no necesita instalar el panel en su propio celular. Se
              esconde solo si ya está instalada o el dispositivo no soporta
              instalación (Firefox/Safari desktop). */}
          {isOwner && instalable && (
            <button className="admin-nav-item" onClick={handleInstalarSidebar}>
              <span className="nav-icon"><Icon name="download" /></span>
              Instalar app
            </button>
          )}
          <button className="admin-nav-item" onClick={handleLogout}>
            <span className="nav-icon"><Icon name="logout" /></span>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {isOwner && mostrarPasosIOS && (
        <div className="modal-overlay" onClick={() => setMostrarPasosIOS(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>Instalar Slotly en iPhone/iPad</h3>
              <button className="modal-close" onClick={() => setMostrarPasosIOS(false)}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <ol style={{ paddingLeft: '1.2em', display: 'grid', gap: 10 }}>
                <li>Tocá el botón <strong>Compartir</strong> de Safari (el cuadrado con la flecha hacia arriba).</li>
                <li>Elegí <strong>"Agregar a inicio"</strong> en la lista de opciones.</li>
                <li>Confirmá tocando <strong>"Agregar"</strong> arriba a la derecha.</li>
              </ol>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setMostrarPasosIOS(false)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="admin-main">
        {isOwner && <InstalarAppBanner />}

        {/* Prueba gratis: los días que quedan, y qué hacer cuando se termina. */}
        {(() => {
          // Solo al dueño: el barbero no decide si se paga ni a quién escribir.
          if (!isOwner) return null;
          const dias = diasDePruebaRestantes(business?.trialEndsAt);
          if (dias === null) return null;
          const vencida = dias < 0;
          return (
            <div
              className={vencida ? 'notice notice-danger' : 'notice notice-info'}
              style={{
                borderRadius: 0,
                borderLeft: 'none',
                borderTop: 'none',
                borderRight: 'none',
                borderBottomWidth: '2px',
                borderBottomStyle: 'solid',
                padding: '8px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                {vencida ? (
                  <>
                    <strong>Se terminó tu prueba.</strong> Para seguir usando la
                    agenda, escribinos y activamos tu plan.
                  </>
                ) : dias === 0 ? (
                  <><strong>Hoy es el último día de prueba.</strong> Escribinos para seguir.</>
                ) : (
                  <>
                    Estás usando una <strong>cuenta de prueba</strong>: te
                    {dias === 1 ? ' queda 1 día' : ` quedan ${dias} días`}.
                  </>
                )}
              </span>
              <a
                href={LINK_SOPORTE}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'inherit', fontWeight: 700, whiteSpace: 'nowrap' }}
              >
                Hablar por WhatsApp →
              </a>
            </div>
          );
        })()}

        {/* Aviso permanente: si sos dueño de la plataforma, estás editando la
            cuenta de un cliente. Sin esto es fácil tocar el negocio equivocado. */}
        {platformOwner && business && (
          <div
            className="notice notice-warn"
            style={{
              borderRadius: 0,
              borderLeft: 'none',
              borderTop: 'none',
              borderRight: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: 'var(--warning)',
              padding: '8px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>
              Estás administrando <strong>{business.name}</strong> como dueño de la plataforma.
            </span>
            <Link to="/super-admin" style={{ color: 'inherit', fontWeight: 700 }}>
              ← Volver al panel global
            </Link>
          </div>
        )}

        <div className="admin-topbar">
          <div className="admin-topbar-left">
            <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Icon name="menu" />
            </button>
          </div>
          <div className="admin-topbar-right">
            <CampanaNotificaciones />
            <div className="flex items-center gap-sm">
              {user?.avatarUrl
                ? <img src={user.avatarUrl} alt={user.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                : <div className="avatar avatar-sm">{user?.name?.charAt(0) || 'A'}</div>
              }
              <span className="text-sm">{user?.name || 'Admin'}</span>
            </div>
          </div>
        </div>

        <div className="admin-content">
          {business ? (
            <Outlet />
          ) : (
            // Punto único de control: ninguna página de admin se renderiza sin
            // un negocio resuelto, así no hay que defenderse de `business` nulo
            // en cada pantalla.
            <div className="card empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <div className="empty-state-icon"><Icon name="building" /></div>
              <h3 style={{ marginBottom: 8 }}>No hay ningún negocio asignado a tu cuenta</h3>
              <p style={{ maxWidth: 460, margin: '0 auto var(--space-lg)' }}>
                {platformOwner
                  ? 'Todavía no diste de alta ningún negocio. Creá el primero desde el panel global.'
                  : 'Tu usuario tiene acceso al panel pero no está vinculado a ningún negocio. Contactate con Slotly para que lo asocien.'}
              </p>
              {platformOwner && (
                <Link to="/super-admin" className="btn btn-primary">
                  Ir al panel global
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
