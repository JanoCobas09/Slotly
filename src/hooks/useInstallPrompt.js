import { useEffect, useState } from 'react';
import { getEstadoInstalacion, suscribirInstalacion, dispararPrompt } from '../lib/installPrompt';

/**
 * Instalación del PWA del panel (`manifest.webmanifest`, `start_url: /admin`).
 * El evento `beforeinstallprompt` en sí se escucha en `lib/installPrompt.js`
 * (a nivel de módulo, desde antes de que exista este componente) — acá solo
 * se lee ese estado compartido y se expone de forma cómoda para la UI.
 *
 * iOS Safari (y cualquier navegador en iOS, todos corren sobre WebKit) NUNCA
 * dispara ese evento: ahí solo se puede instalar a mano desde Compartir →
 * "Agregar a inicio", así que esto expone `esIOS` para mostrar esas
 * instrucciones en vez de un botón que no haría nada.
 */
export function useInstallPrompt() {
  const [estado, setEstado] = useState(getEstadoInstalacion);

  useEffect(() => suscribirInstalacion(() => setEstado(getEstadoInstalacion())), []);

  const esIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  return {
    instalada: estado.instalada,
    // Hay algo para ofrecer: o el navegador nos dio el prompt nativo, o
    // estamos en iOS y solo queda mostrar el paso a paso manual.
    instalable: !estado.instalada && (Boolean(estado.evento) || esIOS),
    conPromptNativo: Boolean(estado.evento),
    esIOS,
    // 'accepted' | 'dismissed' | null (null si no había prompt nativo para dar).
    instalar: dispararPrompt,
  };
}
