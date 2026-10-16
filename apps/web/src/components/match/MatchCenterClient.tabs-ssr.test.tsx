import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { MatchCenterClient } from './MatchCenterClient';
import type { MatchDetail } from '@/lib/api/client';
import matchJson from './__fixtures__/match-detail.json';

/**
 * Igual que en la ficha de equipo (ver `TeamCenterClient.tabs-ssr.test.tsx`):
 * el partido montaba un solo panel de pestaña, así que alineaciones y
 * estadísticas —que ya vienen en `data`— no existían en el HTML y Googlebot
 * (que no pulsa pestañas) no las veía. Fixture = respuesta real de la API de un
 * partido finalizado con 34 eventos (`/api/matches/0a33b155-…`).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/matches/m1',
  useParams: () => ({ locale: 'es' }),
  useSearchParams: () => new URLSearchParams(),
}));

const data = matchJson as unknown as MatchDetail;

function render(): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
      <MatchCenterClient data={data} />
    </I18nProvider>,
  );
}

describe('MatchCenterClient — paneles en el HTML servido', () => {
  it('monta todos los paneles y oculta los inactivos (Resumen por defecto)', () => {
    const html = render();
    // Resumen activo + Alineaciones + Estadísticas => 2 ocultos.
    expect((html.match(/hidden=""/g) ?? []).length).toBe(2);
  });

  it('el HTML trae las alineaciones aunque la pestaña activa sea Resumen', () => {
    const html = render();
    const firstPlayer = String(data.lineups.home[0]!.playerName).split(' ')[0]!.toLowerCase();
    expect(html.toLowerCase()).toContain(firstPlayer);
  });
});
