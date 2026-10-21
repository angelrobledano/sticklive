/**
 * Mapa motivo de fallo del login → clave i18n EXISTENTE (auth.*). Cubre los
 * reasons que el callback del API redirige por el scheme (fail consciente del
 * cliente: google_denied, google_not_configured, google_email,
 * account_disabled, bad_state, state_reused) y los codes de ApiError del
 * canje. Los codes del canje (invalid_code, network, http_*) no tienen clave
 * propia en los locales: caen al genérico auth.google_failed, que describe
 * exactamente ese caso ("no se pudo completar el acceso con Google").
 *
 * Extraído de settings.tsx (Task 3.3): la pantalla Favoritos repite el mismo
 * flujo de login (CTA "Entrar con Google") y debe mostrar los errores IGUAL;
 * una única tabla evita que las dos pantallas deriven.
 */
export function authErrorKey(reason: string): string {
  switch (reason) {
    case 'google_denied':
      return 'auth.google_denied';
    case 'google_not_configured':
      return 'auth.google_unavailable';
    case 'google_email':
      return 'auth.google_email';
    case 'account_disabled':
      return 'auth.account_disabled';
    case 'bad_state':
    case 'state_reused':
      return 'auth.google_state';
    case 'invalid_email':
      return 'auth.error_invalid_email';
    case 'email_not_configured':
      return 'auth.error_email_unavailable';
    case 'expired':
    case 'missing_token':
      return 'auth.expired';
    default:
      return 'auth.google_failed';
  }
}
