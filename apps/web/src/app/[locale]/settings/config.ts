/**
 * Constantes de storage/entorno y tipos de la página de ajustes.
 */

export const THEME_KEY   = 'rink-theme';
export const NOTIF_KEY   = 'rink-notif-config';
export const DEVICE_KEY  = 'rink-device-id';
export const API_URL     = process.env['NEXT_PUBLIC_API_URL']   ?? 'http://localhost:3000';
export const REDSYS_URL  = 'https://sis-t.redsys.es:25443/sis/realizarPago'; // entorno de pruebas
/** Proveedor de pago activo: 'stripe' (por defecto) o 'redsys' */
export const PAYMENT_PROVIDER = process.env['NEXT_PUBLIC_PAYMENT_PROVIDER'] ?? 'stripe';
/** Monetización oculta de momento: la app es gratis. Activar con NEXT_PUBLIC_PREMIUM_ENABLED=1 */
export const PREMIUM_ENABLED = process.env['NEXT_PUBLIC_PREMIUM_ENABLED'] === '1';

export interface NotifConfig {
  /** Switch maestro: apaga todo el sistema de alertas */
  master: boolean;
  /** No molestar nocturno: partidos tardíos → resumen a la mañana siguiente */
  quietNight: boolean;
  globalJornadaStart: boolean;
  globalJornadaEnd: boolean;
  globalMatchStart: boolean;
  globalMatchEnd: boolean;
  favGoals: boolean;
  favBlueCards: boolean;
  favRedCards: boolean;
  favTimeouts: boolean;
  favMatchStart: boolean;
  favMatchEnd: boolean;
}

export interface RedsysPayload {
  Ds_SignatureVersion: string;
  Ds_MerchantParameters: string;
  Ds_Signature: string;
}

export const DEFAULT_NOTIF: NotifConfig = {
  master:             true,
  quietNight:         false,
  globalJornadaStart: true,
  globalJornadaEnd:   false,
  globalMatchStart:   true,
  globalMatchEnd:     true,
  favGoals:           true,
  favBlueCards:       false,
  favRedCards:        true,
  favTimeouts:        false,
  favMatchStart:      true,
  favMatchEnd:        true,
};
