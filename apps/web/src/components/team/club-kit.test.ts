import { describe, it, expect } from 'vitest';
import { embedCode } from './ClubKit';

describe('embedCode (widget para clubes)', () => {
  it('iframe al widget del equipo, en el idioma de la página, perezoso y sin borde', () => {
    const code = embedCode('https://sticklive.eu', 'ca', 't1', 'CP "Vic"');
    expect(code).toContain('src="https://sticklive.eu/ca/embed/team/t1"');
    expect(code).toContain('loading="lazy"');
    expect(code).toContain('title="CP &quot;Vic&quot; · Stick Live"');
  });
});
