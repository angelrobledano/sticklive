import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MatchPreview } from './MatchPreview';

/** Auditoría UX 03/11/2026 #6: tras el final, la previa no debe leerse como previa. */
const team = (id: string, name: string) => ({
  teamId: id, teamName: name, position: 3, points: 9, played: 4, form: ['W', 'D'], recent: [], observations: [],
});
const data = { home: team('h', 'Reus'), away: team('a', 'Calafell'), headToHead: [], cross: [] };

describe('MatchPreview', () => {
  it('antes del partido: sección abierta con «Previa del partido»', () => {
    const html = renderToStaticMarkup(<MatchPreview data={data} locale="es" />);
    expect(html).toContain('Previa del partido');
    expect(html).not.toContain('<details');
  });
  it('después: plegada y titulada «Así llegaban»', () => {
    const html = renderToStaticMarkup(<MatchPreview data={data} locale="es" variant="post" />);
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Así llegaban');
    expect(html).not.toContain('Previa del partido');
  });
});
