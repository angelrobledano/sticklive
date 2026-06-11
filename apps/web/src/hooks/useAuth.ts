'use client';

import { useCallback, useEffect, useState } from 'react';
import { track, identify, resetIdentity } from '@/lib/analytics';

const SESSION_KEY = 'rink-session';
const EMAIL_KEY = 'rink-session-email';
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export function getSession(): string | null {
  try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function useAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try { setEmail(localStorage.getItem(EMAIL_KEY)); } catch { /* noop */ }
    // Validar sesión contra la API en segundo plano
    const session = getSession();
    if (!session) return;
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${session}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { email: string | null }) => {
        setEmail(d.email);
        try { localStorage.setItem(EMAIL_KEY, d.email ?? ''); } catch { /* noop */ }
      })
      .catch(() => {
        // Sesión inválida/caducada → volver a anónimo sin molestar
        try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(EMAIL_KEY); } catch { /* noop */ }
        setEmail(null);
      });
  }, []);

  const login = useCallback((session: string, userEmail: string) => {
    try {
      localStorage.setItem(SESSION_KEY, session);
      localStorage.setItem(EMAIL_KEY, userEmail);
    } catch { /* noop */ }
    setEmail(userEmail);
    identify(userEmail.toLowerCase(), { email: userEmail });
    track('login_completed', { method: 'magic_link' });
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(EMAIL_KEY); } catch { /* noop */ }
    setEmail(null);
    track('logout');
    resetIdentity();
  }, []);

  return { email, isAuthenticated: !!email, login, logout, mounted };
}
