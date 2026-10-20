import { describe, it, expect } from 'vitest';
import { trustDict } from './content';

describe('trustDict (F4-4)', () => {
  for (const locale of ['es', 'en', 'pt', 'fr', 'it']) {
    it(`${locale}: Sobre, contacto y aviso legal tienen contenido`, () => {
      const d = trustDict(locale);
      for (const page of [d.about, d.contact, d.legal]) {
        expect(page.title.length).toBeGreaterThan(0);
        expect(page.description.length).toBeGreaterThan(0);
        expect(page.sections.length).toBeGreaterThan(0);
        for (const section of page.sections) {
          expect(section.h.length).toBeGreaterThan(0);
          expect(section.p.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it('el aviso legal identifica al titular y un contacto', () => {
    const legal = trustDict('es').legal.sections.map((s) => s.p).join(' ');
    expect(legal).toContain('Ángel Robledano');
    expect(legal).toContain('hola@sticklive.eu');
  });
});
