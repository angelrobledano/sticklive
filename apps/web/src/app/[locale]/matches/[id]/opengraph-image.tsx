import { ImageResponse } from 'next/og';
import { OG_BRAND, OgBrandStrip, OgLockup } from '@/lib/og-brand';
import { getMatchDetail } from '@/lib/api/client';
import { teamInitials, teamLogoUrlForSatori } from '@/lib/og-image';
import { teamTitleName } from '@/lib/names';

// Imagen OG dinámica por partido (escudos + marcador) para compartir en
// WhatsApp/Twitter/etc. Next la sirve en /{locale}/matches/{id}/opengraph-image.
export const alt = 'Stick Live — Hockey patines en directo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Sin esto, Next cachea la imagen de forma indefinida (se generaría con el
// partido "VS" antes de empezar y nunca reflejaría el directo). Con revalidate
// la tarjeta OG refresca marcador y "EN DIRECTO" cada 30 s.
export const revalidate = 30;
// La URL de esta imagen puede incluir un token `?v=<hash(estado)>` (#274) que
// esta ruta ignora: solo sirve para que los scrapers pidan una URL nueva cuando
// cambia el marcador/estado (socialMeta lo construye con socialImageUrl).

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

// `params` es una promesa desde Next 15, también en las rutas de metadatos
// (opengraph-image, twitter-image, icon…). El codemod oficial
// `next-async-request-api` NO cubre estos ficheros: hay que hacerlo a mano.
export default async function Image(props: { params: Promise<{ locale: string; id: string }> }) {
  const params = await props.params;
  let home = 'Local';
  let away = 'Visitante';
  let homeId = '';
  let awayId = '';
  let homeLogo = false;
  let awayLogo = false;
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  let status = 'scheduled';
  let dateLine = '';

  try {
    const data = await getMatchDetail(params.id);
    home = teamTitleName(data.match.homeTeam?.name, data.match.homeTeam?.shortName) || 'Local';
    away = teamTitleName(data.match.awayTeam?.name, data.match.awayTeam?.shortName) || 'Visitante';
    homeId = data.match.homeTeam?.id ?? '';
    awayId = data.match.awayTeam?.id ?? '';
    homeLogo = Boolean(data.match.homeTeam?.logoUrl);
    awayLogo = Boolean(data.match.awayTeam?.logoUrl);
    homeScore = data.match.score.home;
    awayScore = data.match.score.away;
    status = data.match.status;
    if (data.match.scheduledAt) {
      dateLine = new Date(data.match.scheduledAt).toLocaleDateString('es-ES', {
        day: 'numeric', month: 'long', timeZone: 'Europe/Madrid',
      });
    }
  } catch { /* tarjeta genérica si la API no responde */ }

  const finished = status === 'finished';
  const live = status === 'live';
  const showScore = finished || live;
  const center = showScore ? `${homeScore ?? 0} – ${awayScore ?? 0}` : 'VS';
  const statusLine = live ? 'EN DIRECTO' : finished ? `FINAL · ${dateLine}` : dateLine;
  // F3-1: Satori no decodifica WebP; la API sirve el escudo en PNG con
  // `?format=png`. Si no hay escudo, iniciales: nunca un círculo vacío.
  const logo = (id: string) => teamLogoUrlForSatori(API, id);

  const side = (name: string, id: string, hasLogo: boolean) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '380px', gap: '24px' }}>
      <div style={{
        display: 'flex', width: '170px', height: '170px', alignItems: 'center', justifyContent: 'center',
        borderRadius: '9999px', overflow: 'hidden', background: '#ffffff',
        color: OG_BRAND.night, fontSize: '54px', fontWeight: 800,
      }}>
        {id && hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo(id)} width={170} height={170}
               style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt="" />
        ) : teamInitials(name)}
      </div>
      <div style={{ fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.1 }}>{name}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', position: 'relative', background: OG_BRAND.night, color: OG_BRAND.text, padding: '60px 64px',
      }}>
        <div style={{ display: 'flex' }}>
          <OgLockup />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {side(home, homeId, homeLogo)}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <div style={{ fontSize: '92px', fontWeight: 800 }}>{center}</div>
            {live ? (
              // Directo: el punto verde de la marca, el mismo verde que el token live.
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 20px',
                borderRadius: '9999px', background: 'rgba(16,185,129,0.16)',
              }}>
                <div style={{ display: 'flex', width: '14px', height: '14px', borderRadius: '9999px', background: OG_BRAND.live }} />
                <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '2px', color: OG_BRAND.live }}>{statusLine}</div>
              </div>
            ) : (
              <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '2px', color: OG_BRAND.muted }}>
                {statusLine}
              </div>
            )}
          </div>
          {side(away, awayId, awayLogo)}
        </div>

        <div style={{ fontSize: '24px', color: OG_BRAND.muted }}>sticklive.eu</div>
        <OgBrandStrip />
      </div>
    ),
    { ...size }
  );
}
