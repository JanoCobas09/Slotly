import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { cancelAppointment, getMisTurnos } from '../../lib/repository';
import { borrarDestinoLogin, esDestinoDeTurnos, leerDestinoLogin } from '../../lib/destinoLogin';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import Icon from '../../components/Icon';

/**
 * "Verificá tu turno": los turnos que reservó la cuenta de Google con la que
 * entró, en TODOS los negocios de Slotly. Se llega desde la landing, el
 * login o el encabezado; pide entrar con Google (ProtectedRoute) — nunca se
 * muestran turnos por un correo tipeado, porque cualquiera podría mirar los
 * de otra persona.
 *
 * Distinto de /:slug/mis-citas, que muestra los de un solo negocio y vive
 * adentro de su link.
 */

const ESTADOS = {
  pendiente: { label: 'Pendiente', className: 'badge-warning' },
  confirmada: { label: 'Confirmado', className: 'badge-success' },
  completada: { label: 'Completado', className: 'badge-success' },
  cancelada: { label: 'Cancelado', className: 'badge-danger' },
  no_asistio: { label: 'No asistió', className: 'badge-danger' },
};

export default function MisTurnosPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('proximos');
  const [cancelando, setCancelando] = useState(null);

  const cargar = useCallback(async () => {
    setError('');
    try {
      setDatos(await getMisTurnos(user.id));
    } catch (err) {
      console.error('[MisTurnos] No se pudieron leer los turnos:', err);
      setError('No pudimos traer tus turnos. Revisá la conexión y probá de nuevo.');
    }
  }, [user.id]);

  useEffect(() => { cargar(); }, [cargar]);

  // Llegó: la marca de "después de Google, a /mis-turnos" ya cumplió. Si
  // quedara, el próximo /login con sesión volvería a mandarlo acá.
  useEffect(() => {
    if (esDestinoDeTurnos(leerDestinoLogin())) borrarDestinoLogin();
  }, []);

  const otraCuenta = async () => {
    await logout();
    navigate('/login', { state: { from: '/mis-turnos' } });
  };

  const ahora = new Date();
  // Fecha + hora, local: un turno de hoy a las 11:00 a las 18:00 ya pasó.
  const inicioDe = (t) => new Date(`${t.appointmentDate}T${t.startTime || '00:00'}:00`);
  const activo = (t) => t.status === 'pendiente' || t.status === 'confirmada';
  const yaPaso = (t) => inicioDe(t) <= ahora;
  // Cada negocio elige con cuánta anticipación se puede cancelar
  // (Configuración); más cerca del turno, el cliente le escribe. Mismo
  // criterio que MyAppointments.
  const horasMinimas = (negocio) => Number(negocio?.minCancelHours) || 2;
  const puedeCancelar = (t, negocio) => inicioDe(t) - ahora > horasMinimas(negocio) * 60 * 60 * 1000;
  // Reservado con la seña sin pagar y todavía dentro del plazo.
  const esperandoSena = (t) => t.depositStatus === 'pendiente' && activo(t)
    && t.depositExpiresAt && new Date(t.depositExpiresAt) > ahora;

  const handleCancelar = async (t) => {
    const aviso = t.depositStatus === 'pagada'
      ? '¿Seguro que querés cancelar este turno?\n\nLa seña no se devuelve automáticamente: si corresponde, la devuelve el negocio. Consultalo con ellos.'
      : '¿Seguro que querés cancelar este turno?';
    if (!window.confirm(aviso)) return;
    setCancelando(t.id);
    try {
      await cancelAppointment(t.businessId, t.id, '', 'client');
      await cargar();
    } catch (err) {
      console.error('[MisTurnos] No se pudo cancelar:', err);
      alert('No se pudo cancelar el turno: ' + err.message);
    } finally {
      setCancelando(null);
    }
  };

  const turnos = datos?.turnos || [];
  // Próximos: del más cercano al más lejano. Pasados (y cancelados): del más
  // reciente para atrás.
  const proximos = turnos.filter((t) => activo(t) && !yaPaso(t)).sort((a, b) => inicioDe(a) - inicioDe(b));
  const pasados = turnos.filter((t) => !activo(t) || yaPaso(t));
  const mostrados = tab === 'proximos' ? proximos : pasados;

  return (
    <div className="my-appointments">
      <h1>Mis turnos</h1>
      <p className="text-muted mis-turnos-cuenta">
        Los turnos que reservaste con <strong>{user.email}</strong> en todos los negocios de Slotly.{' '}
        <button type="button" className="mis-turnos-link" onClick={otraCuenta}>
          ¿Reservaste con otra cuenta?
        </button>
      </p>

      {error && (
        <div className="empty-state">
          <p>{error}</p>
          <button type="button" className="btn btn-primary mt-lg" onClick={cargar}>Probar de nuevo</button>
        </div>
      )}

      {!error && !datos && (
        <div className="empty-state"><p>Buscando tus turnos…</p></div>
      )}

      {!error && datos && (
        <>
          <div className="tabs mt-md">
            <button className={`tab ${tab === 'proximos' ? 'active' : ''}`} onClick={() => setTab('proximos')}>
              Próximos ({proximos.length})
            </button>
            <button className={`tab ${tab === 'pasados' ? 'active' : ''}`} onClick={() => setTab('pasados')}>
              Pasados ({pasados.length})
            </button>
          </div>

          {mostrados.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Icon name={tab === 'proximos' ? 'calendar' : 'clipboard'} /></div>
              {turnos.length === 0 ? (
                <>
                  <p>No encontramos turnos reservados con {user.email}.</p>
                  <p className="text-sm text-muted mt-sm">
                    Si reservaste con otra cuenta de Google, entrá con esa. Si el negocio te anotó a mano
                    (por teléfono o WhatsApp), el turno está en su agenda: consultalo con ellos.
                  </p>
                  <button type="button" className="btn btn-primary mt-lg" onClick={otraCuenta}>
                    Entrar con otra cuenta
                  </button>
                </>
              ) : (
                <p>{tab === 'proximos' ? 'No tenés turnos próximos.' : 'No tenés turnos pasados.'}</p>
              )}
            </div>
          ) : (
            mostrados.map((t) => {
              const negocio = datos.negocios[t.businessId];
              const prof = datos.profesionales[t.professionalId];
              const sucursal = datos.sucursales[t.branchId];
              const estado = ESTADOS[t.status] || { label: t.status, className: 'badge-warning' };
              const direccion = sucursal?.address || negocio?.address;
              return (
                <div key={t.id} className="card appointment-card">
                  <div className="appointment-info">
                    {negocio ? (
                      <Link to={`/${negocio.slug}`} className="mis-turnos-negocio">
                        {negocio.logoUrl
                          ? <img src={negocio.logoUrl} alt="" />
                          : <Icon name="building" />}
                        {negocio.name}
                      </Link>
                    ) : (
                      <span className="mis-turnos-negocio">Negocio que ya no está en Slotly</span>
                    )}
                    <h3>{t.serviceName || 'Turno'}{prof ? ` con ${prof.name}` : ''}</h3>
                    <div className="details">
                      <span><Icon name="calendar" /> {formatDate(t.appointmentDate)}</span>
                      <span><Icon name="clock" /> {t.startTime}</span>
                      {sucursal && !sucursal.isMain && <span><Icon name="building" /> {sucursal.name}</span>}
                    </div>
                    {(direccion || t.price != null) && (
                      <div className="details mt-sm">
                        {direccion && <span><Icon name="pin" /> {direccion}</span>}
                        {t.price != null && <span>{formatPrice(t.price, negocio?.currency)}</span>}
                        {t.depositStatus === 'pagada' && <span><Icon name="lock" /> Seña pagada: {formatPrice(t.depositAmount, negocio?.currency)}</span>}
                        {t.depositStatus === 'devuelta' && <span><Icon name="lock" /> Seña devuelta</span>}
                      </div>
                    )}
                  </div>
                  <div className="appointment-actions">
                    {esperandoSena(t) && negocio ? (
                      <>
                        <span className="badge badge-warning">Falta pagar la seña</span>
                        <Link className="btn btn-primary btn-sm" to={`/${negocio.slug}/pago?turno=${t.id}`}>
                          <Icon name="lock" /> Pagar seña
                        </Link>
                      </>
                    ) : (
                      <span className={`badge ${estado.className}`}>{estado.label}</span>
                    )}
                    {activo(t) && !yaPaso(t) && (
                      puedeCancelar(t, negocio) ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          disabled={cancelando === t.id}
                          onClick={() => handleCancelar(t)}
                        >
                          {cancelando === t.id ? 'Cancelando…' : 'Cancelar'}
                        </button>
                      ) : (
                        <span className="text-sm text-muted" title={`Se puede cancelar hasta ${horasMinimas(negocio)} h antes`}>
                          Para cancelar, escribile al negocio
                        </span>
                      )
                    )}
                    {tab === 'pasados' && negocio && (
                      <Link className="btn btn-outline btn-sm" to={`/${negocio.slug}`}>Reservar de nuevo</Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
