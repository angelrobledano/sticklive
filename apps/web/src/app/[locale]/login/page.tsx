'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useT } from '@/lib/i18n';
import { BackLink } from '@/components/shared/BackLink';
import { track } from '@/lib/analytics';
import { tt } from '@/components/search/translate';
import { loginErrorKey, LoginRequestError } from './errors';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

// Guard a nivel de módulo: cada token de magic link es de un solo uso. Sobrevive
// a remounts/StrictMode y a re-disparos del efecto, evitando un segundo POST
// /verify que recibiría "caducado" tras haber canjeado ya el enlace.
const attemptedTokens = new Set<string>();

type Status = 'idle' | 'sending' | 'sent' | 'verifying' | 'welcome' | 'error';

/**
 * Respaldo en español para las claves nuevas; el resto ya viven en los locales.
 * Evita que, antes de que el coordinador añada las claves, la UI muestre la
 * clave cruda (misma estrategia que `tt`).
 */
const LOGIN_ERROR_FALLBACK: Record<string, string> = {
  'auth.error_invalid_email':     'Ese email no parece válido. Revísalo y vuelve a intentarlo.',
  'auth.error_email_unavailable': 'No podemos enviar el enlace ahora mismo. Inténtalo de nuevo en unos minutos.',
  'auth.error_generic':           'Algo no fue bien. Inténtalo de nuevo.',
};

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();
  const { t } = useT();

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  // Clave i18n del error (nunca texto crudo del API, #362).
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  // ── Canjear magic link (?token=) ─────────────────────────────────────────────
  useEffect(() => {
    const token = params.get('token');
    if (!token || attemptedTokens.has(token)) return;
    attemptedTokens.add(token);
    setStatus('verifying');

    const deviceId = (() => {
      try { return localStorage.getItem('rink-device-id'); } catch { return null; }
    })();

    fetch(`${API_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({} as { error?: string; session?: string; email?: string }));
        if (!r.ok) throw new LoginRequestError(loginErrorKey(data.error));
        return data as { session: string; email: string };
      })
      .then(async ({ session, email: userEmail }) => {
        login(session, userEmail, 'magic_link');

        // ── Migración crítica: fusionar favoritos anónimos con la cuenta ──
        let teams: string[] = [];
        let leagues: string[] = [];
        let players: string[] = [];
        try {
          teams = JSON.parse(localStorage.getItem('rink-favorites') ?? '[]');
          leagues = JSON.parse(localStorage.getItem('rink-fav-leagues') ?? '[]');
          players = JSON.parse(localStorage.getItem('rink-fav-players') ?? '[]');
        } catch { /* noop */ }

        const merged = await fetch(`${API_URL}/auth/favorites/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
          body: JSON.stringify({ teams, leagues, players }),
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

        // El resultado fusionado vuelve al dispositivo (multi-dispositivo)
        if (merged) {
          try {
            localStorage.setItem('rink-favorites', JSON.stringify(merged.teams ?? teams));
            localStorage.setItem('rink-fav-leagues', JSON.stringify(merged.leagues ?? leagues));
            localStorage.setItem('rink-fav-players', JSON.stringify((merged as { players?: string[] }).players ?? players));
          } catch { /* noop */ }
        }

        // Si la cuenta ya tiene favoritos (de este dispositivo o de la nube),
        // saltamos el onboarding y vamos directos a la home. Si no, bienvenida.
        const favCount =
          (merged?.teams?.length ?? teams.length) +
          (merged?.leagues?.length ?? leagues.length) +
          ((merged as { players?: string[] } | null)?.players?.length ?? players.length);
        if (favCount > 0) router.replace('/');
        else setStatus('welcome');
      })
      .catch((err: Error) => {
        setStatus('error');
        setErrorKey(err instanceof LoginRequestError ? err.key : 'auth.error_generic');
        track('login_failed', {
          method: 'magic_link',
          reason: (err instanceof LoginRequestError ? err.key : 'verify_error').slice(0, 80),
        });
      });
    // Solo al montar: el token se lee una vez y se canjea una vez (guard arriba).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Retorno de Google OAuth (#session=...&email=... en el fragment) ──────
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const session = hash.get('session');
    const userEmail = hash.get('email');
    const oauthError = hash.get('error');
    if (!session && !oauthError) return;

    // Limpiar el fragment de la URL (no dejar la sesión a la vista)
    window.history.replaceState(null, '', window.location.pathname);

    if (oauthError || !session || !userEmail) {
      setStatus('error');
      // Mensaje específico por motivo (antes todo caía en uno genérico, así no
      // se entendía qué fallaba). El acceso por email lleva a la MISMA cuenta.
      const byReason: Record<string, string> = {
        account_disabled:     'auth.account_disabled',
        google_not_configured: 'auth.google_unavailable',
        bad_state:            'auth.google_state',
        google_email:         'auth.google_email',
        google_denied:        'auth.google_denied',
      };
      setErrorKey((oauthError && byReason[oauthError]) || 'auth.google_failed');
      track('login_failed', { method: 'google', reason: oauthError ?? 'unknown' });
      return;
    }

    login(session, userEmail, 'google');

    // Fusionar favoritos anónimos con la cuenta (igual que el magic link)
    let teams: string[] = [];
    let leagues: string[] = [];
    let players: string[] = [];
    try {
      teams = JSON.parse(localStorage.getItem('rink-favorites') ?? '[]');
      leagues = JSON.parse(localStorage.getItem('rink-fav-leagues') ?? '[]');
      players = JSON.parse(localStorage.getItem('rink-fav-players') ?? '[]');
    } catch { /* noop */ }
    fetch(`${API_URL}/auth/favorites/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ teams, leagues, players }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((merged: { teams?: string[]; leagues?: string[]; players?: string[] } | null) => {
        if (merged) {
          try {
            localStorage.setItem('rink-favorites', JSON.stringify(merged.teams ?? teams));
            localStorage.setItem('rink-fav-leagues', JSON.stringify(merged.leagues ?? leagues));
            localStorage.setItem('rink-fav-players', JSON.stringify(merged.players ?? players));
          } catch { /* noop */ }
        }
        // Ya con favoritos → directo a la home; si no, bienvenida + onboarding.
        const favCount =
          (merged?.teams?.length ?? teams.length) +
          (merged?.leagues?.length ?? leagues.length) +
          (merged?.players?.length ?? players.length);
        if (favCount > 0) router.replace('/');
        else setStatus('welcome');
      })
      .catch(() => setStatus('welcome'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pedir magic link ──────────────────────────────────────────────────────────
  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    track('login_started', { method: 'magic_link' });
    track('login_link_requested');
    setStatus('sending');
    setErrorKey(null);
    try {
      const r = await fetch(`${API_URL}/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await r.json().catch(() => ({} as { error?: string; devLink?: string }));
      if (!r.ok) throw new LoginRequestError(loginErrorKey(data.error));
      setDevLink(data.devLink ?? null);
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorKey(err instanceof LoginRequestError ? err.key : 'auth.error_generic');
    }
  };

  if (status === 'verifying') {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">{tt(t, 'auth.opening_account', 'Abriendo tu cuenta…')}</p>
      </div>
    );
  }

  if (status === 'welcome') {
    return (
      <div className="card p-8 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-rink-passion flex items-center justify-center relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.2} className="w-7 h-7">
            <path d="M7 3l7 12.5a3 3 0 0 1-2.6 4.5H8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400
                           ring-2 ring-white dark:ring-slate-900 animate-pulse" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
            {t('auth.welcome_title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('auth.welcome_body')}
          </p>
        </div>
        <Link href="/favorites?onboarding=1"
              className="block w-full min-h-[48px] leading-[48px] rounded-xl bg-rink-passion text-white
                         text-sm font-semibold hover:opacity-90 transition-opacity">
          {t('auth.welcome_cta')}
        </Link>
        <Link href="/" className="block text-xs text-slate-500 dark:text-slate-400 hover:underline">
          {t('auth.go_today')}
        </Link>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-5">
      <div className="text-center space-y-1.5">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">{t('auth.login_title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {t('auth.login_subtitle')}
        </p>
      </div>

      {/* Google OAuth — redirige al flujo de la API */}
      <button
        onClick={() => {
          track('login_started', { method: 'google' });
          const deviceId = (() => {
            try { return localStorage.getItem('rink-device-id') ?? ''; } catch { return ''; }
          })();
          window.location.href = `${API_URL}/auth/google?device_id=${encodeURIComponent(deviceId)}`;
        }}
        className="w-full min-h-[48px] flex items-center justify-center gap-2.5 rounded-xl
                   border border-slate-200 dark:border-slate-700 text-sm font-semibold
                   text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-5 h-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.61 0 3.06.56 4.21 1.64l3.16-3.16A11 11 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/></svg>
        {t('auth.google')}
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
        <span className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('auth.or_email')}</span>
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
      </div>

      {status === 'sent' ? (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t('auth.link_sent_title')}</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
            {t('auth.link_sent_body')}
          </p>
          {devLink && (
            <a href={devLink} className="block text-xs font-mono text-rink-passion underline break-all">
              {tt(t, 'auth.dev_open_link', '[dev] Abrir enlace directamente')}
            </a>
          )}
        </div>
      ) : (
        <form onSubmit={requestLink} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            aria-label={t('a11y.email_label')}
            aria-invalid={errorKey ? true : undefined}
            aria-describedby={errorKey ? 'login-error' : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="w-full min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                       placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full min-h-[48px] rounded-xl bg-rink-passion text-white text-sm font-semibold
                       hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {status === 'sending' ? t('auth.sending') : t('auth.send_link')}
          </button>
        </form>
      )}

      {errorKey && (
        <p
          id="login-error"
          role="alert"
          className="text-xs text-red-600 dark:text-red-400 leading-relaxed text-center"
        >
          {tt(t, errorKey, LOGIN_ERROR_FALLBACK[errorKey] ?? 'Algo no fue bien. Inténtalo de nuevo.')}
        </p>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed text-center">
        {t('auth.privacy')}
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="px-4 py-6 max-w-md mx-auto space-y-4">
      <BackLink href="/" />
      <Suspense fallback={null}>
        <LoginInner />
      </Suspense>
    </div>
  );
}
