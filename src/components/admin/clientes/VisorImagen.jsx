import { useEffect } from 'react';
import Icon from '../../Icon';

/** Foto a pantalla completa. Se cierra tocando afuera, con la X o con Escape. */
export default function VisorImagen({ nombre, url, detalle = null, onClose }) {
  useEffect(() => {
    const alTeclear = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onClose]);

  return (
    <div className="doc-visor" role="dialog" aria-label={nombre} onClick={onClose}>
      <button type="button" className="doc-visor-cerrar" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
      <img src={url} alt={nombre} onClick={(e) => e.stopPropagation()} />
      <span className="doc-visor-nombre">{nombre}{detalle && <><br />{detalle}</>}</span>
    </div>
  );
}
