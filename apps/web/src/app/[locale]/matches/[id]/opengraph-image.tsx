import { ImageResponse } from 'next/og';
import { getMatchDetail } from '@/lib/api/client';
import { clubName } from '@/lib/names';

// Imagen OG dinámica por partido (escudos + marcador) para compartir en
// WhatsApp/Twitter/etc. Next la sirve en /{locale}/matches/{id}/opengraph-image.
export const alt = 'Stick Live — Hockey patines en directo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Sin esto, Next cachea la imagen de forma indefinida (se generaría con el
// partido "VS" antes de empezar y nunca reflejaría el directo). Con revalidate
// la tarjeta OG refresca marcador y "EN DIRECTO" cada 30 s.
export const revalidate = 30;

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export default async function Image({ params }: { params: { locale: string; id: string } }) {
  let home = 'Local';
  let away = 'Visitante';
  let homeId = '';
  let awayId = '';
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  let status = 'scheduled';
  let dateLine = '';

  try {
    const data = await getMatchDetail(params.id);
    home = clubName(data.match.homeTeam?.shortName ?? data.match.homeTeam?.name ?? 'Local');
    away = clubName(data.match.awayTeam?.shortName ?? data.match.awayTeam?.name ?? 'Visitante');
    homeId = data.match.homeTeam?.id ?? '';
    awayId = data.match.awayTeam?.id ?? '';
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
  const logo = (id: string) => `${API}/teams/${id}/logo`;

  const side = (name: string, id: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '380px', gap: '24px' }}>
      {id ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo(id)} width={170} height={170} style={{ objectFit: 'contain' }} alt="" />
      ) : null}
      <div style={{ fontSize: '44px', fontWeight: 700, textAlign: 'center', lineHeight: 1.1 }}>{name}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', background: '#0b1220', color: '#f8fafc', padding: '60px 64px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', width: '14px', height: '14px', borderRadius: '9999px', background: '#dc2626' }} />
          <div style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '2px' }}>STICK LIVE</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {side(home, homeId)}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <div style={{ fontSize: '92px', fontWeight: 800 }}>{center}</div>
            <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '2px', color: live ? '#34d399' : '#94a3b8' }}>
              {statusLine}
            </div>
          </div>
          {side(away, awayId)}
        </div>

        <div style={{ fontSize: '24px', color: '#94a3b8' }}>sticklive.eu</div>
      </div>
    ),
    { ...size }
  );
}
