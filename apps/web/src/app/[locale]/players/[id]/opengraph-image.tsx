import { ImageResponse } from 'next/og';
import { getPlayerDetail } from '@/lib/api/client';
import { toTitleCase, clubName } from '@/lib/names';

// Imagen OG dinámica por jugador (#278): foto + nombre + equipo/temporada.
// Next la sirve en /{locale}/players/{id}/opengraph-image.
export const alt = 'Stick Live — Hockey patines en directo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 120;

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export default async function Image(props: { params: Promise<{ locale: string; id: string }> }) {
  const params = await props.params;
  let loaded = false;
  let playerId = '';
  let hasPhoto = false;
  let name = 'Stick Live';
  let subtitle = 'Hockey patines en directo';

  try {
    const data = await getPlayerDetail(params.id);
    playerId = data.player.id;
    hasPhoto = Boolean(data.player.photoUrl);
    name = toTitleCase(`${data.player.firstName} ${data.player.lastName}`);
    const team = data.currentTeam ? clubName(data.currentTeam.name) : null;
    const role = data.player.isGoalkeeper ? 'Portero' : null;
    const goals = data.seasonTotals.goals > 0 ? `${data.seasonTotals.goals} goles` : null;
    subtitle = [team, role, goals].filter(Boolean).join(' · ') || 'Hockey patines en directo';
    loaded = true;
  } catch { /* tarjeta genérica si la API no responde */ }

  const initial = name.charAt(0).toUpperCase() || '·';

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

        <div style={{ display: 'flex', alignItems: 'center', gap: '56px' }}>
          {loaded && hasPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>, no next/image
            <img
              src={`${API}/players/${playerId}/photo`}
              width={260}
              height={260}
              style={{ width: 260, height: 260, borderRadius: 130, objectFit: 'cover', border: '4px solid #dc2626', background: '#e2e8f0' }}
              alt=""
            />
          ) : (
            <div style={{
              width: 260, height: 260, borderRadius: 130, border: '4px solid #dc2626',
              background: '#1e293b', fontSize: 110, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {initial}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '780px' }}>
            <div style={{ fontSize: '76px', fontWeight: 800, lineHeight: 1.05 }}>{name}</div>
            <div style={{ fontSize: '30px', color: '#94a3b8' }}>{subtitle}</div>
          </div>
        </div>

        <div style={{ fontSize: '24px', color: '#94a3b8' }}>sticklive.eu</div>
      </div>
    ),
    { ...size },
  );
}
