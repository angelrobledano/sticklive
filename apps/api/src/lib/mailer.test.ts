import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock de nodemailer para no tocar red en el test de sendMagicLink.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail })),
}));

import { magicLinkDelivery } from './mailer.js';

describe('magicLinkDelivery', () => {
  it('con SMTP_HOST se envía por email (aunque AUTH_DEV_LINKS=1)', () => {
    expect(magicLinkDelivery('smtp.example', true)).toBe('send');
    expect(magicLinkDelivery('smtp.example', false)).toBe('send');
  });

  it('sin SMTP y modo dev explícito devuelve el enlace en la respuesta', () => {
    expect(magicLinkDelivery(undefined, true)).toBe('dev-link');
  });

  it('sin SMTP en producción NO hay entrega (503, nunca filtra el enlace)', () => {
    expect(magicLinkDelivery(undefined, false)).toBe('unconfigured');
  });
});

describe('sendMagicLink', () => {
  beforeEach(() => {
    vi.resetModules();
    sendMail.mockReset();
    sendMail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env['SMTP_HOST'];
  });

  it('compone y envía el email con el enlace', async () => {
    process.env['SMTP_HOST'] = 'smtp.test';
    const { sendMagicLink } = await import('./mailer.js');

    await sendMagicLink('fan@example.com', 'https://sticklive.eu/login?token=abc');

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0]![0] as { to: string; text: string; html: string };
    expect(mail.to).toBe('fan@example.com');
    expect(mail.text).toContain('https://sticklive.eu/login?token=abc');
    expect(mail.html).toContain('https://sticklive.eu/login?token=abc');
  });

  it('sin SMTP_HOST lanza y no intenta enviar', async () => {
    delete process.env['SMTP_HOST'];
    const { sendMagicLink } = await import('./mailer.js');

    await expect(sendMagicLink('fan@example.com', 'https://x')).rejects.toThrow('SMTP_HOST');
    expect(sendMail).not.toHaveBeenCalled();
  });
});
