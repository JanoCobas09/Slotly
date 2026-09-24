import Icon from './Icon';

const COLORES = { success: 'var(--success)', danger: 'var(--danger)' };

/**
 * Confirmación flotante y transitoria (3s por defecto en quien la use). Existe
 * porque algunos avisos (ej. "se activaron las notificaciones push") pasaban
 * dentro de un panel desplegable que el dueño podía cerrar antes de leerlos —
 * esto queda visible aunque el panel que lo disparó ya se haya cerrado.
 */
export default function Toast({ tipo = 'success', children }) {
  return (
    <div className="app-toast" role="status" style={{ borderLeftColor: COLORES[tipo] || COLORES.success }}>
      <Icon name={tipo === 'danger' ? 'x-circle' : 'check-circle'} style={{ color: COLORES[tipo] || COLORES.success, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}
