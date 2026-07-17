'use client';

import { useState, useEffect, useCallback } from 'react';
import { track, setPersonProps } from '@/lib/analytics';
import { enablePush, disablePush, syncPushConfig } from '@/lib/push';
import { THEME_KEY, NOTIF_KEY, DEVICE_KEY, DEFAULT_NOTIF, type NotifConfig } from './config';

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

export function useDarkMode() {
  const [isDark,   setIsDark]   = useState(false);
  const [mounted, setMounted]   = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      track('theme_changed', { dark: next });
      setPersonProps({ theme: next ? 'dark' : 'light' });
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem(THEME_KEY, 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem(THEME_KEY, 'light');
      }
      return next;
    });
  }, []);

  return { isDark, toggle, mounted };
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
