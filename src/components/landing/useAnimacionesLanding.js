// ============================================================================
// Animaciones de la landing con GSAP (prueba, rama prueba/landing-gsap)
// ============================================================================
// Solo en la landing: el panel y la reserva siguen con sus animaciones CSS
// (index.css, "MOVIMIENTO E INTERACCIÓN"), más livianas para celulares
// baratos. Acá el objetivo es otro: que quien todavía no es cliente vea un
// producto cuidado.
//
// GSAP + ScrollTrigger pesan ~48 KB comprimidos y la landing es lo PRIMERO
// que carga cualquiera: por eso se bajan DESPUÉS de que la página ya se ve
// (import dinámico, cuando el navegador está libre) y solo animan lo que está
// más abajo — títulos de cada sección y tarjetas al llegar con el scroll, y
// la vitrina. El título del inicio entra con CSS puro (.hero-palabra en
// index.css), sin esperar a nada.
//
// Lo que ya está en pantalla cuando GSAP termina de bajar NO se esconde (si
// no, parpadearía: se ve, desaparece, vuelve a entrar). Nada corre con
// "reducir movimiento" activado (gsap.matchMedia). Todo termina con
// clearProps: no quedan transform puestos (el botón flotante de WhatsApp y la
// barra del celular de la vitrina son position: fixed, y un transform en un
// ancestro los correría).
import { useEffect } from 'react';

const SIN_PREFERENCIA = '(prefers-reduced-motion: no-preference)';

/** ¿Todavía no se ve? (abajo del borde inferior de la pantalla) */
const abajoDeLaPantalla = (el) => el.getBoundingClientRect().top > window.innerHeight;

function animar(gsap, ScrollTrigger, raiz) {
  const $ = (sel, dentro = raiz) => [...dentro.querySelectorAll(sel)];
  const listo = { clearProps: 'transform,opacity' };
  const mm = gsap.matchMedia();

  mm.add(SIN_PREFERENCIA, () => {
    // ── Títulos de cada sección, al llegar con el scroll ──────────────────
    for (const seccion of $('.landing-section, .landing-final')) {
      const cabecera = $(':scope > .eyebrow, :scope > .landing-h2, :scope > .landing-sub, :scope > .landing-lead', seccion)
        .filter(abajoDeLaPantalla);
      if (!cabecera.length) continue;
      gsap.from(cabecera, {
        y: 26, opacity: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08, ...listo,
        scrollTrigger: { trigger: seccion, start: 'top 82%', once: true },
      });
    }

    // ── Tarjetas (problemas, funciones, pasos, precios, dudas) ────────────
    // En tandas: las que entran juntas en pantalla aparecen en cascada.
    const tarjetas = $('.landing-grid-3 > *, .landing-faq > *, .landing-demo, .landing-comunes').filter(abajoDeLaPantalla);
    gsap.set(tarjetas, { y: 40, opacity: 0 });
    ScrollTrigger.batch(tarjetas, {
      start: 'top 90%',
      once: true,
      onEnter: (tanda) => gsap.to(tanda, {
        y: 0, opacity: 1, duration: 0.65, ease: 'power2.out', stagger: 0.1, overwrite: true, ...listo,
      }),
    });

    // "El más elegido": un pequeño salto cuando aparece su tarjeta.
    const etiqueta = raiz.querySelector('.landing-price-tag');
    if (etiqueta && abajoDeLaPantalla(etiqueta)) {
      gsap.from(etiqueta, {
        scale: 0.4, opacity: 0, duration: 0.5, ease: 'back.out(2.5)', delay: 0.35, ...listo,
        scrollTrigger: { trigger: etiqueta.closest('.landing-price'), start: 'top 88%', once: true },
      });
    }

    // ── La vitrina: el panel desde el costado, el celular desde abajo ────
    const vitrina = raiz.querySelector('.vitrina');
    if (vitrina && abajoDeLaPantalla(vitrina)) {
      gsap.timeline({ scrollTrigger: { trigger: vitrina, start: 'top 75%', once: true } })
        .from(vitrina.querySelector('.vitrina-panel'), { x: -50, opacity: 0, duration: 0.8, ease: 'power3.out', ...listo })
        .from(vitrina.querySelector('.vitrina-celu'), { y: 80, opacity: 0, scale: 0.94, duration: 0.9, ease: 'power3.out', ...listo }, '<0.15');
    }

    // ── El botón de WhatsApp del cierre: un latido al aparecer ────────────
    const cierre = raiz.querySelector('.landing-final .btn');
    if (cierre && abajoDeLaPantalla(cierre)) {
      gsap.from(cierre, {
        scale: 0.9, opacity: 0, duration: 0.6, ease: 'back.out(2)', ...listo,
        scrollTrigger: { trigger: cierre, start: 'top 92%', once: true },
      });
    }
  });
  return mm;
}

export function useAnimacionesLanding(raiz) {
  useEffect(() => {
    if (!window.matchMedia(SIN_PREFERENCIA).matches) return undefined;
    let mm = null;
    let cancelado = false;
    const cargar = () => Promise.all([import('gsap'), import('gsap/ScrollTrigger')])
      .then(([{ default: gsap }, { ScrollTrigger }]) => {
        if (cancelado || !raiz.current) return;
        gsap.registerPlugin(ScrollTrigger);
        mm = animar(gsap, ScrollTrigger, raiz.current);
      })
      .catch((err) => console.error('[landing] No se pudieron cargar las animaciones:', err));
    // Cuando el navegador está libre: primero que se vea la página.
    const id = 'requestIdleCallback' in window
      ? window.requestIdleCallback(cargar, { timeout: 1500 })
      : setTimeout(cargar, 300);
    return () => {
      cancelado = true;
      if ('requestIdleCallback' in window) window.cancelIdleCallback(id); else clearTimeout(id);
      mm?.revert();
    };
  }, [raiz]);
}
