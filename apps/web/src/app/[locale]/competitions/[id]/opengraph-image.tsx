import { ImageResponse } from 'next/og';
import { getCompetitionSeasons, getSeasonOverview } from '@/lib/api/client';
import { competitionName } from '@/lib/names';
import { fedLabelFromSeason } from '@/components/competition/format';

// Imagen OG dinámica por competición (#278). Next la sirve en
// /{locale}/competitions/{id}/opengraph-image.
//
// La ruta de metadatos NO recibe `searchParams`, así que no puede saber qué
// `?season=` traía el enlace compartido. Por eso la tarjeta muestra solo la
// identidad de la competición (nombre + federación) y NO una temporada concreta:
// así no vuelve a anunciar una temporada distinta a la del enlace (#279), que ya
// se resuelve en el título/descripción vía generateMetadata.
export const alt = 'Stick Live — Hockey patines en directo';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 300;

export default async function Image(props: { params: Promise<{ locale: string; id: string }> }) {
  const params = await props.params;
  let name = 'Stick Live';
  let subtitle = 'Clasificación, calendario y resultados';

  try {
    const seasons = await getCompetitionSeasons(params.id);
    const season = seasons.find((s) => s.isCurrent) || seasons[0];
    if (season) {
      const overview = await getSeasonOverview(season.id);
      const s = overview.season;
      name = competitionName(s.competitionName, s.competitionNameI18n, params.locale);
      subtitle = fedLabelFromSeason(s, params.locale) || subtitle;
    }
  } catch { /* tarjeta genérica si la API no responde */ }

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', alignItems: 'center', textAlign: 'center',
        background: '#0b1220', color: '#f8fafc', padding: '60px 80px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', width: '14px', height: '14px', borderRadius: '9999px', background: '#dc2626' }} />
          <div style={{ fontSize: '30px', fontWeight: 700, letterSpacing: '2px' }}>STICK LIVE</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px', maxWidth: '960px' }}>
          <div style={{ fontSize: '82px', fontWeight: 800, lineHeight: 1.05 }}>{name}</div>
          <div style={{ fontSize: '32px', color: '#94a3b8' }}>{subtitle}</div>
        </div>

        <div style={{ fontSize: '24px', color: '#94a3b8' }}>sticklive.eu</div>
      </div>
    ),
    { ...size },
  );
}
