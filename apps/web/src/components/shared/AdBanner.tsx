'use client';
/**
 * <AdBanner zone="…" />
 *
 * Lógica central de monetización:
 *   • Usuario Premium  → retorna null inmediatamente. Cero DOM, cero layout shift.
 *   • Usuario Free     → renderiza el contenedor del anuncio con la etiqueta
 *                        "PUBLICIDAD" normalizada (cumplimiento IAB/CNMC).
 *   • Durante hydratión (mounted=false) → retorna null para evitar mismatch.
 *
 * Zonas disponibles:
 *   home-top      → Banner horizontal 320×50 bajo el DateSelector (sticky)
 *   home-inline   → Banner nativo 320×100 intercalado entre secciones de partidos
 *   match-stats   → Robapáginas 300×250 al final del tab de Estadísticas
 */

import { usePremium } from '@/context/PremiumContext';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AdZone = 'home-top' | 'home-inline' | 'match-stats';

interface AdBannerProps {
  zone: AdZone;
  className?: string;
}

// ─── Dimensiones por zona ─────────────────────────────────────────────────────

const ZONE_CONFIG: Record<AdZone, {
  height: string;
  label: string;
  /** Clases del contenedor interno del placeholder */
  inner: string;
}> = {
  'home-top': {
    height: 'h-[50px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-3',
  },
  'home-inline': {
    height: 'h-[100px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
  'match-stats': {
    height: 'h-[100px]',
    label:  'PUBLICIDAD',
    inner:  'flex items-center justify-center gap-4',
  },
};

// ─── Ilustración SVG inline (siempre estática, sin request externo) ───────────

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

// ─── Componente principal ─────────────────────────────────────────────────────

export function AdBanner({ zone, className = '' }: AdBannerProps) {
  const { isPremium, mounted } = usePremium();

  // Durante SSR/hydratación y para usuarios Premium: sin DOM
  if (!mounted || isPremium) return null;

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
      {/* Etiqueta de publicidad — cumplimiento normativo */}
      <span
        className="absolute top-0.5 right-1.5
                   text-[8px] font-semibold tracking-widest uppercase
                   text-slate-300 dark:text-zinc-600
                   select-none pointer-events-none"
        aria-hidden="true"
      >
        {config.label}
      </span>

      {/* Contenido del anuncio */}
      <div className={`w-full h-full ${config.inner}`}>
        <AdIllustration zone={zone} />
      </div>

      {/* Shimmer sutil para que no parezca roto */}
      <div
        className="absolute inset-0 pointer-events-none
                   bg-gradient-to-r from-transparent via-white/5 to-transparent
                   dark:via-white/3"
        aria-hidden="true"
      />
    </div>
  );
}
