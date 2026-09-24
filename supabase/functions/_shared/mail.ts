// ============================================================================
// Helper compartido para mandar mail (SMTP genérico vía nodemailer)
// ============================================================================
// Usado por create-appointment (confirmación al reservar) y send-reminders
// (recordatorio ~3hs antes). Mismo criterio en los dos: sin SMTP_HOST
// configurado no manda nada y no rompe — no todo entorno (ni el desarrollo
// local) tiene un servidor de correo real a mano.
import nodemailer from 'npm:nodemailer@6';

export interface OpcionesMail {
  to: string;
  subject: string;
  text: string;
  /** Nombre para mostrar en el "De:" — normalmente el nombre del negocio. */
  fromName?: string;
}

export function smtpConfigurado(): boolean {
  return Boolean(Deno.env.get('SMTP_HOST'));
}

/** true si se mandó de verdad, false si no había credenciales o falló el envío. */
export async function enviarMail({ to, subject, text, fromName }: OpcionesMail): Promise<boolean> {
  if (!smtpConfigurado()) {
    console.warn('[mail] Faltan las credenciales SMTP: no se manda nada.');
    return false;
  }
  const transportador = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST'),
    port: Number(Deno.env.get('SMTP_PORT') || 587),
    secure: Deno.env.get('SMTP_SECURE') === 'true',
    auth: Deno.env.get('SMTP_USER') ? { user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS') } : undefined,
  });
  const from = Deno.env.get('SMTP_FROM') || 'no-reply@slotly.app';
  try {
    await transportador.sendMail({
      from: fromName ? `"${fromName} vía Slotly" <${from}>` : from,
      to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error(`[mail] No se pudo mandar a ${to}:`, err);
    return false;
  }
}
