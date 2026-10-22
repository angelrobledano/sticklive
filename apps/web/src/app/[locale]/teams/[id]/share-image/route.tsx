import { ImageResponse } from 'next/og';
import { getTeamDetail } from '@/lib/api/client';
import { OgLockup } from '@/lib/og-brand';
import { isSatoriRenderableImage, teamInitials, teamLogoUrlForSatori } from '@/lib/og-image';
import { localeLessUrl } from '@/lib/seo';
import { isSupportedLocale } from '@/lib/locales';
import { SHARE_COPY, shareImageQuery, teamShareCard, type Outcome, type TeamShareCard } from '@/lib/team-share-card';

// Imagen para compartir la ficha de un equipo en redes (historia 9:16 o
// publicación 16:9, tema oscuro o claro), renderizada en el servidor con Satori
// como la de alineaciones (matches/[id]/lineup-image): el cliente la descarga o
// la comparte con navigator.share, que es lo único fiable en iOS.
//
// GET /{locale}/teams/{id}/share-image?format=story|post&theme=dark|light

export const runtime = 'nodejs';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const SIZES = { story: { width: 1080, height: 1920 }, post: { width: 1600, height: 900 } } as const;

const THEMES = {
  dark: {
    bg: '#0b1220', glow: 'rgba(158,18,53,0.55)', card: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)',
    text: '#f8fafc', muted: '#94a3b8', accent: '#f87171', crestBg: '#ffffff',
  },
  light: {
    bg: '#f8fafc', glow: 'rgba(158,18,53,0.16)', card: '#ffffff', border: '#e2e8f0',
    text: '#0f172a', muted: '#64748b', accent: '#9E1235', crestBg: '#ffffff',
  },
} as const;

const OUTCOME_BG: Record<Outcome, string> = { W: '#047857', D: '#64748b', L: '#9E1235' };

/** Escudo a data-URL PNG en el servidor; null si no hay o no es PNG/JPEG (Satori no lee WebP). */
async function loadCrest(teamId: string): Promise<string | null> {
  try {
    const r = await fetch(teamLogoUrlForSatori(API, teamId), { cache: 'no-store' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!isSatoriRenderableImage(ct)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct.split(';')[0]!.trim().toLowerCase()};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function Crest({ src, name, size, bg }: { src: string | null; name: string; size: number; bg: string }) {
  return (
    <div style={{
      display: 'flex', width: size, height: size, borderRadius: 9999, background: bg, alignItems: 'center',
      justifyContent: 'center', overflow: 'hidden', color: '#0b1220', fontSize: size * 0.32, fontWeight: 800,
      boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
    }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>
        <img src={src} width={size * 0.8} height={size * 0.8} style={{ width: size * 0.8, height: size * 0.8, objectFit: 'contain' }} alt="" />
      ) : teamInitials(name)}
    </div>
  );
}

export async function GET(req: Request, props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await props.params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : 'es';
  const copy = SHARE_COPY[locale];
  const { format, theme } = shareImageQuery(new URL(req.url).searchParams);
  const size = SIZES[format];
  const c = THEMES[theme];
  const story = format === 'story';
  // Sin prefijo de idioma: quien la abra entra en el suyo (#277).
  const link = localeLessUrl(`/teams/${id}`).replace(/^https?:\/\//, '');

  let card: TeamShareCard | null = null;
  try {
    card = teamShareCard(await getTeamDetail(id), { locale });
  } catch { /* tarjeta de marca si la API no responde */ }

  const [crest, lastCrest, nextCrest] = await Promise.all([
    card ? loadCrest(id) : Promise.resolve(null),
    card?.lastMatch ? loadCrest(card.lastMatch.opponentId) : Promise.resolve(null),
    card?.nextMatch ? loadCrest(card.nextMatch.opponentId) : Promise.resolve(null),
  ]);

  const s = story ? 1 : 0.62; // escala tipográfica de la publicación respecto a la historia
  const kicker = [card?.competition, card?.season].filter(Boolean).join(' · ').toUpperCase();

  const stat = (value: string | number, label: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 110 * s }}>
      <div style={{ display: 'flex', fontSize: 64 * s, fontWeight: 800, color: c.text, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ display: 'flex', fontSize: 24 * s, fontWeight: 700, color: c.muted, letterSpacing: '0.12em' }}>{label}</div>
    </div>
  );

  const matchRow = (label: string, crestSrc: string | null, opponent: string, right: string, rightColor: string, sub: string) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 24 * s, padding: `${24 * s}px ${30 * s}px`, borderRadius: 24 * s,
      background: c.card, border: `2px solid ${c.border}`, ...(story ? { width: '100%' } : { flex: 1 }),
    }}>
      <Crest src={crestSrc} name={opponent} size={84 * s} bg={c.crestBg} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
        <div style={{ display: 'flex', fontSize: 22 * s, fontWeight: 700, color: c.muted, letterSpacing: '0.14em' }}>{label.toUpperCase()}</div>
        <div style={{ display: 'flex', fontSize: 36 * s, fontWeight: 800, color: c.text }}>{opponent}</div>
        <div style={{ display: 'flex', fontSize: 24 * s, color: c.muted }}>{sub}</div>
      </div>
      <div style={{ display: 'flex', fontSize: 48 * s, fontWeight: 800, color: rightColor }}>{right}</div>
    </div>
  );

  const identity = card ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-start', gap: 22 * s }}>
      <Crest src={crest} name={card.teamName} size={story ? 300 : 230} bg={c.crestBg} />
      <div style={{ display: 'flex', fontSize: 30 * s, fontWeight: 700, color: c.accent, letterSpacing: '0.16em' }}>{kicker}</div>
      <div style={{
        display: 'flex', fontSize: (card.teamName.length > 22 ? 78 : 96) * s, fontWeight: 800, color: c.text,
        lineHeight: 1.02, letterSpacing: '-0.02em', textAlign: story ? 'center' : 'left', maxWidth: story ? 940 : 760,
        justifyContent: story ? 'center' : 'flex-start',
      }}>{card.teamName}</div>
      {card.section ? <div style={{ display: 'flex', fontSize: 30 * s, color: c.muted }}>{card.section}</div> : null}
    </div>
  ) : null;

  const numbers = card ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-start', gap: 28 * s }}>
      {card.position != null ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 26 * s }}>
          <div style={{ display: 'flex', fontSize: 260 * s, fontWeight: 900, color: c.text, lineHeight: 0.9, letterSpacing: '-0.05em' }}>
            {card.position}
            <span style={{ fontSize: 120 * s, color: c.accent }}>º</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 18 * s }}>
            <div style={{ display: 'flex', fontSize: 72 * s, fontWeight: 800, color: c.text }}>{card.points}</div>
            <div style={{ display: 'flex', fontSize: 26 * s, fontWeight: 700, color: c.muted, letterSpacing: '0.12em' }}>{copy.points.toUpperCase()}</div>
          </div>
        </div>
      ) : null}
      {card.record ? (
        <div style={{ display: 'flex', gap: 18 * s }}>
          {stat(card.record.played, copy.played)}
          {stat(card.record.won, copy.won)}
          {stat(card.record.drawn, copy.drawn)}
          {stat(card.record.lost, copy.lost)}
          {stat(`${card.record.goalsFor}–${card.record.goalsAgainst}`, copy.goals.toUpperCase())}
        </div>
      ) : null}
      {card.form.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * s }}>
          <div style={{ display: 'flex', fontSize: 24 * s, fontWeight: 700, color: c.muted, letterSpacing: '0.14em', marginRight: 8 * s }}>{copy.form.toUpperCase()}</div>
          {card.form.map((o, i) => (
            <div key={i} style={{
              display: 'flex', width: 58 * s, height: 58 * s, borderRadius: 14 * s, background: OUTCOME_BG[o],
              color: '#ffffff', fontSize: 30 * s, fontWeight: 800, alignItems: 'center', justifyContent: 'center',
            }}>{copy.outcome[o]}</div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const matches = card && (card.lastMatch || card.nextMatch) ? (
    <div style={{ display: 'flex', flexDirection: story ? 'column' : 'row', gap: 20 * s, width: '100%' }}>
      {card.lastMatch ? matchRow(
        copy.last, lastCrest, card.lastMatch.opponent,
        `${card.lastMatch.teamGoals}–${card.lastMatch.opponentGoals}`,
        OUTCOME_BG[card.lastMatch.outcome] === '#64748b' ? c.muted : (card.lastMatch.outcome === 'W' ? '#10b981' : c.accent),
        card.lastMatch.home ? copy.home : copy.away,
      ) : null}
      {card.nextMatch ? matchRow(
        copy.next, nextCrest, card.nextMatch.opponent, '', c.text,
        `${card.nextMatch.when} · ${card.nextMatch.home ? copy.home : copy.away}`,
      ) : null}
    </div>
  ) : null;

  const footer = (
    <div style={{
      display: 'flex', flexDirection: story ? 'column' : 'row', alignItems: 'center',
      justifyContent: story ? 'center' : 'space-between', gap: story ? 18 : 0, width: '100%',
    }}>
      <OgLockup height={story ? 64 : 48} onLight={theme === 'light'} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-end', gap: 4 }}>
        <div style={{ display: 'flex', fontSize: 26 * (story ? 1 : 0.8), fontWeight: 700, color: c.text }}>{copy.follow}</div>
        <div style={{ display: 'flex', fontSize: 22 * (story ? 1 : 0.8), color: c.muted }}>{link}</div>
      </div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative',
        background: c.bg, backgroundImage: `linear-gradient(180deg, ${c.glow} 0%, rgba(0,0,0,0) ${story ? 38 : 60}%)`, color: c.text, padding: story ? '96px 72px 80px' : '56px 64px 48px',
      }}>
        <div style={{ position: 'absolute', display: 'flex', left: 0, right: 0, bottom: 0, height: 12, background: '#9E1235' }} />

        {story ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 40 }}>
            {identity}
            {numbers}
            {matches}
            {footer}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48 }}>
              {identity}
              {numbers}
            </div>
            {matches}
            {footer}
          </div>
        )}
      </div>
    ),
    {
      ...size,
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    },
  );
}
