/**
 * Secciones del índice de ajustes, en el mismo orden en que se pintan.
 *
 * "La app" (instalar la PWA) va justo detrás de la cuenta, pero solo mientras
 * la PWA no esté instalada: con la app ya instalada no hay nada que instalar y
 * el bloque (y su entrada en el índice) desaparece.
 *
 * Pura: recibe el traductor y el estado de instalación para poder fijarla con
 * tests sin DOM.
 */

export interface SettingsSection {
  id: string;
  label: string;
}

export function settingsSections(
  t: (key: string) => string,
  installed: boolean | null,
): SettingsSection[] {
  return [
    { id: 'cuenta', label: t('settings.section_account') },
    // `null` = aún sin comprobar (SSR/primer render): se oculta igual que
    // cuando está instalada, para no parpadear con un bloque que va a sobrar.
    ...(installed === false ? [{ id: 'app', label: t('settings.section_app') }] : []),
    { id: 'notificaciones', label: t('settings.notif_title') },
    { id: 'favoritos', label: t('navigation.favorites') },
    { id: 'preferencias', label: t('settings.section_preferences') },
    { id: 'privacidad', label: t('settings.section_privacy') },
  ];
}
