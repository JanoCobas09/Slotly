import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformOwner } from '../../config/platform';
import { PLANS, DEFAULT_PLAN_ID } from '../../config/plans';
import { getProfessionPreset, matchProfessionCategory, DEFAULT_PROFESSION_CATEGORY } from '../../config/professionPresets';
import { createBusinessSelfService } from '../../lib/functions';
import ProfessionCategoryPicker, { OTHER_OPTION } from '../../components/ProfessionCategoryPicker';
import { LIMITES } from '../../utils/validaciones';

// Mismo número que la landing, el panel y CuentaSinNegocio. Si cambia, cambia en los cuatro.
const WHATSAPP = '5492257660073';
const LINK_WA = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  'Hola! Prefiero que me armen la cuenta ustedes en vez de hacerlo yo.'
)}`;

/**
 * Alta self-service: a diferencia del alta manual (que hace la plataforma
 * desde /super-admin, ver CLAUDE.md), esto lo completa la propia persona la
 * primera vez que entra con Google y todavía no tiene negocio. Reemplaza a
 * CuentaSinNegocio como destino por defecto de ese login — esa pantalla
 * sigue existiendo para quien prefiere que se lo armen a mano.
 *
 * Las preguntas son las mismas que pide el alta manual (rubro, color, plan):
 * el resultado en Firestore es un negocio equivalente, solo que lo completa
 * el cliente en vez de la plataforma. El resto (horarios, servicios, staff)
 * se carga después desde el panel, igual que hoy.
 */
export default function OnboardingPage() {
  const { user, refreshClaims } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [professionOption, setProfessionOption] = useState('');
  const [customProfession, setCustomProfession] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#404040');
  const [colorEdited, setColorEdited] = useState(false);
  const [planId, setPlanId] = useState(DEFAULT_PLAN_ID);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Quien ya tiene negocio (o es del equipo de plataforma) no tiene nada que
  // hacer acá — lo manda a su panel en vez de dejarlo rellenar esto de nuevo.
  useEffect(() => {
    const platformTeam = user?.isPlatformTeam || isPlatformOwner(user?.email);
    if (platformTeam) navigate('/super-admin', { replace: true });
    else if (['owner', 'admin', 'manager'].includes(user?.role)) navigate('/admin', { replace: true });
  }, [user, navigate]);

  const handleProfessionChange = (option) => {
    setProfessionOption(option);
    if (option && option !== OTHER_OPTION && !colorEdited) {
      setPrimaryColor(getProfessionPreset(option).theme.primaryColor);
    }
  };

  const handleCustomProfessionChange = (text) => {
    setCustomProfession(text);
    if (!colorEdited) {
      setPrimaryColor(getProfessionPreset(matchProfessionCategory(text)).theme.primaryColor);
    }
  };

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Ponele un nombre a tu negocio.';
    else if (name.trim().length < 2 || name.trim().length > LIMITES.nombre) e.name = `El nombre tiene que tener entre 2 y ${LIMITES.nombre} caracteres.`;
    if (!professionOption) e.professionOption = 'Elegí una opción.';
    if (professionOption === OTHER_OPTION && !customProfession.trim()) {
      e.customProfession = 'Contanos cuál es.';
    } else if (customProfession.trim().length > LIMITES.textoCorto) {
      e.customProfession = `Hasta ${LIMITES.textoCorto} caracteres.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;

    const professionCategory = professionOption === OTHER_OPTION
      ? matchProfessionCategory(customProfession)
      : professionOption || DEFAULT_PROFESSION_CATEGORY;

    setError('');
    setEnviando(true);
    try {
      await createBusinessSelfService({
        name: name.trim(),
        professionCategory,
        customProfession: professionOption === OTHER_OPTION ? customProfession.trim() : '',
        primaryColor: colorEdited ? primaryColor : null,
        planId,
      });
      // El token todavía no tiene el businessId/role recién asignados: sin
      // este refresh, /admin rebota porque ProtectedRoute lo sigue viendo
      // sin permisos hasta que Firebase renueve el token solo (hasta 1 hora).
      await refreshClaims();
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message || 'No se pudo crear la cuenta. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-lg) var(--space-md) var(--space-2xl)' }}>
      <h1>Creá tu cuenta</h1>
      <p className="text-secondary" style={{ marginBottom: 'var(--space-lg)' }}>
        {user?.email && <>Entraste como <strong>{user.email}</strong>. </>}
        Empezás con <strong>48 horas de prueba gratis</strong>, sin tarjeta. Si no
        la habilitás a tiempo la cuenta queda suspendida hasta que nos avisés y
        la activemos; si pasa una semana más sin novedades, se borra sola.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
          <label className="form-label">Nombre de tu negocio <span className="required">*</span></label>
          <input
            className={`form-input ${errors.name ? 'error' : ''}`}
            value={name}
            maxLength={LIMITES.nombre}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de tu negocio"
            autoFocus
          />
          {errors.name && <div className="form-error">{errors.name}</div>}
        </div>

        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <ProfessionCategoryPicker
            value={professionOption}
            onChange={handleProfessionChange}
            customProfession={customProfession}
            onCustomProfessionChange={handleCustomProfessionChange}
            error={errors.professionOption}
            customError={errors.customProfession}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
          <label className="form-label">Color de marca</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => { setPrimaryColor(e.target.value); setColorEdited(true); }}
              style={{ width: 44, height: 36, padding: 0, border: '1px solid var(--border-color)', borderRadius: 8, cursor: 'pointer' }}
            />
            <span className="text-sm text-muted">
              {colorEdited ? 'Tu color elegido.' : 'Sugerido para tu rubro.'} Lo podés cambiar cuando
              quieras desde Configuración.
            </span>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
          <label className="form-label">Elegí un plan <span className="required">*</span></label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLANS.map((plan) => (
              <label
                key={plan.id}
                className="card card-selectable"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  border: planId === plan.id ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="planId"
                  checked={planId === plan.id}
                  onChange={() => setPlanId(plan.id)}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: 13 }}>{plan.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {plan.description} · ${plan.monthlyFee.toLocaleString('es-AR')} ARS/mes
                  </div>
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted" style={{ marginTop: 8 }}>
            No se te cobra nada ahora. Cuando termine la prueba, nos avisás por
            WhatsApp que ya pagaste y te habilitamos la cuenta.
          </p>
        </div>

        {error && (
          <div
            className="badge badge-danger"
            style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}
          >
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg" disabled={enviando} style={{ width: '100%' }}>
          {enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta y empezar'}
        </button>
      </form>

      <div
        style={{
          marginTop: 'var(--space-xl)',
          paddingTop: 'var(--space-md)',
          borderTop: '1px solid var(--border-color)',
          textAlign: 'center',
        }}
      >
        <p className="text-sm text-secondary" style={{ marginBottom: 8 }}>
          ¿Preferís que te lo armemos nosotros?
        </p>
        <a href={LINK_WA} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
          Hablemos por WhatsApp →
        </a>
      </div>
    </div>
  );
}
