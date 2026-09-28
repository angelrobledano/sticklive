import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamName } from './TeamName';

/** #196: el sufijo de sección ('F', 'B'…) se pinta junto al nombre del equipo. */
describe('TeamName sufijo de sección (#196)', () => {
  it('renderiza el sufijo cuando se pasa', () => {
    const html = renderToStaticMarkup(<TeamName name="CE Noia B" shortName="NOIB" suffix="B" />);
    expect(html).toContain('CE Noia B');
    expect(html).toContain('>B</span>');
  });

  it('sin sufijo no añade ruido visual', () => {
    const html = renderToStaticMarkup(<TeamName name="CE Noia" shortName="NOIA" />);
    expect(html).not.toContain('ml-1');
  });
});
