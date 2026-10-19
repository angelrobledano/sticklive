'use client';

import { useState, useEffect, useCallback } from 'react';
import { track, setPersonProps } from '@/lib/analytics';
import { enablePush, disablePush, syncPushConfig } from '@/lib/push';
import { THEME_KEY, NOTIF_KEY, DEVICE_KEY, DEFAULT_NOTIF, type NotifConfig } from './config';
import { resolveTheme, storedTheme, type ResolvedTheme, type ThemePref } from './theme';

export function useDeviceId(): string {
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // crypto.randomUUID() disponible en HTTPS y localhost
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
    }
    setDeviceId(id);
  }, []);

  return deviceId;
}

/** Aplica el tema resuelto al documento (la clase que leen todos los estilos). */
function applyTheme(theme: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Preferencia de tema con tres estados. `system` se guarda como ausencia de
 * clave, de modo que el script inline del layout resuelve el primer pintado
 * igual que lo hace este hook.
 */
export function useTheme() {
  const [pref, setPref]       = useState<ThemePref>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const prefNow = storedTheme(localStorage.getItem(THEME_KEY));
    setPref(prefNow);
    // Reaplica por si el script de arranque y este hook no coinciden (p. ej.
    // un valor corrupto o el SO cambió entre el primer pintado y la hidratación).
    applyTheme(resolveTheme(prefNow, media.matches));

    // Si la preferencia es "sistema", seguir los cambios del SO en caliente.
    const onChange = () => {
      if (storedTheme(localStorage.getItem(THEME_KEY)) === 'system') {
        applyTheme(resolveTheme('system', media.matches));
      }
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const set = useCallback((next: ThemePref) => {
    setPref(next);
    const resolved = resolveTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(resolved);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch { /* almacenamiento no disponible: el tema sigue aplicado en esta sesión */ }
    track('theme_changed', { theme: next, dark: resolved === 'dark' });
    setPersonProps({ theme: next });
  }, []);

  return { pref, set, mounted };
}

export function useNotifConfig() {
  const [config, setConfig] = useState<NotifConfig>(DEFAULT_NOTIF);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(NOTIF_KEY);
      if (stored)
        setConfig({ ...DEFAULT_NOTIF, ...(JSON.parse(stored) as Partial<NotifConfig>) });
    } catch { /* noop */ }
  }, []);

  const set = useCallback(<K extends keyof NotifConfig>(key: K) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(NOTIF_KEY, JSON.stringify(next)); } catch { /* noop */ }
      track('notification_toggle', { key, enabled: next[key] });

      // Web Push: el maestro suscribe/desuscribe; el resto re-sincroniza
      // las preferencias con el servidor para que el emisor segmente bien.
      if (key === 'master') {
        void (next.master ? enablePush() : disablePush());
      } else {
        void syncPushConfig();
      }
      return next;
    });
  }, []);

  // Fija varias claves a la vez (p. ej. el toggle combinado de jornada).
  const update = useCallback((partial: Partial<NotifConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      try { localStorage.setItem(NOTIF_KEY, JSON.stringify(next)); } catch { /* noop */ }
      void syncPushConfig();
      return next;
    });
  }, []);

  return { config, set, update, mounted };
}
