import { useRef, useState } from 'react';
import { archivoDelAdjunto, puedeCompartir, descargarAdjunto } from '../../../lib/verAdjunto';
import { mensajeDeError } from '../../../utils/errores';
import Icon from '../../Icon';

/**
 * "Compartir" de un archivo del turno: abre el menú de compartir del
 * teléfono (WhatsApp, mail, Drive…) con el archivo adjunto, para reenviarlo.
 *
 * El archivo se baja primero (puede tardar un poco). Los navegadores solo
 * dejan abrir el menú de compartir justo después de un toque: si la bajada
 * tardó y el navegador ya no lo permite, el botón pasa a "Tocá para enviar"
 * con el archivo ya listo, y el segundo toque lo abre al instante. Donde no
 * se pueden compartir archivos (muchas compus), se descarga para adjuntarlo
 * a mano, y se avisa.
 *
 * `conTexto`: botón con la palabra "Compartir" (no solo el ícono) — el
 * público de Slotly no siempre reconoce los íconos.
 */
export default function BotonCompartir({ adjunto, conTexto = false, onError, onAviso, className = '' }) {
  const [estado, setEstado] = useState('listo'); // listo | preparando | tocar
  const archivo = useRef(null);

  const mandar = async (file) => {
    try {
      await navigator.share({ files: [file], title: file.name });
      setEstado('listo');
    } catch (e) {
      if (e?.name === 'AbortError') { setEstado('listo'); return; } // cerró el menú
      if (e?.name === 'NotAllowedError') { setEstado('tocar'); return; } // pasó el momento del toque
      throw e;
    }
  };

  const compartir = async () => {
    onError?.('');
    try {
      if (archivo.current) { await mandar(archivo.current); return; }
      setEstado('preparando');
      const file = await archivoDelAdjunto(adjunto);
      archivo.current = file;
      if (!puedeCompartir(file)) {
        await descargarAdjunto(adjunto);
        setEstado('listo');
        onAviso?.('Este navegador no deja compartir archivos directo: lo descargamos para que lo adjuntes donde quieras.');
        return;
      }
      await mandar(file);
    } catch (e) {
      setEstado('listo');
      onError?.(mensajeDeError(e, 'No se pudo compartir el archivo.'));
    }
  };

  // En la tarjeta chica de una foto (sin texto) no entra la frase larga.
  const texto = estado === 'preparando' ? 'Preparando…' : estado === 'tocar' ? (conTexto ? 'Tocá para enviar' : 'Enviar') : 'Compartir';
  return (
    <button
      type="button"
      className={`btn btn-sm ${conTexto || estado === 'tocar' ? 'btn-outline' : 'btn-ghost btn-icon'} ${estado === 'tocar' ? 'btn-compartir-listo' : ''} ${className}`}
      onClick={compartir}
      disabled={estado === 'preparando'}
      aria-label={`${texto} ${adjunto.nombreOriginal}`}
      title={texto}
    >
      {estado === 'preparando' ? <span className="spinner spinner-sm" aria-hidden="true" /> : <Icon name="share" />}
      {(conTexto || estado === 'tocar') && <span>{texto}</span>}
    </button>
  );
}
