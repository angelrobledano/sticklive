/**
 * Envío de emails transaccionales (magic links).
 *
 * Config por entorno (.env / .env.prod):
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM ("Stick Live <no-reply@sticklive.eu>")
 *
 * Sin SMTP_HOST, POST /auth/verify responde 503 y el enlace NUNCA se
 * devuelve en la respuesta (el modo dev que lo muestra exige AUTH_DEV_LINKS=1
 * y no-producción; ver routes/auth.ts). Con SMTP_HOST, este módulo es el
 * único camino.
 *
 * ── Nota de versiones ──────────────────────────────────────────────────────
 * `nodemailer` va en la 10.x, que YA trae sus propios tipos (no hace falta
 * `@types/nodemailer`, que se quedó en la 8.x). El salto 9→10 se hizo por el
 * aviso de seguridad de npm audit (bypass de validación de dominio y DoS del
 * parser de direcciones); ninguna de esas rutas se usa aquí (se envía texto y
 * HTML literales a un email ya validado, por SMTP directo). Las firmas de
 * createTransport/sendMail que usamos no cambiaron.
 *
 * Si algún día se añaden adjuntos por URL, releer esto antes.
 */
import { createTransport, type Transporter } from 'nodemailer';

const FROM = process.env['SMTP_FROM'] ?? 'Stick Live <no-reply@sticklive.eu>';

export type MagicLinkDelivery = 'send' | 'dev-link' | 'unconfigured';

/**
 * Decide cómo entregar el magic link según el entorno, sin tocar red.
 *
 *   - 'send'         → hay SMTP_HOST: se envía por email.
 *   - 'dev-link'     → sin SMTP pero modo dev explícito (`AUTH_DEV_LINKS=1` fuera
 *                      de producción): se devuelve en la respuesta (INSEGURO).
 *   - 'unconfigured' → sin SMTP en producción: 503, el enlace NUNCA se filtra.
 */
export function magicLinkDelivery(
  smtpHost: string | undefined,
  devLinks: boolean,
): MagicLinkDelivery {
  if (smtpHost) return 'send';
  return devLinks ? 'dev-link' : 'unconfigured';
}

let _transporter: Transporter | null = null;

function transporter(): Transporter {
  if (_transporter) return _transporter;
  const host = process.env['SMTP_HOST'];
  if (!host) throw new Error('SMTP_HOST no configurado');
  _transporter = createTransport({
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
