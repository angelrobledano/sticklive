/**
 * Envío de emails transaccionales (magic links).
 *
 * Config por entorno (.env / .env.prod):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM ("Stick Live <no-reply@sticklive.eu>")
 *
 * Sin SMTP_HOST la API queda en modo dev (el link se devuelve en la
 * respuesta); con él, este módulo es el único camino.
 *
 * ── Nota de versiones ──────────────────────────────────────────────────────
 * `nodemailer` va en la 9.x y `@types/nodemailer` en la 8.x. NO es un descuido
 * pendiente de arreglar: a día de hoy (21/07/2026) no existen tipos 9.x
 * publicados. La 9.0.0 no cambió ninguna firma — su único cambio incompatible
 * es que valida el certificado TLS al descargar contenido remoto (adjuntos por
 * URL, endpoints OAuth2, proxy CONNECT), y aquí no hacemos nada de eso: se
 * envía texto y HTML literales por SMTP directo. Los tipos de la 8 describen
 * con exactitud lo que usamos.
 *
 * Si algún día se añaden adjuntos por URL, releer esto antes.
 */
import nodemailer from 'nodemailer';

const FROM = process.env['SMTP_FROM'] ?? 'Stick Live <no-reply@sticklive.eu>';

let _transporter: nodemailer.Transporter | null = null;

function transporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;
  const host = process.env['SMTP_HOST'];
  if (!host) throw new Error('SMTP_HOST no configurado');
  _transporter = nodemailer.createTransport({
    host,
    port: Number(process.env['SMTP_PORT'] ?? 587),
    secure: Number(process.env['SMTP_PORT'] ?? 587) === 465,
    auth: {
      user: process.env['SMTP_USER'] ?? '',
      pass: process.env['SMTP_PASS'] ?? '',
    },
  });
  return _transporter;
}

export async function sendMagicLink(to: string, link: string): Promise<void> {
  await transporter().sendMail({
    from: FROM,
    to,
    subject: 'Tu acceso a Stick Live',
    text:
      `Hola,\n\n` +
      `Pulsa este enlace para entrar en Stick Live (caduca en 15 minutos):\n\n` +
      `${link}\n\n` +
      `Si no has pedido este acceso, ignora este mensaje.\n\n` +
      `— Stick Live · hockey patines en directo`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:420px;margin:0 auto;padding:24px">
        <p style="font-size:20px;font-weight:800;margin:0 0 4px">
          <span style="color:#9f1239">Stick</span> Live
        </p>
        <p style="color:#334155;font-size:14px;line-height:1.5">
          Pulsa el botón para entrar. El enlace caduca en <strong>15 minutos</strong>.
        </p>
        <p style="margin:24px 0">
          <a href="${link}"
             style="background:#9f1239;color:#fff;text-decoration:none;font-weight:700;
                    padding:12px 24px;border-radius:12px;display:inline-block">
            Entrar en Stick Live
          </a>
        </p>
        <p style="color:#94a3b8;font-size:12px;line-height:1.5">
          Si el botón no funciona, copia este enlace:<br>
          <a href="${link}" style="color:#9f1239;word-break:break-all">${link}</a>
        </p>
        <p style="color:#94a3b8;font-size:12px">
          Si no has pedido este acceso, ignora este mensaje.
        </p>
      </div>`,
  });
}
