import { ImageResponse } from 'next/og';
import { getMatchDetail, type LineupPlayer } from '@/lib/api/client';
import { teamTitleName } from '@/lib/names';
import { OgLockup } from '@/lib/og-brand';
import { localeLessUrl } from '@/lib/seo';

// Imagen del 5 inicial sobre la pista, renderizada EN EL SERVIDOR (Satori/next/og).
// Sustituye a html2canvas, que en iOS Safari/WebKit se cuelga rasterizando el DOM.
// El cliente pre-descarga este PNG y lo comparte con navigator.share() de forma
// síncrona dentro del gesto del usuario, que es lo único fiable en iOS.
//
// GET /{locale}/matches/{id}/lineup-image  →  image/png 1200×630

export const runtime = 'nodejs';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const SIZE = { width: 1200, height: 630 };

/**
 * Descarga la foto del jugador a data-URL (PNG/JPG) en el servidor; null si no
 * hay o falla, para dibujar entonces una silueta con elementos nativos (Satori
 * tiene soporte irregular de SVG en data: URI, así que no lo usamos para el fallback).
 */
async function loadPhoto(playerId: string | null | undefined): Promise<string | null> {
  if (!playerId) return null;
  try {
    const r = await fetch(`${API}/players/${playerId}/photo`, { cache: 'no-store' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.startsWith('image/') || ct.includes('svg')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Nombre corto para el chip: apellido (primer token) en Title Case. */
function chipName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  const token = parts[0] ?? raw;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

// Posiciones del 5 inicial en media pista (idénticas al render del cliente).
function halfPositions(fieldCount: number): Array<{ x: number; y: number }> {
  switch (fieldCount) {
    case 4: return [{ x: 42, y: 28 }, { x: 42, y: 72 }, { x: 74, y: 34 }, { x: 74, y: 66 }];
    case 3: return [{ x: 42, y: 50 }, { x: 72, y: 28 }, { x: 72, y: 72 }];
    case 2: return [{ x: 55, y: 32 }, { x: 55, y: 68 }];
    case 1: return [{ x: 55, y: 50 }];
    default: return [];
  }
}

interface Placed { p: LineupPlayer; x: number; y: number; accent: boolean }

/** Coloca un equipo en su media pista (local izquierda, visitante espejado). */
function place(players: LineupPlayer[], isAway: boolean): Array<{ p: LineupPlayer; x: number; y: number }> {
  const gk = players.find((p) => p.isGoalkeeper) ?? null;
  const field = players.filter((p) => p !== gk);
  const spots = halfPositions(Math.min(field.length, 4));
  const out: Array<{ p: LineupPlayer; x: number; y: number }> = [];
  if (gk) out.push({ p: gk, x: 22, y: 50 });
  field.slice(0, 4).forEach((p, i) => {
    const s = spots[i]!;
    out.push({ p, x: s.x, y: s.y });
  });
  return out.map(({ p, x, y }) => ({ p, x: isAway ? 100 - x / 2 : x / 2, y }));
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  // #280: la imagen compartida debe llevar de vuelta al partido. Usamos la URL
  // SIN prefijo de idioma para que el receptor abra en el suyo (el middleware
  // negocia Accept-Language, #277) y la mostramos sin esquema.
  const shareLink = localeLessUrl(`/matches/${params.id}`).replace(/^https?:\/\//, '');
  let homeName = 'Local';
  let awayName = 'Visitante';
  let positioned: Placed[] = [];

  try {
    const data = await getMatchDetail(params.id);
    homeName = teamTitleName(data.match.homeTeam?.name, data.match.homeTeam?.shortName) || 'Local';
    awayName = teamTitleName(data.match.awayTeam?.name, data.match.awayTeam?.shortName) || 'Visitante';
    const homeStart = (data.lineups?.home ?? []).filter((p) => p.isStarter);
    const awayStart = (data.lineups?.away ?? []).filter((p) => p.isStarter);
    positioned = [
      ...place(awayStart, true).map((e) => ({ ...e, accent: false })),
      ...place(homeStart, false).map((e) => ({ ...e, accent: true })),
    ];
  } catch {
    /* tarjeta mínima si la API no responde */
  }

  // Pre-cargar todas las fotos (en paralelo) a data-URL para que Satori no haga red.
  const photos = await Promise.all(positioned.map((e) => loadPhoto(e.p.playerId)));

  // Geometría de la pista en píxeles.
  const RW = 1104; // ancho útil de la pista
  const RH = 470;  // alto útil de la pista
  const CHIP_W = 120;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: '#0b1220', color: '#f8fafc',
      }}>
        {/* Cabecera */}
        <div style={{
          height: 96, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 48px',
        }}>
          <div style={{ display: 'flex' }}>
            <OgLockup />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: 9999, background: '#dc2626' }} />
              <div style={{ fontWeight: 700 }}>{homeName}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: 9999, background: '#f8fafc' }} />
              <div style={{ fontWeight: 700 }}>{awayName}</div>
            </div>
          </div>
        </div>

        {/* Pista */}
        <div style={{ display: 'flex', position: 'relative', width: RW, height: RH, margin: '0 48px' }}>
          {/* Superficie */}
          <div style={{
            position: 'absolute', left: 0, top: 0, width: RW, height: RH,
            borderRadius: 24, background: 'linear-gradient(135deg, #0369a1, #075985)',
            border: '3px solid rgba(8,47,73,0.6)',
          }} />
          {/* Línea central */}
          <div style={{ position: 'absolute', left: RW / 2 - 1, top: 0, width: 2, height: RH, background: 'rgba(255,255,255,0.5)' }} />
          {/* Círculo central */}
          <div style={{
            position: 'absolute', left: RW / 2 - 70, top: RH / 2 - 70, width: 140, height: 140,
            borderRadius: 70, border: '2px solid rgba(255,255,255,0.5)',
          }} />
          {/* Áreas */}
          <div style={{ position: 'absolute', left: 60, top: RH / 2 - 108, width: 150, height: 216, border: '2px solid rgba(255,255,255,0.45)', borderRadius: 6 }} />
          <div style={{ position: 'absolute', left: RW - 60 - 150, top: RH / 2 - 108, width: 150, height: 216, border: '2px solid rgba(255,255,255,0.45)', borderRadius: 6 }} />

          {/* Jugadores */}
          {positioned.map((e, i) => {
            const cx = (e.x / 100) * RW;
            const cy = (e.y / 100) * RH;
            const left = clamp(cx - CHIP_W / 2, RW - CHIP_W);
            const top = clamp(cy - 54, RH - 112);
            const ring = e.accent ? '#dc2626' : '#f8fafc';
            const photo = photos[i];
            const initial = chipName(e.p.playerName).charAt(0).toUpperCase() || '·';
            return (
              <div key={i} style={{
                position: 'absolute', left, top, width: CHIP_W,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- next/og (satori) requiere <img>, no next/image
                  <img
                    src={photo}
                    width={76}
                    height={76}
                    style={{ width: 76, height: 76, borderRadius: 38, objectFit: 'cover', border: `3px solid ${ring}`, background: '#e2e8f0' }}
                  />
                ) : (
                  <div style={{
                    width: 76, height: 76, borderRadius: 38, border: `3px solid ${ring}`,
                    background: '#cbd5e1', color: '#475569', fontSize: 34, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {initial}
                  </div>
                )}
                <div style={{
                  display: 'flex', marginTop: 6, maxWidth: CHIP_W, padding: '2px 8px',
                  background: 'rgba(2,6,23,0.78)', borderRadius: 8, fontSize: 18, fontWeight: 700,
                }}>
                  {e.p.jerseyNumber != null ? `${e.p.jerseyNumber} ` : ''}{chipName(e.p.playerName)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pie */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64, padding: '0 48px', fontSize: 22, color: '#94a3b8' }}>
          <div style={{ display: 'flex' }}>{shareLink}</div>
          <div style={{ display: 'flex', color: '#64748b' }}>Cinco inicial</div>
        </div>
      </div>
    ),
    { ...SIZE },
  );
}
