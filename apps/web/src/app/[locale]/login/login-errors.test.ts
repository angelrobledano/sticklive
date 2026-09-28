import { describe, it, expect } from 'vitest';
import { loginErrorKey } from './page';

/**
 * #362: los mensajes del API de login NO se muestran crudos. `loginErrorKey`
 * traduce el código de error del backend a una clave i18n segura; cualquier
 * código ausente o desconocido cae en un mensaje genérico (sin filtrar detalle
 * interno ni depender del idioma del servidor).
 */
describe('loginErrorKey (#362)', () => {
  it('mapea los códigos conocidos a claves i18n', () => {
    expect(loginErrorKey('invalid_email')).toBe('auth.error_invalid_email');
    expect(loginErrorKey('email_not_configured')).toBe('auth.error_email_unavailable');
    expect(loginErrorKey('expired')).toBe('auth.expired');
    expect(loginErrorKey('account_disabled')).toBe('auth.account_disabled');
  });

  it('códigos desconocidos o ausentes → mensaje genérico', () => {
    expect(loginErrorKey('server_error')).toBe('auth.error_generic');
    expect(loginErrorKey('missing_token')).toBe('auth.error_generic');
    expect(loginErrorKey(undefined)).toBe('auth.error_generic');
    expect(loginErrorKey(null)).toBe('auth.error_generic');
    expect(loginErrorKey('')).toBe('auth.error_generic');
  });
});
