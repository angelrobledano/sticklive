-- ============================================================
-- Migración 068: el código de canje del login app queda LIGADO al dispositivo.
--
-- Vulnerabilidad (review final de la app móvil): el código single-use de
-- app_login_codes viaja al dispositivo por el custom scheme
-- sticklive://auth/callback?code=… y hasta ahora NADA lo vinculaba al deviceId
-- que inició el login. Otra app del MISMO dispositivo que intercepte el scheme
-- podía canjear el código desde cualquier red y abrir una sesión del usuario.
--
-- Fix: el callback guarda device_hash = SHA-256(deviceId) (el deviceId viaja
-- firmado en el state HMAC, client=app) y POST /auth/exchange solo canjea con
-- el deviceId coincidente. Comparación en tiempo constante en la app (lib).
--
-- Nullable a propósito: los códigos previos al despliegue viven 120 s y caducan
-- solos (sin backfill: no hay nada que ligar retroactivamente); el canje de una
-- fila con device_hash NULL se comporta como hasta hoy (fila legado).
-- Aditiva e idempotente: IF NOT EXISTS; re-ejecutar no falla.
-- ============================================================

ALTER TABLE app_login_codes
  ADD COLUMN IF NOT EXISTS device_hash TEXT;

COMMENT ON COLUMN app_login_codes.device_hash IS
  'SHA-256 del deviceId que inició el login (state firmado client=app). El canje vía POST /auth/exchange exige el mismo deviceId; NULL = código legado previo al despliegue (canje sin binding, caduca en 120 s). Ver migración 068.';
