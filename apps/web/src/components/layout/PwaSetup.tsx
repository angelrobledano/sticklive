'use client';

import { useEffect } from 'react';
import { initPwa } from '@/lib/pwa';

/** Monta el soporte PWA (registro de SW + captura del prompt de instalación). */
export function PwaSetup() {
  useEffect(() => { initPwa(); }, []);
  return null;
}
