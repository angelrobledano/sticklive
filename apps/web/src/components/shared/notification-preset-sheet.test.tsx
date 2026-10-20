import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { NotificationPresetSheet } from './NotificationPresetSheet';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
  useSearchParams: () => new URLSearchParams(''),
}));

/**
 * Decisión de producto: el selector ofrece TRES opciones y no muestra 'complete'
 * (alias legacy de 'key_events'). Un JUGADOR además no ve "Resultados": ese preset
 * no le entregaría nada (sus eventos de partido no llegan por seguir al jugador).
 * El diccionario va vacío a propósito: `t` devuelve la clave, así comprobamos
 * PRESENCIA/AUSENCIA de opciones sin depender de las traducciones.
 */
function renderSheet(kind: 'team' | 'league' | 'player'): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
      <NotificationPresetSheet open kind={kind} id="x1" onClose={() => {}} />
    </I18nProvider>,
  );
}

describe('NotificationPresetSheet — opciones por entidad', () => {
  it('incluye una X accesible para cerrar el modal', () => {
    const html = renderSheet('team');
    expect(html).toContain('aria-label="notif_presets.close"');
  });

  it('equipo: Eventos clave, Resultados y Silencioso; sin "Completo"', () => {
    const html = renderSheet('team');
    expect(html).toContain('notif_presets.key_events.label');
    expect(html).toContain('notif_presets.results.label');
    expect(html).toContain('notif_presets.silent.label');
    expect(html).not.toContain('notif_presets.complete.label');
  });

  it('jugador: sin "Resultados" y con copy propia para sus eventos', () => {
    const html = renderSheet('player');
    expect(html).toContain('notif_presets.key_events.label');
    expect(html).toContain('notif_presets.silent.label');
    expect(html).not.toContain('notif_presets.results.label');
    expect(html).toContain('notif_presets.player.key_events.desc');
    expect(html).toContain('notif_presets.player.silent.desc');
  });
});
