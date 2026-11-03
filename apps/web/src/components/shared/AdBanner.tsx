'use client';
/**
 * <AdBanner zone="…" />
 *
 * Lógica central de monetización:
 *   • Anuncios apagados por defecto: sin `NEXT_PUBLIC_ADSENSE_CLIENT` no se
 *     renderiza nada (el placeholder solo aparece si `NEXT_PUBLIC_PREMIUM_ENABLED=1`).
 *   • Usuario Premium  → retorna null inmediatamente. Cero DOM.
 *   • Usuario Free + AdSense configurado → `<ins>` real de AdSense, con etiqueta
 *     "PUBLICIDAD" (cumplimiento IAB/CNMC) y altura reservada para evitar CLS.
 *     El consentimiento publicitario lo gobierna el CMP de Google (TCF) dentro
 *     del propio tag (ver docs/monetizacion.md §4).
 *   • Durante hydratación (mounted=false) o sin respuesta al aviso de analítica
 *     → retorna null para evitar mismatch y no cargar terceros en el primer
 *     render (F5-2/F5-3).
 *
 * Zonas: home-top, home-inline, list-inline, match-summary, match-stats,
 * interstitial (solo en <AdInterstitial>).
 */

import { useEffect, useRef, useState } from 'react';
import { usePremium } from '@/context/PremiumContext';
import { track } from '@/lib/analytics';
import {
  adsEnabled,
  adsenseConfig,
  adSlotLayout,
  AD_EMPTY_COLLAPSE_MS,
  loadAdsenseScript,
  type AdZone,
} from '@/lib/ads';

// ─── Configuración ────────────────────────────────────────────────────────────

interface AdBannerProps {
  zone: AdZone;
  className?: string;
}

/** Monetización desactivada (placeholder) mientras la app sea gratis. */
const MONETIZATION_ENABLED = process.env['NEXT_PUBLIC_PREMIUM_ENABLED'] === '1';

/** Configuración AdSense leída una vez (env inyectado en build). */
const ADS = adsenseConfig();

// ─── Dimensiones por zona ─────────────────────────────────────────────────────

const ZONE_CONFIG: Record<AdZone, {
  /** Altura reservada — evita CLS al rellenarse el anuncio */
  height: string;
  label: string;
  /** Clases del contenedor interno del placeholder */
  inner: string;
  /**
   * `data-ad-format` de AdSense. 'auto' por defecto. 'horizontal' en la home
   * (spec 2026-10-16): un bloque 'auto' en móvil crecía a cientos de px y
   * dejaba la jornada fuera del primer pantallazo.
   */
  format?: 'auto' | 'horizontal';
}> = {
  'home-top': {
    height: 'h-[50px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-3',
    format: 'horizontal',
  },
  'home-inline': {
    height: 'h-[100px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
  'list-inline': {
    height: 'h-[100px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
  'match-summary': {
    height: 'h-[100px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
  'match-stats': {
    height: 'h-[100px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
  'interstitial': {
    height: 'h-[250px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
};

// ─── Ilustración SVG inline (placeholder; sin request externo) ────────────────

function AdIllustration({ zone }: { zone: AdZone }) {
  const isSmall = zone === 'home-top';

  if (isSmall) {
    // Versión compacta: logotipo + texto lineal
    return (
      <div className="flex items-center gap-2 opacity-30">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0">
          <rect x="3" y="3" width="18" height="18" rx="4"
                className="fill-slate-400 dark:fill-slate-500" />
          <path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className="space-y-1">
          <div className="h-2 w-24 rounded-full bg-slate-300 dark:bg-slate-600" />
          <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  // Versión rectangular: icono + texto + CTA
  return (
    <div className="flex items-center gap-4 px-4 opacity-30">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-300 to-slate-400
                      dark:from-slate-600 dark:to-slate-700 shrink-0
                      flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6">
          <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z"
                className="fill-white/60" />
        </svg>
      </div>
      <div className="flex-1 space-y-2">
        <div className="h-2.5 w-32 rounded-full bg-slate-300 dark:bg-slate-600" />
        <div className="h-2 w-24 rounded-full bg-slate-200 dark:bg-slate-700" />
      </div>
      <div className="shrink-0 h-7 w-16 rounded-lg
                      bg-slate-300 dark:bg-slate-600" />
    </div>
  );
}

function AdLabel({ label }: { label: string }) {
  return (
    <span
      className="absolute top-0.5 right-1.5 z-10
                 text-[9px] font-semibold tracking-widest uppercase
                 text-slate-300 dark:text-zinc-600
                 select-none pointer-events-none"
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

// ─── Unidad AdSense real ──────────────────────────────────────────────────────

function AdsenseUnit({ zone, client, slot, className }: {
  zone: AdZone;
  client: string;
  slot: string;
  className?: string;
}) {
  const insRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  const impressed = useRef(false);
  const [empty, setEmpty] = useState(false);
  const layout = adSlotLayout(zone);

  // Sin creatividad visible a los 3 s (sin relleno, bloqueador, sin
  // consentimiento): fuera. AdSense no siempre marca `data-ad-status`.
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = insRef.current;
      const frame = el?.querySelector('iframe');
      const filled = el?.getAttribute('data-ad-status') !== 'unfilled' && !!frame && frame.offsetHeight > 0;
      if (!filled) setEmpty(true);
    }, AD_EMPTY_COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, []);

  // Un `push` por unidad, tras montar. El script puede no haber cargado aún:
  // AdSense procesa el array cuando termina de cargar.
  useEffect(() => {
    loadAdsenseScript(client);
    if (pushed.current) return;
    pushed.current = true;
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] };
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch { /* bloqueadores de anuncios o entorno sin window */ }
  }, [client]);

  // Impresión cuando la unidad se hace visible (una sola vez por montaje).
  useEffect(() => {
    const el = insRef.current;
    if (!el || impressed.current) return;
    const emit = () => {
      if (impressed.current) return;
      impressed.current = true;
      track('ad_impression', { zone });
    };
    if (typeof IntersectionObserver === 'undefined') {
      emit();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        emit();
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [zone]);

  const config = ZONE_CONFIG[zone];

  // Reserva por `min-height` (anti-CLS) SIN recortar: un bloque responsive puede
  // medir más que la altura reservada, y recortar anuncios (`overflow-hidden` +
  // altura fija) incumple la política de AdSense. El hueco mínimo se mantiene; el
  // anuncio crece si le hace falta. Si AdSense no tiene anuncio
  // (`data-ad-status="unfilled"`), el contenedor se colapsa: un hueco en blanco
  // con «PUBLICIDAD» en mitad de la lista parece un fallo.
  const reserve = config.height.replace(/^h-/, 'min-h-');

  if (empty) return null;

  return (
    <div
      role="complementary"
      aria-label="Espacio publicitario"
      // Best-effort: el iframe del anuncio no siempre propaga el click.
      onClick={() => track('ad_click', { zone })}
      className={`
        relative w-full ${reserve}
        rounded-xl
        [&:has(ins[data-ad-status=unfilled])]:hidden
        ${className}
      `}
    >
      <AdLabel label={config.label} />
      <ins
        ref={insRef}
        className="adsbygoogle block w-full"
        style={{ display: 'block' }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={config.format ?? 'auto'}
        data-full-width-responsive={layout.fullWidthResponsive ? 'true' : 'false'}
      />
    </div>
  );
}

// ─── Placeholder (sin red de anuncios configurada) ────────────────────────────

function AdPlaceholder({ zone, className = '' }: AdBannerProps) {
  const config = ZONE_CONFIG[zone];
  return (
    <div
      role="complementary"
      aria-label="Espacio publicitario"
      className={`
        relative w-full ${config.height}
        bg-slate-50/60 dark:bg-zinc-800/40
        overflow-hidden rounded-xl
        ${className}
      `}
    >
      <AdLabel label={config.label} />
      <div className={`w-full h-full ${config.inner}`}>
        <AdIllustration zone={zone} />
      </div>
      <div
        className="absolute inset-0 pointer-events-none
                   bg-gradient-to-r from-transparent via-white/5 to-transparent
                   dark:via-white/3"
        aria-hidden="true"
      />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function AdBanner({ zone, className = '' }: AdBannerProps) {
  const { isPremium, mounted } = usePremium();

  const slot = ADS.slots[zone];

  // Durante SSR/hidratación o Premium: sin DOM. El CMP de Google decide qué
  // anuncios se pueden servir (personalizados o no).
  if (!mounted || isPremium) return null;

  // AdSense configurado: anuncio real solo con slot y sin premium. El
  // consentimiento publicitario lo aplica el CMP de Google dentro del tag.
  if (ADS.client) {
    if (slot && adsEnabled({ client: ADS.client, premium: isPremium })) {
      return <AdsenseUnit zone={zone} client={ADS.client} slot={slot} className={className} />;
    }
    return null;
  }

  // Sin AdSense: mantener el placeholder actual mientras la app sea gratis.
  if (MONETIZATION_ENABLED) return <AdPlaceholder zone={zone} className={className} />;

  return null;
}
