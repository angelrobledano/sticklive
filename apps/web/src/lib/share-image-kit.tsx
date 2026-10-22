/**
 * Piezas comunes de las imágenes para compartir (equipo y partido): tamaños,
 * temas, escudo, lienzo con degradado de marca y pie con logo + dominio.
 * Solo Satori (next/og): estilos en línea y `display: flex` en cada nodo.
 */
import type { ReactNode } from 'react';
import { OgLockup } from './og-brand';
import { isSatoriRenderableImage, teamInitials, teamLogoUrlForSatori } from './og-image';
import { SITE_URL } from './seo';
import { shareSiteHost } from './match-share-card';
import type { ShareFormat, ShareTheme } from './team-share-card';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export const SHARE_SIZES = { story: { width: 1080, height: 1920 }, post: { width: 1600, height: 900 } } as const;

export const SHARE_THEMES = {
  dark: {
    bg: '#0b1220', glow: 'rgba(158,18,53,0.55)', card: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)',
    text: '#f8fafc', muted: '#94a3b8', accent: '#f87171', crestBg: '#ffffff', win: '#10b981',
  },
  light: {
    bg: '#f8fafc', glow: 'rgba(158,18,53,0.16)', card: '#ffffff', border: '#e2e8f0',
    text: '#0f172a', muted: '#64748b', accent: '#9E1235', crestBg: '#ffffff', win: '#047857',
  },
} as const;

export type ShareThemeColors = (typeof SHARE_THEMES)[ShareTheme];

/** Solo el dominio en el pie ("sticklive.eu"): legible y sin ids. */
export const SHARE_HOST = shareSiteHost(SITE_URL);

export const SHARE_CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' };

/** Cualquier imagen remota a data-URL si Satori puede pintarla (PNG/JPEG); si no, null. */
export async function loadImage(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!isSatoriRenderableImage(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct.split(';')[0]!.trim().toLowerCase()};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Escudo a data-URL en el servidor; null si no hay o no es PNG/JPEG (Satori no lee WebP). */
export async function loadCrest(teamId: string | null | undefined): Promise<string | null> {
  return teamId ? loadImage(teamLogoUrlForSatori(API, teamId)) : null;
}

export function Crest({ src, name, size, bg }: { src: string | null; name: string; size: number; bg: string }) {
  return (
    <div style={{
      display: 'flex', width: size, height: size, borderRadius: 9999, background: bg, alignItems: 'center',
      justifyContent: 'center', overflow: 'hidden', color: '#0b1220', fontSize: size * 0.32, fontWeight: 800,
      boxShadow: '0 12px 40px rgba(0,0,0,0.25)', flexShrink: 0,
    }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>
        <img src={src} width={size * 0.8} height={size * 0.8} style={{ width: size * 0.8, height: size * 0.8, objectFit: 'contain' }} alt="" />
      ) : teamInitials(name)}
    </div>
  );
}

export function ShareFooter({ format, theme, follow }: { format: ShareFormat; theme: ShareTheme; follow: string }) {
  const story = format === 'story';
  const c = SHARE_THEMES[theme];
  return (
    <div style={{
      display: 'flex', flexDirection: story ? 'column' : 'row', alignItems: 'center',
      justifyContent: story ? 'center' : 'space-between', gap: story ? 18 : 0, width: '100%',
    }}>
      <OgLockup height={story ? 64 : 48} onLight={theme === 'light'} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-end', gap: 4 }}>
        <div style={{ display: 'flex', fontSize: story ? 26 : 21, color: c.muted }}>{follow}</div>
        <div style={{ display: 'flex', fontSize: story ? 34 : 28, fontWeight: 700, color: c.text, letterSpacing: '0.01em' }}>{SHARE_HOST}</div>
      </div>
    </div>
  );
}

/** Lienzo: fondo del tema, degradado granate arriba y franja de marca abajo. */
export function ShareCanvas({ format, theme, children }: { format: ShareFormat; theme: ShareTheme; children: ReactNode }) {
  const story = format === 'story';
  const c = SHARE_THEMES[theme];
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative',
      background: c.bg, backgroundImage: `linear-gradient(180deg, ${c.glow} 0%, rgba(0,0,0,0) ${story ? 38 : 60}%)`,
      color: c.text, padding: story ? '96px 72px 80px' : '56px 64px 48px',
    }}>
      <div style={{ position: 'absolute', display: 'flex', left: 0, right: 0, bottom: 0, height: 12, background: '#9E1235' }} />
      {children}
    </div>
  );
}
