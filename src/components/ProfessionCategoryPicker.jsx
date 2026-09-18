import { listProfessionCategories } from '../config/professionPresets';
import Icon from './Icon';

const PROFESSION_CATEGORIES = listProfessionCategories();
export const OTHER_OPTION = 'other';

/**
 * Tarjetas seleccionables de rubro (professionPresets.js) con ícono propio,
 * más "No encuentro mi profesión" con texto libre. Usado en el alta manual
 * (super-admin/NewBusinessModal) y en el alta self-service
 * (client/OnboardingPage) — mismo selector, dos formularios alrededor muy
 * distintos, así que solo se comparte esto y no el resto del form.
 */
export default function ProfessionCategoryPicker({
  value,
  onChange,
  customProfession,
  onCustomProfessionChange,
  error,
  customError,
}) {
  return (
    <div className="form-group">
      <label className="form-label">¿Qué tipo de negocio o servicio ofrecés? <span className="required">*</span></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {PROFESSION_CATEGORIES.map((cat) => (
          <label
            key={cat.value}
            className="card card-selectable"
            style={{
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              border: value === cat.value ? '2px solid var(--primary)' : '1px solid var(--border-color)',
              margin: 0,
            }}
          >
            <input
              type="radio"
              name="professionOption"
              checked={value === cat.value}
              onChange={() => onChange(cat.value)}
            />
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                color: 'var(--primary)',
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              <Icon name={cat.icon} />
            </span>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: 12 }}>{cat.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{cat.examples}</div>
            </div>
          </label>
        ))}
        <label
          className="card card-selectable"
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            border: value === OTHER_OPTION ? '2px solid var(--primary)' : '1px solid var(--border-color)',
            margin: 0,
          }}
        >
          <input
            type="radio"
            name="professionOption"
            checked={value === OTHER_OPTION}
            onChange={() => onChange(OTHER_OPTION)}
          />
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--bg-secondary)',
              color: 'var(--primary)',
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            <Icon name="question" />
          </span>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: 12 }}>No encuentro mi profesión</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Escribila y la configuramos igual</div>
          </div>
        </label>
      </div>
      {error && <div className="form-error">{error}</div>}

      {value === OTHER_OPTION && (
        <div style={{ marginTop: 8 }}>
          <input
            className={`form-input ${customError ? 'error' : ''}`}
            value={customProfession}
            onChange={(e) => onCustomProfessionChange(e.target.value)}
            placeholder="Ej: Restaurador de instrumentos musicales"
          />
          {customError && <div className="form-error">{customError}</div>}
        </div>
      )}
    </div>
  );
}
