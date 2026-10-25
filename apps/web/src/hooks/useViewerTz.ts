'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_TZ, deviceTimeZone } from '@/lib/viewer-tz-core';

const noopSubscribe = () => () => {};

/**
 * Zona horaria de quien mira. En el servidor y durante la hidratación devuelve
 * Europe/Madrid (el HTML cacheado es igual para todos y no hay desajuste de
 * hidratación); justo después, la del dispositivo. Para un usuario en España
 * no cambia nada; fuera, las horas se corrigen tras el primer render.
 */
export function useViewerTz(): string {
  return useSyncExternalStore(noopSubscribe, deviceTimeZone, () => DEFAULT_TZ);
}
