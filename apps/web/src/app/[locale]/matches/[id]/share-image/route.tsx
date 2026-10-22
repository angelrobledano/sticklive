import { ImageResponse } from 'next/og';
import { getMatchDetail } from '@/lib/api/client';
import {
  Crest, SHARE_CACHE_HEADERS, SHARE_SIZES, SHARE_THEMES, ShareCanvas, ShareFooter, loadCrest,
} from '@/lib/share-image-kit';
import { isSupportedLocale } from '@/lib/locales';
import { MATCH_SHARE_COPY, matchShareCard, type MatchShareCard, type MatchShareSide } from '@/lib/match-share-card';
import { shareImageQuery } from '@/lib/team-share-card';

// Imagen para compartir el resultado de un partido (historia 9:16 o publicación
// 16:9, oscuro/claro). Mismo kit y mismo flujo de cliente que la del equipo.
// El pie lleva solo el dominio de Stick Live, sin la ruta del partido.
//
// GET /{locale}/matches/{id}/share-image?format=story|post&theme=dark|light

export const runtime = 'nodejs';

const MAX_SCORERS = 6;

export async function GET(req: Request, props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: rawLocale, id } = await props.params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : 'es';
  const copy = MATCH_SHARE_COPY[locale];
  const { format, theme } = shareImageQuery(new URL(req.url).searchParams);
  const c = SHARE_THEMES[theme];
  const story = format === 'story';
  const s = story ? 1 : 0.7;

  let card: MatchShareCard | null = null;
  try {
    card = matchShareCard(await getMatchDetail(id), { locale });
  } catch { /* tarjeta de marca si la API no responde */ }

  const [homeCrest, awayCrest] = await Promise.all([loadCrest(card?.home.id), loadCrest(card?.away.id)]);
  const hasScore = card?.home.score != null && card?.away.score != null;
  const winner = hasScore && card!.state === 'finished'
    ? (card!.home.score! > card!.away.score! ? 'home' : card!.away.score! > card!.home.score! ? 'away' : null)
    : null;

  const kicker = [card?.competition, card?.round].filter(Boolean).join(' · ').toUpperCase();
  const pill = card?.state === 'live'
    ? { text: copy.live.toUpperCase(), bg: '#dc2626', fg: '#ffffff' }
    : card?.state === 'finished'
      ? { text: copy.final.toUpperCase(), bg: c.card, fg: c.text }
      : card?.when ? { text: card.when, bg: c.card, fg: c.text } : null;

  const team = (side: MatchShareSide, crest: string | null, isWinner: boolean, dim: boolean) => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 * s, width: story ? 420 : 460,
      opacity: dim ? 0.72 : 1,
    }}>
      <Crest src={crest} name={side.name} size={story ? 240 : 190} bg={c.crestBg} />
      <div style={{
        display: 'flex', fontSize: (side.name.length > 20 ? 40 : 48) * s, fontWeight: 800, color: c.text,
        textAlign: 'center', justifyContent: 'center', lineHeight: 1.08, maxWidth: story ? 420 : 460,
        borderBottom: isWinner ? `${6 * s}px solid ${c.accent}` : `${6 * s}px solid rgba(0,0,0,0)`, paddingBottom: 8 * s,
      }}>{side.name}</div>
    </div>
  );

  const score = card ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 * s }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 40 * s, fontSize: (hasScore ? 240 : 130) * s, fontWeight: 900,
        color: c.text, lineHeight: 1, letterSpacing: '-0.04em',
      }}>
        {hasScore ? (
          <>
            <div style={{ display: 'flex', color: winner === 'away' ? c.muted : c.text }}>{card.home.score}</div>
            <div style={{ display: 'flex', width: 70 * s, height: 14 * s, borderRadius: 9999, background: c.accent, marginTop: 88 * s }} />
            <div style={{ display: 'flex', color: winner === 'home' ? c.muted : c.text }}>{card.away.score}</div>
          </>
        ) : copy.vs}
      </div>
      {card.note ? <div style={{ display: 'flex', fontSize: 32 * s, fontWeight: 700, color: c.accent }}>{card.note}</div> : null}
    </div>
  ) : null;

  // Balón en SVG (Satori no pinta emoji sin cargar fuentes de emoji).
  const ball = (size: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="#ffffff" stroke="#0b1220" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4.2" fill="#9E1235" />
      <circle cx="12" cy="12" r="1.6" fill="#ffffff" />
    </svg>
  );

  // Cada goleador es una ficha con relieve: degradado, sombra y contador en
  // círculo granate. Es lo que se comparte, así que tiene que leerse a 1 m.
  const scorerChip = (sc: MatchShareSide['scorers'][number], alignRight: boolean) => (
    <div key={sc.name} style={{
      display: 'flex', alignItems: 'center', gap: 14 * s, flexDirection: alignRight ? 'row-reverse' : 'row',
      padding: `${10 * s}px ${12 * s}px ${10 * s}px ${12 * s}px`, borderRadius: 9999,
      backgroundImage: theme === 'dark'
        ? 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 100%)'
        : 'linear-gradient(135deg, #ffffff 0%, #eef2f7 100%)',
      border: `2px solid ${theme === 'dark' ? 'rgba(255,255,255,0.18)' : '#e2e8f0'}`,
      boxShadow: theme === 'dark' ? '0 12px 28px rgba(0,0,0,0.5)' : '0 12px 28px rgba(15,23,42,0.14)',
    }}>
      {ball(44 * s)}
      <div style={{ display: 'flex', fontSize: 38 * s, fontWeight: 800, color: c.text, letterSpacing: '-0.01em' }}>{sc.name}</div>
      <div style={{ display: 'flex', gap: 8 * s }}>
        {sc.minutes.filter((m) => Number.isFinite(m)).map((m, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', height: 46 * s, padding: `0 ${14 * s}px`,
            borderRadius: 9999, background: 'linear-gradient(180deg, #c2185b 0%, #9E1235 100%)', color: '#ffffff',
            fontSize: 28 * s, fontWeight: 900, boxShadow: '0 4px 12px rgba(158,18,53,0.55)',
          }}>{`${m}'`}</div>
        ))}
      </div>
    </div>
  );

  const scorerColumn = (list: MatchShareSide['scorers'], alignRight: boolean) => {
    const shown = list.slice(0, MAX_SCORERS);
    const more = list.length - shown.length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: alignRight ? 'flex-end' : 'flex-start', gap: 16 * s, flex: 1 }}>
        {shown.map((sc) => scorerChip(sc, alignRight))}
        {more > 0 ? <div style={{ display: 'flex', fontSize: 28 * s, color: c.muted, padding: `0 ${18 * s}px` }}>{`+${more}`}</div> : null}
      </div>
    );
  };

  const scorers = card && (card.home.scorers.length > 0 || card.away.scorers.length > 0) ? (
    <div style={{ display: 'flex', width: '100%', gap: 28 * s, alignItems: 'flex-start' }}>
      {scorerColumn(card.home.scorers, true)}
      <div style={{ display: 'flex', alignSelf: 'stretch', width: 3, borderRadius: 9999, background: c.border }} />
      {scorerColumn(card.away.scorers, false)}
    </div>
  ) : null;

  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 * s }}>
      {kicker ? <div style={{ display: 'flex', fontSize: 30 * s, fontWeight: 700, color: c.accent, letterSpacing: '0.16em', textAlign: 'center' }}>{kicker}</div> : null}
      {pill ? (
        <div style={{
          display: 'flex', padding: `${10 * s}px ${26 * s}px`, borderRadius: 9999, background: pill.bg, color: pill.fg,
          border: `2px solid ${c.border}`, fontSize: 26 * s, fontWeight: 800, letterSpacing: '0.12em',
        }}>{pill.text}</div>
      ) : null}
    </div>
  );

  const footer = <ShareFooter format={format} theme={theme} follow={copy.follow} />;
  const dimHome = winner === 'away';
  const dimAway = winner === 'home';

  return new ImageResponse(
    (
      <ShareCanvas format={format} theme={theme}>
        {!card ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'flex-end' }}>{footer}</div>
        ) : story ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 36 }}>
            {header}
            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {team(card.home, homeCrest, winner === 'home', dimHome)}
              {team(card.away, awayCrest, winner === 'away', dimAway)}
            </div>
            {score}
            {scorers ?? <div style={{ display: 'flex' }} />}
            {footer}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', alignItems: 'center' }}>
            {header}
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
              {team(card.home, homeCrest, winner === 'home', dimHome)}
              {score}
              {team(card.away, awayCrest, winner === 'away', dimAway)}
            </div>
            {scorers ?? <div style={{ display: 'flex' }} />}
            {footer}
          </div>
        )}
      </ShareCanvas>
    ),
    { ...SHARE_SIZES[format], headers: SHARE_CACHE_HEADERS },
  );
}
