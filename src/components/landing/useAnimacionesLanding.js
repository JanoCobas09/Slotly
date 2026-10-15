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
// más abajo — títulos de cada sección y tarjetas al llegar con el scroll, los
// números de "Por qué Slotly" contando (0%, 1 día, $12.000), los problemas
// desde los costados, los números de los pasos con un salto, y el celular de
// la vitrina entrando en 3D. El título del inicio entra con CSS puro (.hero-palabra en
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

/** Texto de un número animado: "$12.000", "0%", "1 día". */
function formatear(n, { prefijo = '', sufijo = '', sufijoPlural = sufijo, miles = false }) {
  const redondo = Math.round(n);
  return `${prefijo}${miles ? redondo.toLocaleString('es-AR') : redondo}${redondo === 1 ? sufijo : sufijoPlural}`;
}

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
        y: 50, opacity: 0, duration: 0.8, ease: 'power3.out', stagger: 0.1, ...listo,
        scrollTrigger: { trigger: seccion, start: 'top 82%', once: true },
      });
    }

    // ── "Por qué Slotly": tarjetas que crecen y números que cuentan ───────
    const diferenciales = $('.landing-diferencial').filter(abajoDeLaPantalla);
    if (diferenciales.length) {
      gsap.from(diferenciales, {
        y: 60, scale: 0.85, opacity: 0, duration: 0.8, ease: 'back.out(1.6)', stagger: 0.12, ...listo,
        scrollTrigger: { trigger: diferenciales[0], start: 'top 85%', once: true },
      });
    }
    for (const el of $('[data-contar]').filter(abajoDeLaPantalla)) {
      const cfg = JSON.parse(el.dataset.contar);
      const final = el.textContent;
      const n = { v: cfg.desde };
      el.textContent = formatear(cfg.desde, cfg);
      gsap.to(n, {
        v: cfg.hasta, duration: 1.6, ease: 'power2.out', delay: 0.3,
        onUpdate: () => { el.textContent = formatear(n.v, cfg); },
        onComplete: () => { el.textContent = final; },
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      });
    }

    // ── Problemas: entran desde los costados ──────────────────────────────
    $('#problema .landing-card').filter(abajoDeLaPantalla).forEach((card, i) => {
      gsap.from(card, {
        x: i % 2 === 0 ? -70 : 70, rotation: i % 2 === 0 ? -3 : 3, opacity: 0,
        duration: 0.8, ease: 'power3.out', ...listo,
        scrollTrigger: { trigger: card, start: 'top 88%', once: true },
      });
    });

    // ── Pasos: el número aparece con un salto ─────────────────────────────
    $('.landing-step-num').filter(abajoDeLaPantalla).forEach((num, i) => {
      gsap.from(num, {
        scale: 0, rotation: -90, opacity: 0, duration: 0.7, ease: 'back.out(2.5)', delay: 0.15 + i * 0.15, ...listo,
        scrollTrigger: { trigger: num, start: 'top 90%', once: true },
      });
    });

    // ── Tarjetas (funciones, pasos, precios, dudas) ───────────────────────
    // En tandas: las que entran juntas en pantalla aparecen en cascada.
    const tarjetas = $('.landing-grid-3 > *, .landing-faq > *, .landing-demo, .landing-comunes')
      .filter((el) => !el.closest('#problema'))
      .filter(abajoDeLaPantalla);
    gsap.set(tarjetas, { y: 60, opacity: 0 });
    ScrollTrigger.batch(tarjetas, {
      start: 'top 90%',
      once: true,
      onEnter: (tanda) => gsap.to(tanda, {
        y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', stagger: 0.12, overwrite: true, ...listo,
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
        .from(vitrina.querySelector('.vitrina-celu'), {
          y: 120, rotationX: 35, rotationY: -20, scale: 0.8, opacity: 0, transformPerspective: 900,
          duration: 1.2, ease: 'power3.out', ...listo,
        }, '<0.15');
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
