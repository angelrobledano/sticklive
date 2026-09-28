import { ImageResponse } from 'next/og';
import { getTeamDetail } from '@/lib/api/client';
import { clubName } from '@/lib/names';

// Imagen OG dinámica por equipo (#278): escudo + nombre + posición en liga.
// Next la sirve en /{locale}/teams/{id}/opengraph-image siguiendo el patrón de
// matches/[id]/opengraph-image.
export const alt = 'Stick Live — Hockey patines en directo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
// Sin revalidate, Next cachea la tarjeta indefinidamente: no reflejaría cambios
// de clasificación/escudo. 120 s = el mismo TTL que getTeamDetail.
export const revalidate = 120;

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

// `params` es una promesa desde Next 15, también en las rutas de metadatos.
export default async function Image(props: { params: Promise<{ locale: string; id: string }> }) {
  const params = await props.params;
  let loaded = false;
  let teamId = '';
  let hasLogo = false;
  let name = 'Stick Live';
  let subtitle = 'Hockey patines en directo';

  try {
    const data = await getTeamDetail(params.id);
    teamId = data.team.id;
    hasLogo = Boolean(data.team.logoUrl);
    name = clubName(data.team.name);
    const st = data.standing;
    subtitle = st
      ? [st.position != null ? `${st.position}º` : '', st.competitionName, `${st.points} pts`]
          .filter(Boolean).join(' · ')
      : (data.team.city ?? 'Hockey patines en directo');
    loaded = true;
  } catch { /* tarjeta genérica si la API no responde */ }

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
          {loaded && hasLogo ? (
            // El escudo normalizado trae fondo blanco: lo recortamos en círculo
            // para que se vea como un badge sobre el fondo oscuro de la tarjeta.
            <div style={{
              display: 'flex', width: '260px', height: '260px',
              borderRadius: '9999px', overflow: 'hidden', background: '#ffffff',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>, no next/image */}
              <img
                src={`${API}/teams/${teamId}/logo`}
                width={260}
                height={260}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                alt=""
              />
            </div>
          ) : null}
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
