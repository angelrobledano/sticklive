'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useFavorites, getFavNames } from '@/hooks/useFavorites';
import { useAuth } from '@/hooks/useAuth';
import { useT, SUPPORTED_LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n';
import { usePremium } from '@/context/PremiumContext';
import { track, setPersonProps } from '@/lib/analytics';
import { clubName } from '@/lib/names';
import { InstallApp } from '@/components/shared/InstallApp';
import {
  enablePush, disablePush, syncPushConfig,
  notificationPermission, isIOS, isStandalone, vapidMissing, sendTestPush,
} from '@/lib/push';

// ─── Constantes de storage ────────────────────────────────────────────────────

const THEME_KEY   = 'rink-theme';
const NOTIF_KEY   = 'rink-notif-config';
const DEVICE_KEY  = 'rink-device-id';
const SEASON_ID   = process.env['NEXT_PUBLIC_SEASON_ID'] ?? '';
const API_URL     = process.env['NEXT_PUBLIC_API_URL']   ?? 'http://localhost:3000';
const REDSYS_URL  = 'https://sis-t.redsys.es:25443/sis/realizarPago'; // entorno de pruebas
/** Proveedor de pago activo: 'stripe' (por defecto) o 'redsys' */
const PAYMENT_PROVIDER = process.env['NEXT_PUBLIC_PAYMENT_PROVIDER'] ?? 'stripe';
/** Monetización oculta de momento: la app es gratis. Activar con NEXT_PUBLIC_PREMIUM_ENABLED=1 */
const PREMIUM_ENABLED = process.env['NEXT_PUBLIC_PREMIUM_ENABLED'] === '1';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TeamInfo {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

interface NotifConfig {
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

interface RedsysPayload {
  Ds_SignatureVersion: string;
  Ds_MerchantParameters: string;
  Ds_Signature: string;
}

const DEFAULT_NOTIF: NotifConfig = {
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

// ─── Componente Toggle iOS-style ──────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-all duration-200 ease-out
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion/60 focus-visible:ring-offset-2
                  dark:focus-visible:ring-offset-slate-900 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${
        checked
          ? 'bg-gradient-to-r from-rink-passion to-red-600 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]'
          : 'bg-slate-200 dark:bg-slate-700/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white
                    shadow-[0_1px_3px_rgba(0,0,0,0.3)]
                    transition-transform duration-200 ease-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ─── Fila de ajuste genérica ──────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">
          {label}
        </p>
        {description && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
            {description}
          </p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// ─── Bloque de ajuste con título ──────────────────────────────────────────────

function SettingsBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        <h2 className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          {title}
        </h2>
      </div>
      <div className="card px-4 divide-y divide-slate-100 dark:divide-slate-800/60">
        {children}
      </div>
    </section>
  );
}

// ─── Banner Premium ───────────────────────────────────────────────────────────

function PremiumBanner({ deviceId }: { deviceId: string }) {
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  /**
   * 1. Llama a /payments/redsys/create-json para obtener el payload firmado.
   * 2. Inyecta un <form> oculto con los tres campos de Redsys.
   * 3. Llama a .submit() → el navegador redirige a la pasarela del banco.
   */
  const handleCheckout = useCallback(async () => {
    if (!deviceId) return;
    track('premium_checkout_started');
    setLoading(true);
    setError(null);

    // ── Proveedor ACTIVO: Stripe (Redsys queda abajo por si se vuelve) ──────
    if (PAYMENT_PROVIDER === 'stripe') {
      try {
        const res = await fetch(`${API_URL}/payments/stripe/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId }),
        });
        const body = await res.json() as { url?: string; error?: string };
        if (!res.ok || !body.url) throw new Error(body.error ?? `HTTP ${res.status}`);
        window.location.href = body.url; // → Stripe Checkout
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
        setLoading(false);
      }
      return;
    }

    // ── Redsys (proveedor alternativo) ──────────────────────────────────────
    try {
      const res = await fetch(`${API_URL}/payments/redsys/create-json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ deviceId }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const payload = await res.json() as RedsysPayload;

      // Inyectar formulario invisible y hacer submit automático
      const form = document.createElement('form');
      form.method  = 'POST';
      form.action  = REDSYS_URL;
      form.style.display = 'none';

      const fields: Array<[string, string]> = [
        ['Ds_SignatureVersion',   payload.Ds_SignatureVersion],
        ['Ds_MerchantParameters', payload.Ds_MerchantParameters],
        ['Ds_Signature',          payload.Ds_Signature],
      ];

      for (const [name, value] of fields) {
        const input   = document.createElement('input');
        input.type    = 'hidden';
        input.name    = name;
        input.value   = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
      // El navegador redirige — no hace falta limpiar el form
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setLoading(false);
    }
  }, [deviceId]);

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm">
      {/* Fondo degradado granate → amarillo */}
      <div className="bg-gradient-to-br from-rink-passion via-red-700 to-amber-600 p-5 space-y-3">
        {/* Badge */}
        <div className="flex items-center gap-2">
          <span className="text-amber-300">
            {/* Corona */}
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
            </svg>
          </span>
          <span className="text-xs font-bold text-white/90 uppercase tracking-widest">
            {t('settings.premium_title')}
          </span>
        </div>

        {/* Beneficios */}
        <div className="space-y-1.5">
          {[
            t('settings.perk_no_ads'),
            t('settings.perk_rt_notifs'),
            t('settings.perk_early'),
          ].map((benefit) => (
            <div key={benefit} className="flex items-center gap-2">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 text-amber-300 shrink-0"
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-white/90">{benefit}</p>
            </div>
          ))}
        </div>

        {/* Precio + CTA */}
        <div className="flex items-center justify-between pt-1 gap-4">
          <div>
            <span className="text-2xl font-extrabold text-white">4,99 €</span>
            <span className="text-sm text-white/70 ml-1">{t('settings.per_year')}</span>
          </div>

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="flex items-center gap-2 bg-white text-rink-passion font-bold text-sm
                       px-4 py-2.5 rounded-xl shadow
                       hover:bg-amber-50 active:scale-95
                       transition-all duration-150
                       disabled:opacity-60 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-rink-passion"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" />
                Conectando…
              </>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
                </svg>
                {t('settings.premium_cta')}
              </>
            )}
          </button>
        </div>

        {/* Error inline */}
        {error && (
          <p className="text-xs text-red-200 bg-red-900/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Nota de entorno de pruebas (solo aplica al flujo Redsys) */}
        {PAYMENT_PROVIDER === 'redsys' && (
          <p className="text-[10px] text-white/40 text-center pt-1">
            {t('settings.premium_sandbox')}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Badge "Ya eres Premium" ──────────────────────────────────────────────────

function PremiumActiveBadge() {
  const { t } = useT();
  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 p-4
                    flex items-center gap-3 shadow-sm">
      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
          <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-bold text-white">{t('settings.premium_active')}</p>
        <p className="text-xs text-white/80">{t('settings.premium_thanks')}</p>
      </div>
    </div>
  );
}

// ─── Hooks locales ────────────────────────────────────────────────────────────

function useDeviceId(): string {
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

function useDarkMode() {
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

function useNotifConfig() {
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

// ─── Selector de idioma ───────────────────────────────────────────────────────

function LanguageCard() {
  const { locale, setLocale, t } = useT();
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('common.language')}</p>
      </div>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200
                   focus:outline-none focus:ring-2 focus:ring-rink-passion/40 cursor-pointer"
        aria-label={t('common.language')}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Tarjeta de cuenta (autenticación progresiva) ─────────────────────────────

function AccountCard() {
  const { email, isAuthenticated, logout, mounted } = useAuth();
  const { t } = useT();
  if (!mounted) return null;

  if (isAuthenticated) {
    return (
      <div className="card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-600 dark:text-emerald-400">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{email}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">{t('settings.account_synced')}</p>
        </div>
        <button onClick={logout}
                className="text-xs font-medium text-slate-400 hover:text-red-500 transition-colors px-2 min-h-[44px]">
          {t('settings.logout')}
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow block
                                   border border-rink-passion/20 bg-rink-passion/[0.03]">
      <div className="w-10 h-10 rounded-full bg-rink-passion/10 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
          <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('settings.account_login')}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {t('settings.account_login_desc')}
        </p>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 shrink-0">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" />
      </svg>
    </Link>
  );
}

// ─── Fila de favorito (equipo o liga) ────────────────────────────────────────

function FavoriteRow({ href, name, fallback, logoSrc, onRemove }: {
  href: string;
  name: string;
  fallback: string;
  logoSrc?: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
        {logoSrc ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              alt={name}
              className="w-full h-full object-contain"
              onError={(e) => {
                const el = e.currentTarget;
                el.style.display = 'none';
                if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'block';
              }}
            />
            <span style={{ display: 'none' }} className="text-[8px] font-bold text-slate-400 uppercase">
              {fallback}
            </span>
          </>
        ) : (
          <span className="text-[9px] font-black text-rink-passion uppercase">{fallback}</span>
        )}
      </div>
      <Link
        href={href}
        className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 hover:text-rink-passion transition-colors truncate"
      >
        {name}
      </Link>
      <button
        onClick={onRemove}
        className="shrink-0 p-1.5 min-h-[36px] rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        aria-label="Dejar de seguir"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" strokeWidth={2}
             className="w-5 h-5 text-amber-400">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Estado de notificaciones (soporte, permiso, iOS) + prueba ────────────────

function NotificationStatus({ deviceId }: { deviceId: string }) {
  const { t } = useT();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  const [ios, setIos]   = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [noVapid, setNoVapid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setPerm(notificationPermission());
    setIos(isIOS());
    setStandalone(isStandalone());
    setNoVapid(vapidMissing());

    // Refrescar el permiso cuando cambie (lo concede el navegador, p. ej. al
    // pulsar Activar o el interruptor maestro) o al volver a la pestaña.
    const refresh = () => setPerm(notificationPermission());
    window.addEventListener('focus', refresh);
    let permStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions.query({ name: 'notifications' as PermissionName })
        .then((s) => { permStatus = s; s.onchange = refresh; })
        .catch(() => { /* Safari iOS puede no soportar permissions.query */ });
    }
    return () => {
      window.removeEventListener('focus', refresh);
      if (permStatus) permStatus.onchange = null;
    };
  }, []);

  // Pide permiso y suscribe (no depende del interruptor maestro).
  const activate = async () => {
    setBusy(true);
    setResult(null);
    await enablePush();
    setPerm(notificationPermission());
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    setResult(null);
    const r = await sendTestPush(deviceId);
    setBusy(false);
    setResult(
      r.ok
        ? (r.sent && r.sent > 0 ? t('settings.notif_test_ok') : t('settings.notif_test_nosub'))
        : t('settings.notif_test_fail')
    );
  };

  // ¿Es posible push en este dispositivo/navegador?
  const blocked = noVapid || perm === 'unsupported' || (ios && !standalone);

  // Mensaje de contexto
  let note: string | null = null;
  if (noVapid || perm === 'unsupported') note = t('settings.notif_unavailable');
  else if (ios && !standalone)           note = t('settings.notif_ios_install');
  else if (perm === 'denied')            note = t('settings.notif_denied');

  const btn =
    'inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-xl text-xs font-semibold ' +
    'disabled:opacity-50 transition-colors';

  return (
    <div className="py-3 space-y-2">
      {note && (
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{note}</p>
      )}

      {/* Sin permiso aún → botón para activarlo aquí mismo */}
      {!blocked && perm !== 'granted' && perm !== 'denied' && (
        <button
          onClick={activate}
          disabled={busy}
          className={`${btn} bg-rink-passion text-white hover:opacity-90`}
        >
          {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
          {t('settings.notif_activate_btn')}
        </button>
      )}

      {/* Permiso concedido → botón de prueba */}
      {!blocked && perm === 'granted' && (
        <button
          onClick={test}
          disabled={busy}
          className={`${btn} border border-rink-passion/30 text-rink-passion hover:bg-rink-passion/5`}
        >
          {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" />}
          {busy ? t('settings.notif_test_sending') : t('settings.notif_test_btn')}
        </button>
      )}

      {result && <p className="text-xs text-slate-500 dark:text-slate-400">{result}</p>}
    </div>
  );
}

// ─── Sub-cabecera de sección dentro de un bloque ──────────────────────────────

function SubHeader({ label }: { label: string }) {
  return (
    <div className="pt-3 pb-1">
      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}

// ─── Fila de navegación (título + chevron) ────────────────────────────────────

function NavRow({ label, href, count }: { label: string; href: string; count?: number }) {
  return (
    <Link href={href} className="flex items-center gap-3 py-3.5 group">
      <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">{count}</span>
      )}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-rink-passion transition-colors">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useT();
  const { isDark,    toggle: toggleDark, mounted: themeMounted }   = useDarkMode();
  const { favorites, toggle: toggleFav, isFavorite, leagues, toggleLeague, players, togglePlayer, mounted: favMounted } = useFavorites();
  const { config,    set: setNotif, update: updateNotif, mounted: notifMounted } = useNotifConfig();
  const { isPremium, mounted: premiumMounted }                     = usePremium();
  const deviceId = useDeviceId();

  // ¿Está el push bloqueado en este dispositivo? (permiso denegado, sin soporte,
  // iPhone sin instalar o sin clave VAPID) → atenuamos las secciones de abajo.
  const [notifBlocked, setNotifBlocked] = useState(false);
  useEffect(() => {
    const check = () => {
      const perm = notificationPermission();
      setNotifBlocked(vapidMissing() || perm === 'unsupported' || perm === 'denied' || (isIOS() && !isStandalone()));
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // Lista de equipos de la OK Liga
  const [teams, setTeams]           = useState<TeamInfo[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  // Competiciones (para resolver nombres de las ligas seguidas)
  const [comps, setComps] = useState<Array<{ id: string; name: string; shortName: string | null }>>([]);

  useEffect(() => {
    fetch(`${API_URL}/competitions`)
      .then((r) => r.json())
      .then((d: { competitions?: Array<{ id: string; name: string; shortName: string | null }> }) =>
        setComps(d.competitions ?? []))
      .catch(() => { /* sin ligas */ });
  }, []);

  const myTeams   = teams.filter((tm) => isFavorite(tm.id));
  const myLeagues = comps.filter((cp) => leagues.includes(cp.id));
  // Jugadores seguidos: el nombre se guardó al seguirlos (sin N fetches)
  const favNames  = typeof window !== 'undefined' ? getFavNames() : {};
  const myPlayers = players.map((id) => ({ id, name: favNames[id] ?? '—' }));

  useEffect(() => {
    const loadTeams = async () => {
      // Temporada ACTUAL real desde /competitions (fuente de verdad); el env solo
      // como último recurso. Evita depender de un id horneado en build que puede
      // estar vacío u obsoleto tras un reseed.
      const compsData = await fetch(`${API_URL}/competitions`).then((r) => r.json()).catch(() => null);
      const list = (compsData?.competitions ?? []) as Array<{ season?: { id: string; isCurrent?: boolean; teamCount?: number } | null }>;
      const withSeason = list.filter((c) => c.season?.id);
      const current = withSeason.filter((c) => c.season?.isCurrent);
      const pool = current.length ? current : withSeason;
      pool.sort((a, b) => (b.season?.teamCount ?? 0) - (a.season?.teamCount ?? 0));
      const seasonId = pool[0]?.season?.id || SEASON_ID;
      if (!seasonId) { setLoadingTeams(false); return; }
      try {
        const data = await fetch(`${API_URL}/seasons/${seasonId}/standings`).then((r) => r.json()) as {
          standings: Array<{
            team_id?: string; teamId?: string;
            team_name?: string; teamName?: string;
            team_short_name?: string; teamShortName?: string;
            team_logo_url?: string; teamLogoUrl?: string;
          }>;
        };
        const list: TeamInfo[] = (data.standings ?? []).map((s) => ({
          id:        s.team_id    ?? s.teamId    ?? '',
          name:      s.team_name  ?? s.teamName  ?? '',
          shortName: s.team_short_name ?? s.teamShortName ?? null,
          logoUrl:   s.team_logo_url   ?? s.teamLogoUrl   ?? null,
        }));
        setTeams(list);
      } catch { /* sin equipos */ }
      finally { setLoadingTeams(false); }
    };
    void loadTeams();
  }, []);

  const allMounted = themeMounted && favMounted && notifMounted && premiumMounted;

  if (!allMounted) {
    return (
      <div className="px-4 py-8 max-w-2xl mx-auto space-y-6 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-32 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="card h-24" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-6">
      {/* Cabecera */}
      <div className="space-y-1 pt-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t('settings.title')}</h1>
        <p className="text-sm text-slate-400 dark:text-slate-500">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* ── Banner Premium (oculto mientras la app sea gratis) ─────────────── */}
      {PREMIUM_ENABLED && (
        isPremium ? <PremiumActiveBadge /> : <PremiumBanner deviceId={deviceId} />
      )}

      {/* ── Bloque A: Estilo de la pista ─────────────────────────────────── */}
      <SettingsBlock
        title={t('settings.style_section')}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
          </svg>
        }
      >
        <SettingRow
          label={t('settings.dark_mode')}
          description={t('settings.dark_mode_desc')}
          checked={isDark}
          onChange={toggleDark}
        />
      </SettingsBlock>

      {/* ── Tarjeta de cuenta (autenticación progresiva) ───────────────────── */}
      <AccountCard />

      {/* ── Instalar como app (PWA) — se oculta si ya está instalada ───────── */}
      <InstallApp />

      {/* ── Idioma ─────────────────────────────────────────────────────────── */}
      <LanguageCard />

      {/* ── Acceso a gestión en bloque de favoritos ────────────────────────── */}
      <Link href="/favorites" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow block">
        <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('favorites.manage_favs')}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.manage_desc')}</p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 shrink-0">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" />
        </svg>
      </Link>

      {/* ── Bloque B: Mis equipos (solo los que sigo) ──────────────────────── */}
      <SettingsBlock
        title={t('settings.my_teams')}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        }
      >
        {loadingTeams ? (
          <div className="py-6 flex justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" />
          </div>
        ) : myTeams.length === 0 ? (
          <div className="py-4">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t('favorites.onboarding_body')}
            </p>
          </div>
        ) : (
          <>
            {myTeams.map((team) => (
              <FavoriteRow
                key={team.id}
                href={`/teams/${team.id}`}
                name={clubName(team.name)}
                fallback={(team.shortName ?? team.name).slice(0, 2)}
                logoSrc={`/escudos/${team.id}.png`}
                onRemove={() => toggleFav(team.id)}
              />
            ))}
            <div className="py-2.5">
              <p className="text-[11px] text-slate-300 dark:text-slate-700">
                {t('settings.fav_note', { n: myTeams.length })}
              </p>
            </div>
          </>
        )}
      </SettingsBlock>

      {/* ── Bloque B2: Mis ligas (solo las que sigo) ───────────────────────── */}
      {myLeagues.length > 0 && (
        <SettingsBlock
          title={t('settings.my_leagues')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M8 3h8v10a4 4 0 0 1-8 0V3Z" /><path d="M12 17v4M8 21h8" />
            </svg>
          }
        >
          {myLeagues.map((comp) => (
            <FavoriteRow
              key={comp.id}
              href={`/competitions/${comp.id}`}
              name={clubName(comp.name)}
              fallback={(comp.shortName ?? comp.name).slice(0, 2)}
              onRemove={() => toggleLeague(comp.id)}
            />
          ))}
        </SettingsBlock>
      )}

      {/* ── Bloque B3: Mis jugadores (solo los que sigo) ───────────────────── */}
      {myPlayers.length > 0 && (
        <SettingsBlock
          title={t('settings.my_players')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          }
        >
          {myPlayers.map((p) => (
            <FavoriteRow
              key={p.id}
              href={`/players/${p.id}`}
              name={p.name}
              fallback={p.name.slice(0, 2)}
              onRemove={() => togglePlayer(p.id)}
            />
          ))}
        </SettingsBlock>
      )}

      {/* ── Bloque C: Notificaciones ───────────────────────────────────────── */}
      <SettingsBlock
        title={t('settings.notif_title')}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      >
        {/* Banner superior: permiso/estado + activar + prueba (avisa de errores) */}
        <NotificationStatus deviceId={deviceId} />

        {/* Switch maestro — control absoluto del sistema */}
        <SettingRow
          label={t('settings.master')}
          description={t('settings.master_desc')}
          checked={config.master}
          onChange={() => setNotif('master')}
        />

        {/* Secciones — atenuadas si el maestro está apagado o el push bloqueado */}
        <div className={(!config.master || notifBlocked) ? 'opacity-40 pointer-events-none select-none' : ''}>

          {/* Sección 1: Alertas de la jornada (inicio + resumen, toggle único) */}
          <SubHeader label={t('settings.sec_jornada')} />
          <SettingRow
            label={t('settings.jornada_alerts')}
            description={t('settings.jornada_alerts_desc')}
            checked={config.globalJornadaStart || config.globalJornadaEnd}
            onChange={() => {
              const on = !(config.globalJornadaStart || config.globalJornadaEnd);
              updateNotif({ globalJornadaStart: on, globalJornadaEnd: on });
            }}
          />

          {/* Sección 2: Notificaciones de mis favoritos (navegación por entidad) */}
          <SubHeader label={t('settings.sec_favs')} />
          <NavRow label={t('settings.notif_nav_competitions')} href="/settings/notifications/competitions" count={leagues.length} />
          <NavRow label={t('settings.notif_nav_teams')}        href="/settings/notifications/teams"        count={favorites.length} />
          <NavRow label={t('settings.notif_nav_players')}      href="/settings/notifications/players"      count={players.length} />

          {/* Sección 3: Descanso */}
          <SubHeader label={t('settings.sec_rest')} />
          <SettingRow
            label={t('settings.quiet')}
            description={t('settings.quiet_desc')}
            checked={config.quietNight}
            onChange={() => setNotif('quietNight')}
          />

        </div>{/* fin de secciones atenuables */}

      </SettingsBlock>

      {/* Pie */}
      <div className="text-center pb-4 space-y-1">
        <p className="text-[11px] text-slate-300 dark:text-slate-700">{t('settings.footer')}</p>
        <Link href="/privacy" className="inline-block text-[11px] text-slate-400 dark:text-slate-600 underline hover:text-rink-passion">
          {t('settings.privacy_link')}
        </Link>
      </div>
    </div>
  );
}
