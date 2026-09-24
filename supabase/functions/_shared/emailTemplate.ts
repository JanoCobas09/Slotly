// ============================================================================
// Plantilla HTML compartida para los mails transaccionales
// ============================================================================
// Un mail de texto plano, sin nada más, es justo el perfil que muchos
// filtros de spam castigan (nada que "parezca" un mail transaccional de
// verdad). Esto no arregla la causa de fondo — eso pide un dominio propio
// con SPF/DKIM/DMARC — pero un HTML prolijo, con la identidad de Slotly,
// ayuda y es gratis mientras tanto. Estilos en línea a propósito: la
// mayoría de los clientes de mail (Gmail incluido) ignoran o recortan un
// <style> en el <head>.
//
// Mismos colores que la identidad "Warm Utility" del producto (ver
// CLAUDE.md / src/index.css): petróleo/teal de marca, acento terracota,
// fondo cálido — para que el mail se sienta parte de la misma marca que
// el negocio ya usa en el panel y en la reserva.

const COLOR_MARCA = '#28706f';
const COLOR_ACENTO = '#c87957';
const COLOR_FONDO = '#fafaf7';
const COLOR_TARJETA = '#ffffff';
const COLOR_TEXTO = '#202524';
const COLOR_TEXTO_SEC = '#565c59';
const COLOR_BORDE = '#e7e2d8';
const FUENTE = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface FilaResumen {
  label: string;
  value: string;
}

export interface PlantillaMailArgs {
  /** Texto chico arriba del título, ej. el nombre del negocio. */
  eyebrow: string;
  /** Título grande, ej. "Turno confirmado" o "Recordatorio de tu turno". */
  titulo: string;
  /** Primer párrafo, ej. "Hola Juan, tu turno en Barbería X quedó confirmado." */
  intro: string;
  /** Filas del resumen (Fecha, Horario, Servicio, Precio...). */
  filas: FilaResumen[];
  /** Nota final, opcional (ej. "Si no podés asistir, avisale al negocio."). */
  nota?: string;
}

/** Arma el HTML completo del mail. Todo en tablas + estilos en línea. */
export function plantillaHtml({ eyebrow, titulo, intro, filas, nota }: PlantillaMailArgs): string {
  const filasHtml = filas
    .map(
      (f, i) => `
        <tr>
          <td style="padding:10px 0; ${i > 0 ? `border-top:1px solid ${COLOR_BORDE};` : ''} font-family:${FUENTE}; font-size:13px; color:${COLOR_TEXTO_SEC};">
            ${escapeHtml(f.label)}
          </td>
          <td style="padding:10px 0; ${i > 0 ? `border-top:1px solid ${COLOR_BORDE};` : ''} font-family:${FUENTE}; font-size:14px; color:${COLOR_TEXTO}; font-weight:600; text-align:right;">
            ${escapeHtml(f.value)}
          </td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0; padding:0; background:${COLOR_FONDO};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR_FONDO}; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr>
            <td style="padding-bottom:20px; text-align:center;">
              <span style="font-family:${FUENTE}; font-size:20px; font-weight:800; color:${COLOR_MARCA}; letter-spacing:-0.01em;">Slotly</span>
            </td>
          </tr>
          <tr>
            <td style="background:${COLOR_TARJETA}; border-radius:12px; overflow:hidden; border:1px solid ${COLOR_BORDE};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${COLOR_MARCA}; padding:20px 24px;">
                    <div style="font-family:${FUENTE}; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.75);">
                      ${escapeHtml(eyebrow)}
                    </div>
                    <div style="font-family:${FUENTE}; font-size:20px; font-weight:800; color:#ffffff; margin-top:4px;">
                      ${escapeHtml(titulo)}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 18px; font-family:${FUENTE}; font-size:14px; line-height:1.6; color:${COLOR_TEXTO};">
                      ${escapeHtml(intro)}
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${filasHtml}
                    </table>
                    ${nota ? `<p style="margin:20px 0 0; font-family:${FUENTE}; font-size:12.5px; line-height:1.5; color:${COLOR_TEXTO_SEC};">${escapeHtml(nota)}</p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top:20px; text-align:center;">
              <span style="font-family:${FUENTE}; font-size:11px; color:${COLOR_ACENTO}; font-weight:600; letter-spacing:.03em;">
                Enviado por Slotly — turnos y reservas online
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
