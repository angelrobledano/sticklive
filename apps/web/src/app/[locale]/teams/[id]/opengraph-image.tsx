import { ImageResponse } from 'next/og';
import { OG_BRAND, OgBrandStrip, OgLockup } from '@/lib/og-brand';
import { getTeamDetail } from '@/lib/api/client';
import { ogCopy, teamInitials, teamLogoUrlForSatori } from '@/lib/og-image';
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
  const copy = ogCopy(params.locale);
  let loaded = false;
  let teamId = '';
  let hasLogo = false;
  let name = 'Stick Live';
  let subtitle = copy.hockey;

  try {
    const data = await getTeamDetail(params.id);
    teamId = data.team.id;
    hasLogo = Boolean(data.team.logoUrl);
    name = clubName(data.team.name);
    const st = data.standing;
    subtitle = st
      ? [st.position != null ? `${st.position}º` : '', st.competitionName, `${st.points} pts`]
          .filter(Boolean).join(' · ')
      : (data.team.city ?? copy.hockey);
    loaded = true;
  } catch { /* tarjeta genérica si la API no responde */ }

  const image = new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', position: 'relative', background: OG_BRAND.night, color: OG_BRAND.text, padding: '60px 64px',
      }}>
        <div style={{ display: 'flex' }}>
          <OgLockup />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '56px' }}>
          {loaded ? (
            // F3-1: PNG para Satori; sin escudo, iniciales (nunca un círculo vacío).
            <div style={{
              display: 'flex', width: '260px', height: '260px', alignItems: 'center',
              justifyContent: 'center', borderRadius: '9999px', overflow: 'hidden',
              background: '#ffffff', color: OG_BRAND.night, fontSize: '84px', fontWeight: 800,
            }}>
              {hasLogo ? (
                /* eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>, no next/image */
                <img
                  src={teamLogoUrlForSatori(API, teamId)}
                  width={260}
                  height={260}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  alt=""
                />
              ) : teamInitials(name)}
            </div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '780px' }}>
            <div style={{ fontSize: '76px', fontWeight: 800, lineHeight: 1.05 }}>{name}</div>
            <div style={{ fontSize: '30px', color: OG_BRAND.muted }}>{subtitle}</div>
          </div>
        </div>

        <div style={{ fontSize: '24px', color: OG_BRAND.muted }}>sticklive.eu</div>
        <OgBrandStrip />
      </div>
    ),
    { ...size },
  );
  // F3-5: caché de borde acorde al `revalidate` de 120 s.
  image.headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600');
  return image;
}
