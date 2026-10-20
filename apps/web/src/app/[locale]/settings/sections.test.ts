import { describe, it, expect } from 'vitest';
import { settingsSections } from './sections';

const t = (key: string) => key;

describe('settingsSections', () => {
  it('pone "La app" justo detrás de la cuenta cuando la PWA no está instalada', () => {
    const ids = settingsSections(t, false).map((s) => s.id);
    expect(ids).toEqual([
      'cuenta', 'app', 'notificaciones', 'favoritos', 'preferencias', 'privacidad',
    ]);
  });

  it('oculta "La app" cuando la PWA ya está instalada', () => {
    const ids = settingsSections(t, true).map((s) => s.id);
    expect(ids).toEqual([
      'cuenta', 'notificaciones', 'favoritos', 'preferencias', 'privacidad',
    ]);
  });

  it('mientras no se sabe si está instalada, no la muestra (sin parpadeo)', () => {
    const ids = settingsSections(t, null).map((s) => s.id);
    expect(ids).not.toContain('app');
  });

  it('usa las claves de traducción de cada sección', () => {
    const labels = settingsSections(t, false).map((s) => s.label);
    expect(labels).toContain('settings.section_account');
    expect(labels).toContain('settings.section_app');
  });
});
