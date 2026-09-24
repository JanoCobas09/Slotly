// Genera los íconos de public/icons/ — el glifo original de tres barras
// (blanco sobre negro, el de siempre) con un solo ajuste real: el tamaño.
// El diseño original ocupaba una caja de 34x30 en un lienzo de 64 SIN
// margen para el recorte del sistema operativo — a círculo (Android) o
// squircle, las esquinas de esa caja quedaban afuera del círculo inscripto
// y se veían cortadas. Acá se escala para que la diagonal de la caja quede
// claramente adentro del círculo de 80% de diámetro que pide la spec de
// maskable icons.
//
// Corré una vez con `node scripts/generate-app-icons.mjs` (pide `sharp`
// instalado — no es una dependencia del proyecto, instalar con
// `npm install --no-save sharp` antes de correrlo y no hace falta dejarlo).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const NEGRO = '#171717';

// Coordenadas originales (espacio local 64x64, centrado en 32,32 — igual
// que favicon.svg): tres barras decrecientes, bounding box x:15-49
// (ancho 34) y:17-47 (alto 30). Escaladas x7.5 y centradas en un lienzo de
// 512 (256,256): la diagonal de esa caja pasa de sobresalir del círculo de
// recorte a quedar ~17% adentro de su borde.
const BARRAS = `
  <g transform="translate(16 16) scale(7.5)">
    <rect x="15" y="17" width="34" height="8" rx="4" fill="#ffffff" />
    <rect x="15" y="28" width="26" height="8" rx="4" fill="#ffffff" fill-opacity="0.72" />
    <rect x="15" y="39" width="18" height="8" rx="4" fill="#ffffff" fill-opacity="0.44" />
  </g>
`;

// "any": esquinas redondeadas propias — así se ve en el escritorio/taskbar,
// donde el navegador no le aplica ninguna máscara encima.
const svgAny = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="115" fill="${NEGRO}" />
  ${BARRAS}
</svg>`;

// "maskable" (y apple-touch-icon): el negro tiene que llegar hasta el borde
// SIN redondear nada acá — es el sistema operativo el que recorta a
// círculo, squircle, etc. Mismo glifo reescalado (ver comentario arriba).
const svgFullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${NEGRO}" />
  ${BARRAS}
</svg>`;

await mkdir('public/icons', { recursive: true });

const trabajos = [
  { svg: svgAny, size: 192, out: 'public/icons/icon-192.png' },
  { svg: svgAny, size: 512, out: 'public/icons/icon-512.png' },
  { svg: svgFullBleed, size: 192, out: 'public/icons/maskable-192.png' },
  { svg: svgFullBleed, size: 512, out: 'public/icons/maskable-512.png' },
  { svg: svgFullBleed, size: 180, out: 'public/icons/apple-touch-icon.png' },
];

for (const { svg, size, out } of trabajos) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(out);
  console.log(`  ok  ${out} (${size}x${size})`);
}
