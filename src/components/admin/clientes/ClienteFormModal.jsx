import { useState } from 'react';
import { crearCliente, actualizarCliente } from '../../../lib/repository';
import { validarCliente, LIMITES } from '../../../utils/validaciones';
import { useErrorDeCampo } from '../../../hooks/useErrorDeCampo';
import ErrorDeCampo from '../../ErrorDeCampo';
import Icon from '../../Icon';
import { mensajeDeError } from '../../../utils/errores';

/**
 * Alta (solo el dueño) o edición de una ficha. En una ficha con cuenta de
 * Google el mail es el de la cuenta y no se edita; el nombre sí: arranca con
 * el de Google y después es del negocio (ningún login lo vuelve a pisar).
 */
export default function ClienteFormModal({ businessId, ficha = null, onClose, onGuardado }) {
  const editando = Boolean(ficha);
  const conCuenta = Boolean(ficha?.conCuenta);
  const [form, setForm] = useState({
    nombre: ficha?.nombre || '',
    telefono: ficha?.telefono || '',
    email: ficha?.email || '',
    observaciones: ficha?.observaciones || '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const errorCampo = useErrorDeCampo();

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    if (errorCampo.marcar(validarCliente(form, { conCuenta }))) return;
    setGuardando(true);
    setError('');
    try {
      if (editando) {
        const cambios = { nombre: form.nombre, telefono: form.telefono, observaciones: form.observaciones };
        if (!conCuenta) cambios.email = form.email;
        await actualizarCliente(ficha.id, cambios);
        onGuardado?.(ficha.id);
      } else {
        onGuardado?.(await crearCliente(businessId, form));
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la ficha.'));
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content" onClick={(e) => e.stopPropagation()} onSubmit={guardar} style={{ maxWidth: 480 }} noValidate>
        <div className="modal-header">
          <h3>{editando ? 'Editar ficha' : 'Nuevo cliente'}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
        </div>
        <div className="modal-body flex flex-col gap-md">
          <div className="form-group">
            <label className="form-label" htmlFor="cli-nombre">Nombre</label>
            <input id="cli-nombre" className="form-input" value={form.nombre} onChange={set('nombre')} maxLength={LIMITES.nombreCliente} autoFocus {...errorCampo.campo('nombre')} />
            {conCuenta && ficha?.nombreGoogle && ficha.nombreGoogle !== form.nombre && (
              <span className="text-xs text-muted">En Google figura como “{ficha.nombreGoogle}”.</span>
            )}
            <ErrorDeCampo error={errorCampo} campo="nombre" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cli-telefono">Teléfono <span className="text-muted">(opcional)</span></label>
            <input id="cli-telefono" className="form-input" type="tel" inputMode="tel" value={form.telefono} onChange={set('telefono')} maxLength={LIMITES.telefono} {...errorCampo.campo('telefono')} />
            <ErrorDeCampo error={errorCampo} campo="telefono" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cli-email">Email {conCuenta ? <span className="text-muted">(el de su cuenta de Google)</span> : <span className="text-muted">(opcional)</span>}</label>
            <input id="cli-email" className="form-input" type="email" value={form.email} onChange={set('email')} disabled={conCuenta} maxLength={LIMITES.email} {...errorCampo.campo('email')} />
            <ErrorDeCampo error={errorCampo} campo="email" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="cli-obs">Observaciones <span className="text-muted">(solo las ve el equipo)</span></label>
            <textarea id="cli-obs" className="form-input" rows={4} value={form.observaciones} onChange={set('observaciones')} maxLength={LIMITES.observaciones} {...errorCampo.campo('observaciones')} />
            <ErrorDeCampo error={errorCampo} campo="observaciones" />
          </div>
          {error && <div className="notice notice-danger" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  );
}
