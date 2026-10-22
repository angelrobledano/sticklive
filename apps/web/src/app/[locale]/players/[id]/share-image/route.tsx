import { ImageResponse } from 'next/og';
import { getPlayerDetail, getPlayerInsights } from '@/lib/api/client';
import {
  Crest, SHARE_CACHE_HEADERS, SHARE_SIZES, SHARE_THEMES, ShareCanvas, ShareFooter, loadCrest, loadImage,
} from '@/lib/share-image-kit';
import { isSupportedLocale } from '@/lib/locales';
import { PLAYER_SHARE_COPY, playerShareCard, type PlayerShareCard } from '@/lib/player-share-card';
import { shareImageQuery } from '@/lib/team-share-card';
import { teamInitials } from '@/lib/og-image';

// Imagen para compartir el perfil de un jugador (historia 9:16 o publicación
// 16:9, oscuro/claro): foto, dorsal, equipo, cifras de la temporada y lo más
// destacado. Mismo kit que equipo y partido; pie con el dominio de Stick Live.
//
// GET /{locale}/players/{id}/share-image?format=story|post&theme=dark|light

export const runtime = 'nodejs';

export async function GET(req: Request, props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await props.params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : 'es';
  const copy = PLAYER_SHARE_COPY[locale];
  const { format, theme } = shareImageQuery(new URL(req.url).searchParams);
  const c = SHARE_THEMES[theme];
  const story = format === 'story';
  const s = story ? 1 : 0.8;

  let card: PlayerShareCard | null = null;
  try {
    const [detail, insights] = await Promise.all([
      getPlayerDetail(id),
      getPlayerInsights(id).catch(() => null),
    ]);
    card = playerShareCard(detail, insights, { locale });
  } catch { /* tarjeta de marca si la API no responde */ }

  const [photo, crest] = await Promise.all([loadImage(card?.photoUrl), loadCrest(card?.teamId)]);
  const fullName = card ? `${card.firstName} ${card.lastName}`.trim() : '';
  const photoSize = story ? 380 : 260;

  const portrait = card ? (
    <div style={{ display: 'flex', position: 'relative', width: photoSize, height: photoSize, flexShrink: 0 }}>
      <div style={{
        display: 'flex', width: photoSize, height: photoSize, borderRadius: 9999, overflow: 'hidden',
        border: `${8 * s}px solid ${c.accent}`, background: c.card, alignItems: 'center', justifyContent: 'center',
        color: c.text, fontSize: photoSize * 0.3, fontWeight: 800,
      }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>
          <img src={photo} width={photoSize} height={photoSize} style={{ width: photoSize, height: photoSize, objectFit: 'cover', objectPosition: 'top' }} alt="" />
        ) : teamInitials(fullName)}
      </div>
      {card.number != null ? (
        <div style={{
          position: 'absolute', display: 'flex', right: -6 * s, bottom: 6 * s, width: 120 * s, height: 120 * s, borderRadius: 9999,
          background: '#9E1235', color: '#ffffff', alignItems: 'center', justifyContent: 'center',
          fontSize: 62 * s, fontWeight: 900, border: `${6 * s}px solid ${c.bg}`,
        }}>{card.number}</div>
      ) : null}
    </div>
  ) : null;

  const kicker = [card?.competition, card?.season].filter(Boolean).join(' · ').toUpperCase();

  const identity = card ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-start', gap: 12 * s }}>
      {kicker ? <div style={{ display: 'flex', fontSize: 28 * s, fontWeight: 700, color: c.accent, letterSpacing: '0.16em' }}>{kicker}</div> : null}
      <div style={{ display: 'flex', fontSize: 52 * s, color: c.muted, lineHeight: 1 }}>{card.firstName}</div>
      <div style={{
        display: 'flex', fontSize: (card.lastName.length > 12 ? 96 : 120) * s, fontWeight: 900, color: c.text,
        lineHeight: 0.95, letterSpacing: '-0.03em', textAlign: story ? 'center' : 'left',
      }}>{card.lastName.toUpperCase()}</div>
      {card.team ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 * s, marginTop: 10 * s }}>
          <Crest src={crest} name={card.team} size={64 * s} bg={c.crestBg} />
          <div style={{ display: 'flex', fontSize: 36 * s, fontWeight: 700, color: c.text }}>{card.team}</div>
          {card.goalkeeper ? <div style={{ display: 'flex', fontSize: 28 * s, color: c.muted }}>{`· ${copy.goalkeeper}`}</div> : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const numbers = card ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-start', gap: 30 * s, ...(story ? { width: '100%' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22 * s }}>
        <div style={{ display: 'flex', fontSize: 240 * s, fontWeight: 900, color: c.text, lineHeight: 0.85, letterSpacing: '-0.05em' }}>{card.hero.value}</div>
        <div style={{ display: 'flex', fontSize: 40 * s, fontWeight: 800, color: c.accent, letterSpacing: '0.1em', paddingBottom: 16 * s }}>{card.hero.label.toUpperCase()}</div>
      </div>
      <div style={{ display: 'flex', gap: 16 * s }}>
        {card.stats.map((st) => (
          <div key={st.label} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 170 * s, padding: `${18 * s}px ${20 * s}px`,
            borderRadius: 20 * s, background: c.card, border: `2px solid ${c.border}`,
          }}>
            <div style={{ display: 'flex', fontSize: 58 * s, fontWeight: 800, color: c.text }}>{st.value}</div>
            <div style={{ display: 'flex', fontSize: 22 * s, fontWeight: 700, color: c.muted, letterSpacing: '0.12em' }}>{st.label.toUpperCase()}</div>
          </div>
        ))}
      </div>
      {card.highlights.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: story ? 'center' : 'flex-start', gap: 12 * s }}>
          {card.highlights.map((h) => (
            <div key={h} style={{
              display: 'flex', alignItems: 'center', gap: 14 * s, fontSize: 32 * s, fontWeight: 700, color: c.text,
              padding: `${12 * s}px ${24 * s}px ${12 * s}px ${14 * s}px`, borderRadius: 9999,
              backgroundImage: theme === 'dark'
                ? 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 100%)'
                : 'linear-gradient(135deg, #ffffff 0%, #eef2f7 100%)',
              border: `2px solid ${theme === 'dark' ? 'rgba(255,255,255,0.18)' : '#e2e8f0'}`,
              boxShadow: theme === 'dark' ? '0 12px 28px rgba(0,0,0,0.5)' : '0 12px 28px rgba(15,23,42,0.14)',
            }}>
              <div style={{
                display: 'flex', width: 40 * s, height: 40 * s, borderRadius: 9999, alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(180deg, #c2185b 0%, #9E1235 100%)', color: '#ffffff', fontSize: 24 * s, fontWeight: 900,
                boxShadow: '0 4px 12px rgba(158,18,53,0.55)',
              }}>
                <svg width={22 * s} height={22 * s} viewBox="0 0 24 24">
                  <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill="#ffffff" />
                </svg>
              </div>
              {h}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  const footer = <ShareFooter format={format} theme={theme} follow={copy.follow} />;

  return new ImageResponse(
    (
      <ShareCanvas format={format} theme={theme}>
        {!card ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'flex-end' }}>{footer}</div>
        ) : story ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 32 }}>
            {portrait}
            {identity}
            {numbers}
            {footer}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48, flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 30, width: 640 }}>
                {portrait}
                {identity}
              </div>
              {numbers}
            </div>
            {footer}
          </div>
        )}
      </ShareCanvas>
    ),
    { ...SHARE_SIZES[format], headers: SHARE_CACHE_HEADERS },
  );
}
